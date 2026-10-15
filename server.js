'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pipeline } = require('stream');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '8090', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
// Default shared folder (chosen in the install wizard); suggested for new links.
const DEFAULT_SHARE = process.env.SHARE_NAME || '';
// Folders containing the NAS shared folders: /volume1, /volume2, /volumeUSB1, ...
function defaultShareRoots() {
  try {
    const vols = fs.readdirSync('/').filter((n) => /^volume(USB)?\d+$/.test(n)).map((n) => `/${n}`);
    if (vols.length) return vols;
  } catch { /* not a Synology */ }
  const dev = path.join(__dirname, 'dev-shares');
  fs.mkdirSync(path.join(dev, 'Uploads'), { recursive: true });
  return [dev];
}
const SHARE_ROOTS = (process.env.SHARE_ROOTS ? process.env.SHARE_ROOTS.split(',') : defaultShareRoots())
  .map((p) => p.trim()).filter(Boolean).map((p) => path.resolve(p));
// DSM 7 creates symlinks here for shared folders the package has permissions on.
const PKG_SHARES_DIR = process.env.PKG_SHARES_DIR || '/var/packages/UploadPortal/shares';
const TMP_DIR = path.resolve(process.env.TMP_DIR || path.join(DATA_DIR, 'tmp'));
const TRUST_PROXY = process.env.TRUST_PROXY || 'loopback, uniquelocal';

const CHUNK_SIZE = 8 * 1024 * 1024; // size the client sends per request
const MAX_CHUNK = 32 * 1024 * 1024; // hard limit per request
const LINK_SESSION_MS = 24 * 3600 * 1000;
const STALE_UPLOAD_MS = 24 * 3600 * 1000;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Administration goes through DSM (ui/api.cgi). That CGI reads this key and sends
// it along; without the key the admin APIs are unreachable.
const ADMIN_KEY_FILE = path.join(DATA_DIR, 'admin.key');
let ADMIN_KEY;
try {
  ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
} catch {
  ADMIN_KEY = '';
}
if (ADMIN_KEY.length < 32) {
  ADMIN_KEY = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(ADMIN_KEY_FILE, ADMIN_KEY, { mode: 0o600 });
}
fs.writeFileSync(path.join(DATA_DIR, 'runtime.json'), JSON.stringify({ port: PORT }));

// ---------------------------------------------------------------------------
// Storage (JSON file; plenty for dozens of users/links)
// ---------------------------------------------------------------------------
let db;

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    db = {};
  }
  db.users ||= [];
  db.links ||= [];
  db.activity ||= [];
  db.totals ||= { uploads: 0, bytes: 0 };
  db.settings ||= { publicUrl: '' };
  db.secret ||= crypto.randomBytes(32).toString('hex');
  // Schema 1: link.folder was relative to a single fixed shared folder. Now the path starts with the shared folder itself.
  if ((db.schema || 1) < 2) {
    if (DEFAULT_SHARE) for (const l of db.links) l.folder = safeRelPath(`${DEFAULT_SHARE}/${l.folder || ''}`);
    db.schema = 2;
  }
  saveDb();
}

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

loadDb();

function logActivity(entry) {
  db.activity.unshift({ id: crypto.randomUUID(), at: Date.now(), ...entry });
  if (db.activity.length > 2000) db.activity.length = 2000;
  saveDb();
}

// ---------------------------------------------------------------------------
// Crypto-helpers
// ---------------------------------------------------------------------------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  if (typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', db.secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch { /* ignore invalid cookie */ }
  }
  return out;
}

function setCookie(req, res, name, value, maxAgeMs) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// ---------------------------------------------------------------------------
// Brute-force protection
// ---------------------------------------------------------------------------
const failures = new Map();
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

function lockedFor(key) {
  const f = failures.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}

