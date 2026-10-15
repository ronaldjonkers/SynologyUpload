'use strict';

// Bridge between the DSM app (ui/index.html) and the Upload Portal server.
// DSM runs this as a CGI under /webman/3rdparty/UploadPortal/api.cgi.
// 1. checks the DSM session (cookie + SynoToken) via authenticate.cgi
// 2. checks that the user is in the 'administrators' group
// 3. forwards the request to 127.0.0.1:<port>/api/admin/... with the secret key

const fs = require('fs');
const http = require('http');
const { spawnSync } = require('child_process');

const PKG_VAR = process.env.UPLOAD_PORTAL_VAR || '/var/packages/UploadPortal/var';
const AUTH_CGI = '/usr/syno/synoman/webman/modules/authenticate.cgi';
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function reply(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  process.stdout.write(
    `Status: ${status}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n\r\n${text}`,
  );
}

function dsmUser() {
  const token = process.env.HTTP_X_SYNO_TOKEN || '';
  const r = spawnSync(AUTH_CGI, [], {
    env: { ...process.env, QUERY_STRING: `SynoToken=${encodeURIComponent(token)}`, REQUEST_METHOD: 'GET' },
    encoding: 'utf8',
    timeout: 10000,
  });
  const lines = String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const user = lines[lines.length - 1] || '';
  return /^[^\s:/\\]{1,64}$/.test(user) ? user : null;
}

function isAdmin(user) {
  const r = spawnSync('id', ['-Gn', user], { encoding: 'utf8', timeout: 5000 });
  return String(r.stdout || '').split(/\s+/).includes('administrators');
}

function readBody() {
  const len = Math.min(parseInt(process.env.CONTENT_LENGTH || '0', 10) || 0, 200 * 1024);
  if (!len) return Buffer.alloc(0);
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    let n;
    try {
      n = fs.readSync(0, buf, off, len - off, null);
    } catch (e) {
      if (e.code === 'EAGAIN') continue;
      throw e;
    }
    if (!n) break;
    off += n;
  }
  return buf.subarray(0, off);
}

function main() {
  const q = new URLSearchParams(process.env.QUERY_STRING || '');
  const target = q.get('p') || '';
  const method = (q.get('m') || 'GET').toUpperCase();
  if ((process.env.REQUEST_METHOD || '').toUpperCase() !== 'POST') return reply(405, { error: 'POST only' });
  if (!/^\/[A-Za-z0-9/_-]*(\?[^#]*)?$/.test(target) || !METHODS.has(method)) return reply(400, { error: 'Invalid request' });

  const user = dsmUser();
  if (!user) return reply(401, { error: 'Your DSM session has expired. Please refresh the page.' });
  if (!isAdmin(user)) return reply(403, { error: 'Only DSM administrators can access Upload Portal.' });

  let key;
  let port;
  try {
    key = fs.readFileSync(`${PKG_VAR}/admin.key`, 'utf8').trim();
    port = JSON.parse(fs.readFileSync(`${PKG_VAR}/runtime.json`, 'utf8')).port;
  } catch {
    return reply(503, { error: 'Upload Portal is not running. Start the package in Package Center.' });
  }

  const body = readBody();
  const req = http.request({
    host: '127.0.0.1',
    port,
    method,
    path: `/api/admin${target}`,
    timeout: 30000,
    headers: {
      'content-type': 'application/json',
      'content-length': body.length,
      'x-admin-key': key,
      'x-dsm-user': user,
    },
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => reply(res.statusCode, Buffer.concat(chunks).toString('utf8') || '{}'));
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', () => reply(503, { error: 'Upload Portal is not responding. Check that the package is running.' }));
  req.end(body);
}

try {
  main();
} catch (e) {
  reply(500, { error: 'Internal error in api.cgi' });
}