function registerFail(key) {
  const f = failures.get(key) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  failures.set(key, f);
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
function sanitizeSegment(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f<>:"\\|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 200);
}

function safeRelPath(p) {
  return String(p || '')
    .split(/[\\/]+/)
    .map(sanitizeSegment)
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

function resolveInside(root, rel) {
  const full = path.resolve(root, rel || '.');
  if (full !== root && !full.startsWith(root + path.sep)) {
    const err = new Error('Invalid path');
    err.status = 400;
    throw err;
  }
  return full;
}

const HIDDEN_DIRS = new Set(['#recycle', '#snapshot', 'lost+found']);
const isVisibleDir = (name) => !name.startsWith('.') && !name.startsWith('@') && !HIDDEN_DIRS.has(name);
const httpError = (status, message) => Object.assign(new Error(message), { status });

// --- NAS shared folders ---
let sharesCache = { at: 0, list: [] };

async function listShares() {
  if (Date.now() - sharesCache.at < 5000) return sharesCache.list;
  const byName = new Map();
  for (const root of [...SHARE_ROOTS, PKG_SHARES_DIR]) {
    let names;
    try { names = await fsp.readdir(root); } catch { continue; }
    for (const name of names) {
      if (!isVisibleDir(name) || byName.has(name)) continue;
      const full = path.join(root, name);
      const st = await fsp.stat(full).catch(() => null);
      if (!st || !st.isDirectory()) continue;
      byName.set(name, { name, path: await fsp.realpath(full).catch(() => full) });
    }
  }
  const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  sharesCache = { at: Date.now(), list };
  return list;
}

async function canWrite(dir) {
  try {
    await fsp.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function splitFolder(folder) {
  const rel = safeRelPath(folder);
  const [share = '', ...rest] = rel ? rel.split('/') : [];
  return { rel, share, sub: rest.join('/') };
}

// "Photos/Clients/Smith" -> shared folder "Photos" + subfolder "Clients/Smith"
async function resolveFolder(folder) {
  const { share, sub } = splitFolder(folder);
  if (!share) throw httpError(400, 'Choose a shared folder');
  const found = (await listShares()).find((s) => s.name === share);
  if (!found) throw httpError(404, `Shared folder "${share}" not found`);
  return { share: found.name, root: found.path, full: resolveInside(found.path, sub) };
}

function noAccessError(share) {
  return httpError(403, `Upload Portal has no write permission on the shared folder "${share}". Give the system user "UploadPortal" read/write permission on this folder.`);
}

async function ensureWritableFolder(folder) {
  const f = await resolveFolder(folder);
  try {
    await fsp.mkdir(f.full, { recursive: true });
    await fsp.access(f.full, fs.constants.W_OK);
  } catch (e) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(e.code)) throw noAccessError(f.share);
    throw e;
  }
  return f;
}

async function folderStatus(folder) {
  let f;
  try { f = await resolveFolder(folder); } catch { return 'missing'; }
  try {
    await fsp.access(f.full, fs.constants.W_OK);
    return 'ok';
  } catch (e) {
    if (e.code === 'ENOENT') return (await canWrite(f.root)) ? 'ok' : 'readonly';
    return 'readonly';
  }
}

async function reserveName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length) || 'file';
  for (let i = 0; i < 10000; i++) {
    const candidate = i === 0 ? `${base}${ext}` : `${base} (${i})${ext}`;
    const full = path.join(dir, candidate);
    try {
      const fh = await fsp.open(full, 'wx');
      await fh.close();
      return full;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('No free file name found');
}

async function moveFile(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
}

async function diskSpace(dir) {
  try {
    if (!dir) {
      const shares = await listShares();
      dir = (shares.find((x) => x.name === DEFAULT_SHARE) || shares[0] || {}).path || SHARE_ROOTS[0];
    }
    const s = await fsp.statfs(dir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', TRUST_PROXY);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use('/static', express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Version in the asset URLs so browsers load the new files right after an update.
const ASSET_VERSION = `${require('./package.json').version}-${Date.now().toString(36)}`;
const UPLOAD_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'upload.html'), 'utf8').replace(/__V__/g, ASSET_VERSION);
app.get(['/', '/u/:token'], (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(UPLOAD_HTML));
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Admin (only via the DSM app: localhost + secret key)
// ---------------------------------------------------------------------------
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function requireAdmin(req, res, next) {
  // Deliberately the real socket, not req.ip: X-Forwarded-For must not count here.
  if (!LOOPBACK.has(req.socket.remoteAddress) || !safeEqual(req.get('x-admin-key') || '', ADMIN_KEY)) {
    return bad(res, 'Access denied', 401);
  }
  req.dsmUser = String(req.get('x-dsm-user') || 'admin').slice(0, 64);
  next();
}

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ username: req.dsmUser }));

app.get('/api/admin/overview', requireAdmin, ah(async (req, res) => {
  res.json({
    users: db.users.length,
    links: db.links.length,
    activeLinks: db.links.filter((l) => l.active && !(l.expiresAt && l.expiresAt < Date.now())).length,
    uploads: db.totals.uploads,
    bytes: db.totals.bytes,
    disk: await diskSpace(),
    port: PORT,
    share: DEFAULT_SHARE,
    publicUrl: db.settings.publicUrl,
  });
}));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  let publicUrl = String(req.body?.publicUrl || '').trim().replace(/\/+$/, '');
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      publicUrl = u.origin + u.pathname.replace(/\/+$/, '');
    } catch {
      return bad(res, 'Enter a valid URL, e.g. https://upload.yourdomain.com');
    }
  }
  db.settings.publicUrl = publicUrl;
  saveDb();
  res.json(db.settings);
});

// --- Users ---
const USERNAME_RE = /^[a-zA-Z0-9._@-]{2,64}$/;

function userView(u) {
  return {
    id: u.id,
    username: u.username,
    createdAt: u.createdAt,
    links: db.links.filter((l) => l.userIds.includes(u.id)).map((l) => ({ id: l.id, name: l.name })),
  };
}

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(db.users.map(userView).sort((a, b) => a.username.localeCompare(b.username)));
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!USERNAME_RE.test(username)) return bad(res, 'Username: 2–64 characters (letters, digits, . _ @ -)');
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters');
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return bad(res, 'This username already exists', 409);
  const user = { id: crypto.randomUUID(), username, passwordHash: hashPassword(password), sv: 1, createdAt: Date.now() };
  db.users.push(user);
  saveDb();
  res.status(201).json(userView(user));
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return bad(res, 'User not found', 404);
  const password = String(req.body?.password || '');
  if (password.length < 8) return bad(res, 'Password must be at least 8 characters');
  user.passwordHash = hashPassword(password);
  user.sv = (user.sv || 1) + 1; // log out existing sessions
  saveDb();
  res.json(userView(user));
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const idx = db.users.findIndex((u) => u.id === req.params.id);
  if (idx < 0) return bad(res, 'User not found', 404);
  const [user] = db.users.splice(idx, 1);
  for (const l of db.links) l.userIds = l.userIds.filter((id) => id !== user.id);
  saveDb();
  res.json({ ok: true });
});

// --- Links ---
function linkView(l) {
  return {
    id: l.id,
    token: l.token,
    name: l.name,
    folder: l.folder,
    userIds: l.userIds,
    users: l.userIds.map((id) => db.users.find((u) => u.id === id)).filter(Boolean).map((u) => ({ id: u.id, username: u.username })),
    expiresAt: l.expiresAt,
    maxFileSize: l.maxFileSize,
    allowedExtensions: l.allowedExtensions || [],
    active: l.active,
    createdAt: l.createdAt,
    uploadCount: l.uploadCount || 0,
    uploadBytes: l.uploadBytes || 0,
    lastUploadAt: l.lastUploadAt || null,
    url: `/u/${l.token}`,
  };
}

// "jpg, .PNG; *.pdf" -> ['jpg', 'png', 'pdf']. Empty = all file types allowed.
function normalizeExtensions(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const out = [];
  for (const item of raw) {
    const ext = String(item).trim().toLowerCase().replace(/^\*?\.+/, '');
    if (!ext) continue;
    if (!/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(ext) || ext.length > 20) throw httpError(400, `Invalid extension: "${item}"`);
    if (!out.includes(ext)) out.push(ext);
  }
  if (out.length > 50) throw httpError(400, 'Maximum of 50 extensions');
  return out;
}

const extensionAllowed = (name, exts) => !exts?.length || exts.some((e) => name.toLowerCase().endsWith(`.${e}`));
const extensionList = (exts) => exts.map((e) => `.${e}`).join(', ');

function parseLinkInput(body, existing) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!existing || has('name')) {
    out.name = String(body.name || '').trim().slice(0, 100);
    if (!out.name) throw Object.assign(new Error('Give the link a name'), { status: 400 });
  }
  if (!existing || has('folder')) {
    out.folder = safeRelPath(body.folder);
    if (!splitFolder(out.folder).share) throw httpError(400, 'Choose where the files for this link are saved');
  }
  if (!existing || has('userIds')) {
    const ids = Array.isArray(body.userIds) ? body.userIds : [];
    out.userIds = [...new Set(ids)].filter((id) => db.users.some((u) => u.id === id));
    if (!out.userIds.length) throw Object.assign(new Error('Assign at least one user'), { status: 400 });
  }
  if (!existing || has('expiresAt')) {
    const v = body.expiresAt;
    out.expiresAt = v ? Number(v) : null;
    if (out.expiresAt !== null && !Number.isFinite(out.expiresAt)) throw Object.assign(new Error('Invalid expiry date'), { status: 400 });
  }
  if (!existing || has('maxFileSize')) {
    const v = body.maxFileSize;
    out.maxFileSize = v ? Math.floor(Number(v)) : null;
    if (out.maxFileSize !== null && !(out.maxFileSize > 0)) throw Object.assign(new Error('Invalid maximum file size'), { status: 400 });
  }
  if (!existing || has('allowedExtensions')) out.allowedExtensions = normalizeExtensions(body.allowedExtensions);
  if (!existing || has('active')) out.active = body.active === undefined ? true : !!body.active;
  return out;
}

app.get('/api/admin/links', requireAdmin, ah(async (req, res) => {
  const list = await Promise.all(db.links.map(async (l) => ({ ...linkView(l), folderStatus: await folderStatus(l.folder) })));
  res.json(list.sort((a, b) => b.createdAt - a.createdAt));
}));

app.post('/api/admin/links', requireAdmin, ah(async (req, res) => {
  const input = parseLinkInput(req.body || {});
  await ensureWritableFolder(input.folder);
  const link = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(12).toString('base64url'),
    createdAt: Date.now(),
    uploadCount: 0,
    uploadBytes: 0,
    ...input,
  };
  db.links.push(link);
  saveDb();
  res.status(201).json(linkView(link));
}));

app.patch('/api/admin/links/:id', requireAdmin, ah(async (req, res) => {
  const link = db.links.find((l) => l.id === req.params.id);
  if (!link) return bad(res, 'Link not found', 404);
  const input = parseLinkInput(req.body || {}, link);
  if (input.folder !== undefined && input.folder !== link.folder) await ensureWritableFolder(input.folder);
  Object.assign(link, input);
  saveDb();
  res.json(linkView(link));
}));

app.post('/api/admin/links/:id/regenerate', requireAdmin, (req, res) => {
  const link = db.links.find((l) => l.id === req.params.id);
  if (!link) return bad(res, 'Link not found', 404);
  link.token = crypto.randomBytes(12).toString('base64url');
  saveDb();
  res.json(linkView(link));
});

app.delete('/api/admin/links/:id', requireAdmin, (req, res) => {
  const idx = db.links.findIndex((l) => l.id === req.params.id);
  if (idx < 0) return bad(res, 'Link not found', 404);
  db.links.splice(idx, 1);
  saveDb();
  res.json({ ok: true });
});

// --- Folders ---
app.get('/api/admin/folders', requireAdmin, ah(async (req, res) => {
  const { rel, share } = splitFolder(req.query.path);
  if (!share) {
    const shares = await Promise.all((await listShares()).map(async (s) => ({ name: s.name, writable: await canWrite(s.path) })));
    return res.json({ path: '', share: '', shares, folders: [], writable: false, readable: true });
  }
  const f = await resolveFolder(rel);
  let entries;
  try {
    entries = await fsp.readdir(f.full, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return bad(res, 'Folder does not exist', 404);
    if (e.code === 'EACCES' || e.code === 'EPERM') return res.json({ path: rel, share, folders: [], writable: false, readable: false });
    throw e;
  }
  const folders = entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && isVisibleDir(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  res.json({ path: rel, share, folders, writable: await canWrite(f.full), readable: true });
}));

app.post('/api/admin/folders', requireAdmin, ah(async (req, res) => {
  const { rel, sub } = splitFolder(req.body?.path);
  if (!sub) return bad(res, 'Enter a folder name');
  await ensureWritableFolder(rel);
  res.status(201).json({ path: rel });
}));

app.get('/api/admin/activity', requireAdmin, (req, res) => {
  res.json(db.activity.slice(0, 500));
});

// ---------------------------------------------------------------------------
// Upload links (public, with login)
// ---------------------------------------------------------------------------
function findActiveLink(token) {
  const link = db.links.find((l) => l.token === token);
  if (!link) return { error: 'This upload link does not exist (anymore).' };
  if (!link.active) return { error: 'This upload link has been deactivated.' };
  if (link.expiresAt && link.expiresAt < Date.now()) return { error: 'This upload link has expired.' };
  return { link };
}

function linkSessionUser(req, link) {
  const p = unsign(parseCookies(req)[`sl_${link.id}`]);
  if (!p || p.typ !== 'link' || p.lid !== link.id) return null;
  const user = db.users.find((u) => u.id === p.uid);
  if (!user || (user.sv || 1) !== p.sv || !link.userIds.includes(user.id)) return null;
  return user;
}

const linkCtx = (requireAuth) => (req, res, next) => {
  const { link, error } = findActiveLink(req.params.token);
  if (!link) return bad(res, error, 404);
  req.link = link;
  req.user = linkSessionUser(req, link);
  if (requireAuth && !req.user) return bad(res, 'Your session has expired. Please log in again.', 401);
  next();
};

app.get('/api/l/:token', linkCtx(false), (req, res) => {
  res.json({
    name: req.link.name,
    user: req.user ? req.user.username : null,
    maxFileSize: req.link.maxFileSize,
    allowedExtensions: req.link.allowedExtensions || [],
    chunkSize: CHUNK_SIZE,
  });
});

app.post('/api/l/:token/login', linkCtx(false), (req, res) => {
  const key = `link:${req.ip}`;
  const mins = lockedFor(key);
  if (mins) return bad(res, `Too many attempts. Try again in ${mins} min.`, 429);
  const username = String(req.body?.username || '').trim().toLowerCase();
  const user = db.users.find((u) => u.username.toLowerCase() === username);
  // Always compute a hash so the response time reveals nothing.
  const ok = verifyPassword(req.body?.password || '', user ? user.passwordHash : hashPassword('x'));
  if (!user || !ok || !req.link.userIds.includes(user.id)) {
    registerFail(key);
    return bad(res, 'Incorrect username or password', 401);
  }
  failures.delete(key);
  const exp = Date.now() + LINK_SESSION_MS;
  setCookie(req, res, `sl_${req.link.id}`, sign({ typ: 'link', lid: req.link.id, uid: user.id, sv: user.sv || 1, exp }), LINK_SESSION_MS);
  res.json({ user: user.username });
});

app.post('/api/l/:token/logout', linkCtx(false), (req, res) => {
  setCookie(req, res, `sl_${req.link.id}`, '', 0);
  res.json({ ok: true });
});

// --- Chunked uploads ---
const uploads = new Map();

function getUpload(req, res) {
  const up = uploads.get(req.params.id);
  if (!up || up.linkId !== req.link.id || up.userId !== req.user.id) {
    bad(res, 'Upload not found', 404);
    return null;
  }
  return up;
}

async function discardUpload(up) {
  uploads.delete(up.id);
  await fsp.unlink(up.tmpPath).catch(() => {});
}

app.post('/api/l/:token/uploads', linkCtx(true), ah(async (req, res) => {
  const size = Number(req.body?.size);
  const name = sanitizeSegment(path.posix.basename(String(req.body?.name || '').replace(/\\/g, '/')));
  if (!name) return bad(res, 'Invalid file name');
  if (!Number.isSafeInteger(size) || size < 0) return bad(res, 'Invalid file size');
  if (req.link.maxFileSize && size > req.link.maxFileSize) return bad(res, 'File is larger than allowed', 413);
  if (!extensionAllowed(name, req.link.allowedExtensions)) {
    return bad(res, `This file type is not allowed. Allowed: ${extensionList(req.link.allowedExtensions)}`, 415);
  }
  let target;
  try {
    target = await resolveFolder(req.link.folder);
  } catch {
    return bad(res, 'The destination folder of this link is not available. Contact the administrator.', 409);
  }
  const disk = await diskSpace(target.root);
  if (disk && size > disk.free - 512 * 1024 * 1024) return bad(res, 'Not enough free disk space on the server', 507);

  const id = crypto.randomBytes(16).toString('hex');
  const tmpPath = path.join(TMP_DIR, `${id}.part`);
  await fsp.writeFile(tmpPath, '');
  uploads.set(id, {
    id, linkId: req.link.id, userId: req.user.id, name, size,
    received: 0, tmpPath, busy: false, updatedAt: Date.now(),
  });
  res.status(201).json({ id, chunkSize: CHUNK_SIZE });
}));

app.put('/api/l/:token/uploads/:id', linkCtx(true), (req, res) => {
  const up = getUpload(req, res);
  if (!up) return;
  if (up.busy) return bad(res, 'A part of this upload is already in progress', 409);
  const offset = Number(req.query.offset);
  if (offset !== up.received) return res.status(409).json({ error: 'Unexpected position', received: up.received });
  const len = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(len) || len <= 0 || len > MAX_CHUNK || offset + len > up.size) return bad(res, 'Invalid chunk');

  up.busy = true;
  const ws = fs.createWriteStream(up.tmpPath, { flags: 'r+', start: offset });
  pipeline(req, ws, async (err) => {
    up.updatedAt = Date.now();
    if (err || ws.bytesWritten !== len) {
      await fsp.truncate(up.tmpPath, up.received).catch(() => {});
      up.busy = false;
      if (!res.headersSent) bad(res, 'Chunk received incompletely, please retry');
      return;
    }
    up.received += len;
    up.busy = false;
    res.json({ received: up.received });
  });
});

app.post('/api/l/:token/uploads/:id/complete', linkCtx(true), ah(async (req, res) => {
  const up = getUpload(req, res);
  if (!up) return;
  if (up.busy || up.received !== up.size) return bad(res, 'Upload is not complete yet', 409);
  uploads.delete(up.id);

  // Files always go directly into the chosen folder, without subfolders.
  const linkRoot = (await resolveFolder(req.link.folder)).full;
  const destDir = linkRoot;
  try {
    await fsp.mkdir(destDir, { recursive: true });
  } catch (e) {
    if (['EACCES', 'EPERM', 'EROFS'].includes(e.code)) throw httpError(403, 'No write permission on the destination folder. Contact the administrator.');
    throw e;
  }
  const finalPath = await reserveName(destDir, up.name);
  try {
    await moveFile(up.tmpPath, finalPath);
  } catch (e) {
    await fsp.unlink(finalPath).catch(() => {});
    await fsp.unlink(up.tmpPath).catch(() => {});
    throw e;
  }

  const relFile = path.relative(linkRoot, finalPath).split(path.sep).join('/');
  req.link.uploadCount = (req.link.uploadCount || 0) + 1;
  req.link.uploadBytes = (req.link.uploadBytes || 0) + up.size;
  req.link.lastUploadAt = Date.now();
  db.totals.uploads += 1;
  db.totals.bytes += up.size;
  logActivity({
    linkId: req.link.id, linkName: req.link.name, folder: req.link.folder,
    userId: req.user.id, username: req.user.username,
    file: relFile, size: up.size, ip: req.ip,
  });
  res.json({ ok: true, name: relFile });
}));

app.delete('/api/l/:token/uploads/:id', linkCtx(true), ah(async (req, res) => {
  const up = getUpload(req, res);
  if (!up) return;
  await discardUpload(up);
  res.json({ ok: true });
}));

// Clean up leftover temporary files
async function cleanupStale() {
  const now = Date.now();
  for (const up of uploads.values()) {
    if (!up.busy && now - up.updatedAt > STALE_UPLOAD_MS) await discardUpload(up);
  }
  const active = new Set([...uploads.values()].map((u) => u.tmpPath));
  for (const name of await fsp.readdir(TMP_DIR).catch(() => [])) {
    const full = path.join(TMP_DIR, name);
    if (active.has(full)) continue;
    const st = await fsp.stat(full).catch(() => null);
    if (st && now - st.mtimeMs > STALE_UPLOAD_MS) await fsp.unlink(full).catch(() => {});
  }
}
cleanupStale();
setInterval(cleanupStale, 3600 * 1000).unref();

// ---------------------------------------------------------------------------
app.use('/api', (req, res) => bad(res, 'Not found', 404));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
});

app.listen(PORT, () => {
  console.log(`Upload Portal running on port ${PORT}`);
  console.log(`  shares  -> ${SHARE_ROOTS.join(', ')}`);
  console.log(`  data    -> ${DATA_DIR}`);
});
