/* Admin panel — runs as an app inside DSM */
'use strict';

const state = { tab: 'links', query: '', users: [], links: [], activity: [], overview: null, me: '' };

// ---------------------------------------------------------------------------
// Communication via api.cgi (DSM checks the session)
// ---------------------------------------------------------------------------
let synoToken = null;

async function getSynoToken() {
  if (synoToken) return synoToken;
  for (const w of [window.parent, window.top]) {
    try {
      const t = w && w.SYNO && w.SYNO.SDS && w.SYNO.SDS.Session && w.SYNO.SDS.Session.SynoToken;
      if (t) return (synoToken = t);
    } catch { /* different origin */ }
  }
  try {
    const res = await fetch('/webman/login.cgi', { credentials: 'same-origin' });
    const data = await res.json();
    if (data && data.SynoToken) return (synoToken = data.SynoToken);
  } catch { /* no token */ }
  return '';
}

async function adminApi(method, target, body) {
  const opts = {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-SYNO-TOKEN': await getSynoToken(), 'Content-Type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
  const res = await fetch(`api.cgi?m=${method}&p=${encodeURIComponent(target)}`, opts);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Something went wrong (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function publicBase() {
  const o = state.overview || {};
  return o.publicUrl || `${location.protocol === 'https:' ? 'http:' : location.protocol}//${location.hostname}:${o.port || 8090}`;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function openModal({ title, body, footer = '', wide = false, onMount }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn-icon" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 180);
  };
  const onKey = (e) => {
    const all = $$('.modal-backdrop');
    if (e.key === 'Escape' && all[all.length - 1] === backdrop) close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', close));

  const modal = $('.modal', backdrop);
  if (onMount) onMount(modal, close);
  const first = $('input:not([type=hidden]):not([readonly]):not([type=range]):not([type=checkbox]), select, textarea:not([readonly])', modal);
  if (first) setTimeout(() => first.focus(), 50);
  return { el: modal, close };
}

function confirmDialog(message, { title = 'Are you sure?', confirmText = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const { el, close } = openModal({
      title,
      body: `<p class="muted">${message}</p>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
    });
    $('[data-ok]', el).addEventListener('click', () => { answered = true; resolve(true); close(); });
    $$('[data-close]', el).forEach((b) => b.addEventListener('click', () => { if (!answered) resolve(false); }));
    el.parentElement.addEventListener('mousedown', (e) => { if (e.target === el.parentElement && !answered) resolve(false); });
    setTimeout(() => $('[data-ok]', el).focus(), 50);
  });
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.dataset.label ||= btn.innerHTML;
  btn.innerHTML = busy ? '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>' : btn.dataset.label;
}

const sharePath = (folder) => (folder ? `/${folder}` : 'No folder chosen yet');
const fullUrl = (link) => `${publicBase()}${link.url}`;

// ---------------------------------------------------------------------------
// Error screen (no access / package stopped)
// ---------------------------------------------------------------------------
function showFatal(err) {
  $('#app').innerHTML = `
    <div class="card state-card">
      <div class="empty-icon danger">${icon(err.status === 403 ? 'lock' : 'alert')}</div>
      <h2>${err.status === 403 ? 'Access denied' : 'Upload Portal unavailable'}</h2>
      <p class="muted">${esc(err.message)}</p>
      <button class="btn btn-primary" id="retryBoot">${icon('refresh')}Try again</button>
    </div>`;
  $('#retryBoot').addEventListener('click', () => { synoToken = null; boot(); });
}

// ---------------------------------------------------------------------------
// App-shell
// ---------------------------------------------------------------------------
async function showApp() {
  $('#app').innerHTML = `
    <header class="topbar">
      <div class="brand"><div class="brand-mark brand-mark-sm">${icon('cloudUpload')}</div>Upload Portal</div>
      <span class="chip"><span class="avatar">${initials(state.me)}</span>${esc(state.me)}</span>
    </header>
    <main class="container">
      <div id="banner"></div>
      <section class="stats" id="stats"></section>
      <div class="toolbar">
        <nav class="tabs" id="tabs">
          <button class="tab" data-tab="links">${icon('link')}<span class="label">Links</span><span class="count" data-count="links"></span></button>
          <button class="tab" data-tab="users">${icon('users')}<span class="label">Users</span><span class="count" data-count="users"></span></button>
          <button class="tab" data-tab="activity">${icon('activity')}<span class="label">Activity</span></button>
          <button class="tab" data-tab="settings">${icon('settings')}<span class="label">Settings</span></button>
        </nav>
        <div id="toolbarActions"></div>
      </div>
      <section id="panel"></section>
    </main>`;

  $('#banner').addEventListener('click', (e) => {
    if (e.target.closest('[data-goto-settings]')) {
      state.tab = 'settings';
      renderPanel();
    }
  });
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    state.tab = t.dataset.tab;
    state.query = '';
    history.replaceState(null, '', `#${state.tab}`);
    renderPanel();
  });
  $('#panel').addEventListener('click', onPanelClick);
  $('#panel').addEventListener('change', onPanelChange);

  const hash = location.hash.slice(1);
  if (['links', 'users', 'activity', 'settings'].includes(hash)) state.tab = hash;
  await refresh();
}

async function refresh() {
  try {
    const [overview, users, links, activity] = await Promise.all([
      adminApi('GET', '/overview'),
      adminApi('GET', '/users'),
      adminApi('GET', '/links'),
      adminApi('GET', '/activity'),
    ]);
    Object.assign(state, { overview, users, links, activity });
    renderBanner();
    renderStats();
    renderPanel();
  } catch (err) {
    if ([401, 403, 503].includes(err.status)) return showFatal(err);
    toast(err.message, 'error');
  }
}

function renderBanner() {
  $('#banner').innerHTML = state.overview.publicUrl ? '' : `
    <div class="card banner">
      ${icon('alert')}
      <div class="grow"><b>Set a public address.</b> <span class="muted">Links now use <span class="mono">${esc(publicBase())}</span> and only work inside your own network.</span></div>
      <button class="btn btn-sm" data-goto-settings>Set up</button>
    </div>`;
}

function renderStats() {
  const o = state.overview;
  const disk = o.disk;
  const usedPct = disk ? Math.round(((disk.total - disk.free) / disk.total) * 100) : 0;
  $('#stats').innerHTML = `
    <div class="card stat"><div class="stat-icon">${icon('link')}</div><div><div class="stat-value">${o.activeLinks}<span class="faint" style="font-size:15px"> / ${o.links}</span></div><div class="stat-label">Active links</div></div></div>
    <div class="card stat"><div class="stat-icon">${icon('users')}</div><div><div class="stat-value">${o.users}</div><div class="stat-label">Users</div></div></div>
    <div class="card stat"><div class="stat-icon">${icon('layers')}</div><div><div class="stat-value">${o.uploads.toLocaleString(undefined)}</div><div class="stat-label">${formatBytes(o.bytes)} uploaded</div></div></div>
    ${disk ? `<div class="card stat"><div class="stat-icon">${icon('drive')}</div><div class="grow"><div class="stat-value">${formatBytes(disk.free)}</div><div class="stat-label">free of ${formatBytes(disk.total)}</div><div class="progress stat-meter"><div class="progress-bar" id="diskBar"></div></div></div></div>` : ''}`;
  const bar = $('#diskBar');
  if (bar) requestAnimationFrame(() => { bar.style.width = `${usedPct}%`; });

  $('[data-count="links"]').textContent = state.links.length || '';
  $('[data-count="users"]').textContent = state.users.length || '';
}

function searchBox(placeholder) {
  return `<label class="search">${icon('search')}<input type="search" data-search placeholder="${esc(placeholder)}" value="${esc(state.query)}"><kbd>/</kbd></label>`;
}

function panelHtml() {
  if (state.tab === 'links') return renderLinks();
  if (state.tab === 'users') return renderUsers();
  return renderActivity();
}

function renderPanel() {
  $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  const actions = $('#toolbarActions');
  const panel = $('#panel');
  if (state.tab === 'settings') {
    actions.innerHTML = '';
    panel.innerHTML = renderSettings();
    wireSettings();
    return;
  }
  const config = {
    links: ['Search by name, folder or user…', `<button class="btn btn-primary" data-new="link">${icon('plus')}New link</button>`],
    users: ['Search users…', `<button class="btn btn-primary" data-new="user">${icon('userPlus')}New user</button>`],
    activity: ['Search file, user or link…', `<button class="btn btn-ghost" data-new="refresh">${icon('refresh')}Refresh</button>`],
  }[state.tab];
  actions.innerHTML = searchBox(config[0]) + config[1];
  panel.innerHTML = panelHtml();

  $('[data-search]', actions).addEventListener('input', (e) => {
    state.query = e.target.value;
    panel.innerHTML = panelHtml();
  });
  $('[data-new]', actions).addEventListener('click', (e) => {
    const what = e.currentTarget.dataset.new;
    if (what === 'link') openLinkModal();
    else if (what === 'user') openUserModal();
    else refresh().then(() => toast('Updated', 'info'));
  });
}

const matches = (...fields) => {
  const q = state.query.trim().toLowerCase();
  return !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
};

function noResults() {
  return `<div class="card empty"><div class="empty-icon">${icon('search')}</div><h3>No results</h3><p class="muted">Nothing found for “${esc(state.query)}”.</p></div>`;
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || $('.modal-backdrop')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === '/' && !typing) {
    const box = $('[data-search]');
    if (box) { e.preventDefault(); box.focus(); box.select(); }
  } else if (e.key === 'Escape' && document.activeElement?.matches('[data-search]')) {
    document.activeElement.value = '';
    document.activeElement.dispatchEvent(new Event('input'));
    document.activeElement.blur();
  } else if (e.key.toLowerCase() === 'n' && !typing) {
    const btn = $('[data-new="link"], [data-new="user"]');
    if (btn) { e.preventDefault(); btn.click(); }
  }
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------
function renderLinks() {
  if (!state.links.length) {
    return `<div class="card empty">
      <div class="empty-icon">${icon('link')}</div>
      <h3>No upload links yet</h3>
      <p class="muted">${state.users.length ? 'Create a link that saves files to a folder on your NAS.' : 'Create a user first, then you can create an upload link.'}</p>
      <button class="btn btn-primary" data-action="${state.users.length ? 'new-link' : 'new-user'}">${icon('plus')}${state.users.length ? 'New link' : 'New user'}</button>
    </div>`;
  }
  const list = state.links.filter((l) => matches(l.name, l.folder, ...l.users.map((u) => u.username)));
  return list.length ? `<div class="link-grid">${list.map(linkCard).join('')}</div>` : noResults();
}

function linkCard(l) {
  const expired = l.expiresAt && l.expiresAt < Date.now();
  const meta = [];
  if (l.folderStatus === 'missing') meta.push(`<span class="badge badge-danger">${icon('alert')}Folder not found</span>`);
  else if (l.folderStatus === 'readonly') meta.push(`<span class="badge badge-danger">${icon('lock')}No write permission</span>`);
  if (expired) meta.push(`<span class="badge badge-danger">${icon('clock')}Expired</span>`);
  else if (l.expiresAt) meta.push(`<span class="badge badge-warning">${icon('calendar')}Until ${formatDate(l.expiresAt, false)}</span>`);
  if (l.maxFileSize) meta.push(`<span class="badge">Max ${formatBytes(l.maxFileSize)}</span>`);
  if (l.allowedExtensions && l.allowedExtensions.length) {
    const shown = l.allowedExtensions.slice(0, 4).map((e) => `.${e}`).join(' ');
    const more = l.allowedExtensions.length > 4 ? ` +${l.allowedExtensions.length - 4}` : '';
    meta.push(`<span class="badge" title="${esc(l.allowedExtensions.map((e) => `.${e}`).join(', '))}">${icon('file')}${esc(shown + more)}</span>`);
  }
  meta.push(`<span class="badge badge-accent">${icon('layers')}${l.uploadCount} · ${formatBytes(l.uploadBytes)}</span>`);
  if (l.lastUploadAt) meta.push(`<span class="badge">${icon('clock')}${timeAgo(l.lastUploadAt)}</span>`);

  return `
    <article class="card link-card ${!l.active || expired ? 'is-off' : ''}" data-id="${esc(l.id)}">
      <div class="link-head">
        <div class="link-icon">${icon('link')}</div>
        <div class="grow">
          <h3 class="truncate">${esc(l.name)}</h3>
          <div class="link-folder">${icon('folder', 'icon-sm')}<span class="truncate">${esc(sharePath(l.folder))}</span></div>
        </div>
        <label class="switch" title="${l.active ? 'Active' : 'Inactive'}">
          <input type="checkbox" data-action="toggle" ${l.active ? 'checked' : ''}><span class="track"></span>
        </label>
      </div>
      <div class="link-url">
        <code>${esc(fullUrl(l))}</code>
        <button class="btn-icon" data-action="copy" title="Copy link">${icon('copy')}</button>
        <a class="btn-icon" href="${esc(l.url)}" target="_blank" rel="noopener" title="Open">${icon('external')}</a>
      </div>
      <div class="chips">${l.users.map((u) => `<span class="chip"><span class="avatar">${initials(u.username)}</span>${esc(u.username)}</span>`).join('') || '<span class="muted small">No users assigned</span>'}</div>
      <div class="link-meta">${meta.join('')}</div>
      <div class="link-foot">
        <button class="btn btn-sm btn-soft" data-action="share">${icon('send', 'icon-sm')}Share</button>
        <div class="actions">
          <button class="btn-icon" data-action="edit" title="Edit">${icon('edit')}</button>
          <button class="btn-icon" data-action="regenerate" title="Generate new URL">${icon('refresh')}</button>
          <button class="btn-icon danger" data-action="delete" title="Delete">${icon('trash')}</button>
        </div>
      </div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Folder picker: all shared folders on the NAS
// ---------------------------------------------------------------------------
const PKG_USER = 'UploadPortal';

// Grants the package's system user read/write permission via the DSM API (as the logged-in admin).
async function grantShareAccess(share) {
  const token = await getSynoToken();
  const perms = JSON.stringify([{ name: PKG_USER, is_readonly: false, is_writable: true, is_deny: false, is_custom: false }]);
  for (const type of ['system', 'local_user']) {
    for (const quote of [true, false]) {
      const q = (v) => (quote ? JSON.stringify(v) : v);
      const body = new URLSearchParams({
        api: 'SYNO.Core.Share.Permission', method: 'set', version: '1',
        name: q(share), user_group_type: q(type), permissions: perms,
      });
      try {
        const res = await fetch('/webapi/entry.cgi', { method: 'POST', credentials: 'same-origin', headers: { 'X-SYNO-TOKEN': token }, body });
        const data = await res.json();
        if (data && data.success) return true;
      } catch { /* try next variant */ }
    }
  }
  return false;
}

function manualAccessSteps(share) {
  return `<ol class="steps">
    <li>Open <b>Control Panel → Shared Folder</b></li>
    <li>Select <b>${esc(share)}</b> and click <b>Edit</b></li>
    <li><b>Permissions</b> tab → choose <b>System internal user</b> in the drop-down</li>
    <li>Tick <b>Read/Write</b> for <b>${PKG_USER}</b> and click <b>Save</b></li>
  </ol>`;
}

function folderBrowser(container, initial, onChange) {
  let current = initial || '';
  let busy = false;

  const crumbsHtml = () => {
    const parts = current ? current.split('/') : [];
    return [`<button type="button" class="crumb" data-path="">${icon('drive', 'icon-sm')}NAS</button>`]
      .concat(parts.map((seg, i) => `<span class="crumb-sep">${icon('chevron')}</span><button type="button" class="crumb" data-path="${esc(parts.slice(0, i + 1).join('/'))}">${esc(seg)}</button>`))
      .join('');
  };

  async function load(p) {
    current = p;
    container.innerHTML = `<div class="crumbs">${crumbsHtml()}</div><div class="folder-list"><div class="folder-empty"><span class="spinner spinner-sm"></span></div></div>`;
    let res;
    try {
      res = await adminApi('GET', `/folders?path=${encodeURIComponent(current)}`);
    } catch (err) {
      $('.folder-list', container).innerHTML = `<div class="folder-empty">${esc(err.message)}</div>`;
      onChange(current, { ok: false });
      return;
    }

    if (!res.share) {
      // Level 1: shared folders
      onChange('', { ok: false });
      $('.folder-list', container).innerHTML = res.shares.length
        ? res.shares.map((s) => `
          <button type="button" class="folder-item" data-path="${esc(s.name)}">
            <span class="share-icon">${icon('folder')}</span><span class="truncate">${esc(s.name)}</span>
            ${s.writable ? `<span class="badge badge-success">${icon('check')}Access</span>` : `<span class="badge">${icon('lock')}No access</span>`}
            <span class="chev">${icon('chevron', 'icon-sm')}</span>
          </button>`).join('')
        : '<div class="folder-empty">No shared folders found</div>';
      container.insertAdjacentHTML('beforeend', `<div class="folder-hint">${icon('sparkles', 'icon-sm')}Choose the folder where files for this link are saved</div>`);
      return;
    }

    onChange(current, { ok: res.writable, share: res.share });
    const list = res.readable && res.folders.length
      ? res.folders.map((f) => `<button type="button" class="folder-item" data-path="${esc(`${current}/${f}`)}">${icon('folder')}<span class="truncate">${esc(f)}</span><span class="chev">${icon('chevron', 'icon-sm')}</span></button>`).join('')
      : `<div class="folder-empty">${!res.readable ? 'Contents not visible without access' : res.writable ? 'Files are saved in this folder' : 'No subfolders'}</div>`;
    $('.folder-list', container).innerHTML = list;

    if (!res.writable) {
      container.insertAdjacentHTML('beforeend', `
        <div class="access-box">
          <div class="access-head">${icon('lock')}<div class="grow"><b>No write permission on “${esc(res.share)}”</b><div class="small muted">Upload Portal can't save files here yet.</div></div>
            <button type="button" class="btn btn-sm btn-primary" data-grant="${esc(res.share)}">${icon('key', 'icon-sm')}Grant access</button></div>
          <details class="small"><summary>Prefer to set it manually?</summary>${manualAccessSteps(res.share)}</details>
        </div>`);
    }
  }

  container.addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-path]');
    if (nav) return load(nav.dataset.path);

    const grant = e.target.closest('[data-grant]');
    if (grant && !busy) {
      busy = true;
      setBusy(grant, true);
      const ok = await grantShareAccess(grant.dataset.grant);
      busy = false;
      if (ok) {
        toast(`Access granted to ${grant.dataset.grant}`);
        await new Promise((r) => setTimeout(r, 800));
        return load(current);
      }
      setBusy(grant, false);
      toast('Couldn\'t grant access automatically — follow the steps below', 'error');
      const det = $('details', container);
      if (det) det.open = true;
      return;
    }
  });
  load(current);
}

function toDateInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function userChecks(selected) {
  if (!state.users.length) return '<div class="folder-empty">No users yet — create one above.</div>';
  return state.users.map((u) => `
    <label class="check-item"><input type="checkbox" name="userIds" value="${esc(u.id)}" ${selected.includes(u.id) ? 'checked' : ''}><span class="avatar">${initials(u.username)}</span><span class="truncate">${esc(u.username)}</span></label>`).join('');
}

const EXT_PRESETS = [
  ['Photos', 'jpg, jpeg, png, heic, heif, tif, tiff, raw, cr2, cr3, nef, arw, dng'],
  ['Video', 'mp4, mov, m4v, avi, mkv, mts'],
  ['Documents', 'pdf, doc, docx, xls, xlsx, ppt, pptx, txt'],
  ['Audio', 'mp3, wav, m4a, aac, flac'],
  ['Archives', 'zip, rar, 7z'],
];

function parseExtensions(text) {
  const valid = [];
  const invalid = [];
  for (const item of String(text || '').split(/[\s,;]+/)) {
    const ext = item.trim().toLowerCase().replace(/^\*?\.+/, '');
    if (!ext) continue;
    if (/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(ext) && ext.length <= 20) { if (!valid.includes(ext)) valid.push(ext); } else invalid.push(item);
  }
  return { valid, invalid };
}

function openLinkModal(link) {
  const editing = !!link;
  const l = link || { name: '', folder: '', userIds: [], expiresAt: null, maxFileSize: null, active: true };
  const body = `
    <form class="form-grid" id="linkForm">
      <label class="field"><span>Name</span><input class="input" name="name" value="${esc(l.name)}" placeholder="E.g. Wedding photos Jansen" maxlength="100" required></label>
      <div class="field">
        <span>Destination folder</span>
        <div class="dest" id="dest"></div>
        <div class="folder-browser" id="folderBrowser"></div>
      </div>
      <div class="field">
        <div class="field-head"><span>Users with access</span><button type="button" class="btn btn-sm btn-soft" data-inline-user>${icon('userPlus', 'icon-sm')}New user</button></div>
        <div class="check-list" id="userChecks">${userChecks(l.userIds)}</div>
      </div>
      <div class="form-row">
        <label class="field"><span>Expires on <span class="faint">(optional)</span></span><input class="input" type="date" name="expires" value="${toDateInput(l.expiresAt)}"></label>
        <label class="field"><span>Max. file size <span class="faint">(MB)</span></span><input class="input" type="number" min="1" name="maxMb" value="${l.maxFileSize ? Math.round(l.maxFileSize / 1048576) : ''}" placeholder="Unlimited"></label>
      </div>
      <div class="field">
        <span>Allowed file types <span class="faint">(optional)</span></span>
        <input class="input input-mono" name="exts" value="${esc((l.allowedExtensions || []).join(', '))}" placeholder="E.g. jpg, png, pdf — leave empty to allow all files" autocomplete="off" spellcheck="false">
        <div class="ext-presets"><span class="faint small">Quick add:</span>${EXT_PRESETS.map(([label]) => `<button type="button" class="btn btn-sm btn-soft" data-preset="${esc(label)}">${icon('plus', 'icon-sm')}${esc(label)}</button>`).join('')}<button type="button" class="btn btn-sm btn-ghost" data-preset-clear>Clear</button></div>
        <div class="ext-preview" data-ext-preview></div>
      </div>
      <label class="switch"><input type="checkbox" name="active" ${l.active ? 'checked' : ''}><span class="track"></span><span>Link is active</span></label>
      <div class="form-error" id="linkError"></div>
    </form>`;
  const footer = `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="saveLink">${icon('check')}${editing ? 'Save' : 'Create link'}</button>`;

  openModal({
    title: editing ? 'Edit link' : 'New upload link',
    body,
    footer,
    wide: true,
    onMount(el, close) {
      const form = $('#linkForm', el);
      let folder = l.folder;
      const dest = $('#dest', el);
      folderBrowser($('#folderBrowser', el), l.folder, (p, info) => {
        folder = p;
        dest.className = `dest ${!p ? 'is-empty' : info.ok ? 'is-ok' : 'is-locked'}`;
        dest.innerHTML = !p
          ? `${icon('folder')}<span>Choose a folder below</span>`
          : `${icon(info.ok ? 'checkCircle' : 'lock')}<span class="mono truncate">/${esc(p)}</span><span class="dest-note">${info.ok ? 'Files go here' : 'No write permission yet'}</span>`;
      });
      const extPreview = $('[data-ext-preview]', el);
      const renderExts = () => {
        const { valid, invalid } = parseExtensions(form.exts.value);
        extPreview.innerHTML = !valid.length && !invalid.length
          ? `<span class="faint small">${icon('checkCircle', 'icon-sm')} All file types are allowed</span>`
          : valid.map((e) => `<span class="type-chip">.${esc(e)}</span>`).join('')
            + invalid.map((e) => `<span class="type-chip is-invalid" title="Invalid extension">${esc(e)}</span>`).join('');
      };
      form.exts.addEventListener('input', renderExts);
      $('.ext-presets', el).addEventListener('click', (e) => {
        if (e.target.closest('[data-preset-clear]')) form.exts.value = '';
        const btn = e.target.closest('[data-preset]');
        if (btn) {
          const preset = EXT_PRESETS.find(([label]) => label === btn.dataset.preset)[1];
          form.exts.value = parseExtensions(`${form.exts.value}, ${preset}`).valid.join(', ');
        }
        renderExts();
      });
      renderExts();
      $('[data-inline-user]', el).addEventListener('click', () => openUserModal({
        onCreated(user) {
          const selected = $$('input[name=userIds]:checked', form).map((i) => i.value).concat(user.id);
          $('#userChecks', el).innerHTML = userChecks(selected);
        },
      }));
      const save = async () => {
        const btn = $('#saveLink', el);
        if (!folder) { $('#linkError', el).textContent = 'Choose the folder where files will be saved'; return; }
        const exts = parseExtensions(form.exts.value);
        if (exts.invalid.length) { $('#linkError', el).textContent = `Invalid extension${exts.invalid.length === 1 ? '' : 's'}: ${exts.invalid.join(', ')}`; return; }
        const userIds = $$('input[name=userIds]:checked', form).map((i) => i.value);
        const payload = {
          name: form.name.value.trim(),
          folder,
          userIds,
          expiresAt: form.expires.value ? new Date(`${form.expires.value}T23:59:59`).getTime() : null,
          maxFileSize: form.maxMb.value ? Math.round(Number(form.maxMb.value) * 1048576) : null,
          allowedExtensions: exts.valid,
          active: form.active.checked,
        };
        setBusy(btn, true);
        try {
          const saved = editing ? await adminApi('PATCH', `/links/${l.id}`, payload) : await adminApi('POST', '/links', payload);
          close();
          await refresh();
          if (!editing) {
            toast('Link created');
            openShareModal(state.links.find((x) => x.id === saved.id) || saved, true);
          } else toast('Link saved');
        } catch (err) {
          $('#linkError', el).textContent = err.message;
          setBusy(btn, false);
        }
      };
      $('#saveLink', el).addEventListener('click', save);
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    },
  });
}

async function onPanelClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'new-link') return openLinkModal();
  if (action === 'new-user') return openUserModal();

  const card = btn.closest('[data-id]');
  const id = card && card.dataset.id;

  if (card && card.classList.contains('link-card')) {
    const link = state.links.find((l) => l.id === id);
    if (!link) return;
    if (action === 'copy') return copyText(fullUrl(link), 'Link copied');
    if (action === 'share') return openShareModal(link);
    if (action === 'edit') return openLinkModal(link);
    if (action === 'regenerate') {
      const ok = await confirmDialog('The current URL will stop working. You\'ll need to share the new link again.', { title: 'Generate a new URL?', confirmText: 'Generate', danger: false });
      if (!ok) return;
      try {
        const updated = await adminApi('POST', `/links/${id}/regenerate`);
        await refresh();
        copyText(fullUrl(updated), 'New URL copied');
      } catch (err) { toast(err.message, 'error'); }
    }
    if (action === 'delete') {
      const ok = await confirmDialog(`The link <b>${esc(link.name)}</b> will be deleted. Uploaded files stay on the NAS.`);
      if (!ok) return;
      try {
        await adminApi('DELETE', `/links/${id}`);
        await refresh();
        toast('Link deleted');
      } catch (err) { toast(err.message, 'error'); }
    }
  }

  if (card && card.tagName === 'TR') {
    const user = state.users.find((u) => u.id === id);
    if (!user) return;
    if (action === 'password') return openPasswordModal(user);
    if (action === 'delete-user') {
      const ok = await confirmDialog(`<b>${esc(user.username)}</b> immediately loses access to all links.`);
      if (!ok) return;
      try {
        await adminApi('DELETE', `/users/${id}`);
        await refresh();
        toast('User deleted');
      } catch (err) { toast(err.message, 'error'); }
    }
  }
}

async function onPanelChange(e) {
  if (e.target.dataset.action !== 'toggle') return;
  const card = e.target.closest('[data-id]');
  try {
    await adminApi('PATCH', `/links/${card.dataset.id}`, { active: e.target.checked });
    await refresh();
    toast(e.target.checked ? 'Link activated' : 'Link deactivated', 'info');
  } catch (err) {
    e.target.checked = !e.target.checked;
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
function renderUsers() {
  if (!state.users.length) {
    return `<div class="card empty">
      <div class="empty-icon">${icon('users')}</div>
      <h3>No users yet</h3>
      <p class="muted">Users log in to an upload link with their username and password.</p>
      <button class="btn btn-primary" data-action="new-user">${icon('plus')}New user</button>
    </div>`;
  }
  const users = state.users.filter((u) => matches(u.username, ...u.links.map((l) => l.name)));
  if (!users.length) return noResults();
  return `<div class="card table-wrap"><table>
    <thead><tr><th>User</th><th>Links</th><th class="hide-sm">Created</th><th></th></tr></thead>
    <tbody>${users.map((u) => `
      <tr data-id="${esc(u.id)}">
        <td><div class="user-cell"><span class="avatar avatar-lg">${initials(u.username)}</span>${esc(u.username)}</div></td>
        <td><div class="chips">${u.links.map((l) => `<span class="badge badge-accent">${icon('link')}${esc(l.name)}</span>`).join('') || '<span class="faint small">—</span>'}</div></td>
        <td class="muted hide-sm">${formatDate(u.createdAt, false)}</td>
        <td class="actions">
          <button class="btn-icon" data-action="password" title="Change password">${icon('key')}</button>
          <button class="btn-icon danger" data-action="delete-user" title="Delete">${icon('trash')}</button>
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------
// Without confusable characters (0/O, 1/l/I) so passwords are easy to copy by hand.
const PW_SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%&*-_=+?',
};

function randomInt(n) {
  // Rejection sampling: no modulo bias
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

function generatePassword(length = 24, symbols = true) {
  const sets = [PW_SETS.lower, PW_SETS.upper, PW_SETS.digits];
  if (symbols) sets.push(PW_SETS.symbols);
  const all = sets.join('');
  const chars = sets.map((set) => set[randomInt(set.length)]); // each type at least once
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function passwordStrength(pw) {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 20;
  const bits = Math.round(pw.length * Math.log2(pool || 1));
  if (pw.length < 8) return { level: 0, label: 'Too short — at least 8 characters' };
  if (bits < 50) return { level: 1, label: 'Weak' };
  if (bits < 75) return { level: 2, label: 'Fair' };
  if (bits < 110) return { level: 3, label: 'Strong' };
  return { level: 4, label: 'Very strong' };
}

function passwordField() {
  return `<div class="field pw-field">
    <div class="field-head"><span>Password</span><span class="pw-label" data-pw-label></span></div>
    <div class="pw-box">
      <input class="input input-mono pw-input" name="password" type="text" autocomplete="new-password" spellcheck="false" autocapitalize="off" required>
      <div class="pw-inline">
        <button type="button" class="btn-icon" data-pw="toggle" title="Hide">${icon('eyeOff')}</button>
        <button type="button" class="btn-icon" data-pw="copy" title="Copy">${icon('copy')}</button>
      </div>
    </div>
    <div class="pw-meter" data-fill="0" data-level="0"><i></i><i></i><i></i><i></i></div>
    <div class="pw-options">
      <button type="button" class="btn btn-sm btn-soft" data-pw="generate">${icon('refresh', 'icon-sm')}Generate password</button>
      <label class="pw-length"><span>Length</span><input type="range" min="12" max="64" value="24" data-pw-length><b data-pw-length-value>24</b></label>
      <label class="switch switch-sm"><input type="checkbox" checked data-pw-symbols><span class="track"></span><span>Symbols</span></label>
    </div>
  </div>`;
}

function wirePasswordField(el, form) {
  const input = form.password;
  const len = $('[data-pw-length]', el);
  const sym = $('[data-pw-symbols]', el);
  const meter = $('.pw-meter', el);
  const label = $('[data-pw-label]', el);
  const gen = $('[data-pw="generate"]', el);
  const toggle = $('[data-pw="toggle"]', el);

  const update = () => {
    const { level, label: text } = passwordStrength(input.value);
    meter.dataset.level = level;
    meter.dataset.fill = input.value ? Math.max(1, level) : 0;
    label.dataset.level = level;
    label.textContent = input.value ? `${text} · ${input.value.length} characters` : '';
  };
  const restart = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
  const generate = () => {
    input.value = generatePassword(Number(len.value), sym.checked);
    restart(gen, 'spin');
    restart(input, 'flash');
    update();
  };

  gen.addEventListener('click', generate);
  len.addEventListener('input', () => { $('[data-pw-length-value]', el).textContent = len.value; generate(); });
  sym.addEventListener('change', generate);
  input.addEventListener('input', update);
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.innerHTML = icon(show ? 'eyeOff' : 'eye');
    toggle.title = show ? 'Hide' : 'Show';
  });
  $('[data-pw="copy"]', el).addEventListener('click', () => { if (input.value) copyText(input.value, 'Password copied'); });
  generate();
}

// ---------------------------------------------------------------------------
// Invite & share
// ---------------------------------------------------------------------------
function inviteText({ username, password, links }) {
  const lines = ['Hi,', ''];
  if (links.length === 1) lines.push('You can upload files using this link:', fullUrl(links[0]));
  else if (links.length) lines.push('You can upload files using these links:', ...links.map((l) => `• ${l.name}: ${fullUrl(l)}`));
  lines.push('');
  if (password) lines.push('Log in with:', `Username: ${username}`, `Password: ${password}`);
  else lines.push('You\'ll receive your username and password separately.');
  lines.push('', 'Drag your files or folders into the window. Please wait until everything shows "Uploaded" before closing the page.', '', 'Best regards');
  return lines.join('\n');
}

function mailtoHref(subject, body) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function copyRow(label, value, iconName) {
  return `<div class="cred-row">
    <div class="cred-icon">${icon(iconName)}</div>
    <div class="grow"><div class="cred-label">${esc(label)}</div><div class="cred-value mono">${esc(value)}</div></div>
    <button type="button" class="btn-icon" data-copy="${esc(value)}" title="Copy">${icon('copy')}</button>
  </div>`;
}

function wireCopyButtons(el) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    copyText(btn.dataset.copy);
    btn.innerHTML = icon('check');
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = icon('copy'); btn.classList.remove('copied'); }, 1400);
  });
}

function inviteBlock(text) {
  return `<div class="field">
      <div class="field-head"><span>Invitation</span><span class="faint small">Ready to send</span></div>
      <textarea class="input invite" readonly rows="8">${esc(text)}</textarea>
    </div>`;
}

function inviteFooter(text, subject) {
  return `<button class="btn btn-ghost" data-close>Done</button>
    <a class="btn" href="${esc(mailtoHref(subject, text))}">${icon('mail')}Email</a>
    <button type="button" class="btn btn-primary" data-copy-invite>${icon('copy')}Copy invitation</button>`;
}

function showCredentials(user, password) {
  const links = state.links.filter((l) => l.userIds.includes(user.id));
  const text = inviteText({ username: user.username, password, links });
  openModal({
    title: 'User created',
    body: `<div class="form-grid">
      <div class="success-head">
        <div class="success-icon">${icon('check')}</div>
        <div><b>${esc(user.username)}</b><div class="muted small">Save or share these details now. The password can't be viewed again later.</div></div>
      </div>
      <div class="cred-list">
        ${copyRow('Username', user.username, 'user')}
        ${copyRow('Password', password, 'key')}
      </div>
      ${links.length ? inviteBlock(text) : `<div class="tip">${icon('sparkles')}<div class="small">Assign this user to a link and we'll create an invitation you can send.</div></div>`}
    </div>`,
    footer: links.length ? inviteFooter(text, 'Your upload link') : `<button class="btn btn-primary" data-close>Done</button>`,
    onMount(el) {
      wireCopyButtons(el);
      const btn = $('[data-copy-invite]', el);
      if (btn) btn.addEventListener('click', () => copyText(text, 'Invitation copied'));
    },
  });
}

function openShareModal(link, justCreated = false) {
  const url = fullUrl(link);
  const text = inviteText({ username: '', password: '', links: [link] });
  openModal({
    title: justCreated ? 'Your link is ready to share' : 'Share link',
    body: `<div class="form-grid">
      <div class="share-url">
        <div class="link-icon">${icon('link')}</div>
        <div class="grow"><div class="cred-label">${esc(link.name)}</div><div class="cred-value mono">${esc(url)}</div></div>
        <button type="button" class="btn btn-primary btn-sm" data-copy-url>${icon('copy', 'icon-sm')}Copy</button>
      </div>
      ${link.users.length ? `<div class="field"><span>Access for</span><div class="chips">${link.users.map((u) => `<span class="chip"><span class="avatar">${initials(u.username)}</span>${esc(u.username)}</span>`).join('')}</div></div>` : ''}
      ${inviteBlock(text)}
      <p class="faint small">${icon('shield', 'icon-sm')} Preferably send the password through a different channel than the link.</p>
    </div>`,
    footer: inviteFooter(text, `Upload link: ${link.name}`),
    onMount(el) {
      $('[data-copy-url]', el).addEventListener('click', () => copyText(url, 'Link copied'));
      $('[data-copy-invite]', el).addEventListener('click', () => copyText(text, 'Invitation copied'));
    },
  });
}

// ---------------------------------------------------------------------------
// Create / edit users
// ---------------------------------------------------------------------------
const USERNAME_RE = /^[a-zA-Z0-9._@-]{2,64}$/;

function openUserModal({ onCreated } = {}) {
  const showLinks = !onCreated && state.links.length > 0;
  openModal({
    title: 'New user',
    wide: true,
    body: `<form class="form-grid" id="userForm" autocomplete="off">
      <label class="field"><span>Username</span>
        <input class="input" name="username" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="e.g. jansen or name@company.com">
        <span class="hint" data-user-hint>Letters, digits and . _ @ - (2–64 characters)</span>
      </label>
      ${passwordField()}
      ${showLinks ? `<div class="field"><span>Give access to <span class="faint">(optional)</span></span>
        <div class="check-list">${state.links.map((l) => `
          <label class="check-item"><input type="checkbox" name="linkIds" value="${esc(l.id)}">${icon('link', 'icon-sm')}<span class="truncate">${esc(l.name)}</span></label>`).join('')}
        </div></div>` : ''}
      <div class="form-error" id="userError"></div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="saveUser">${icon('check')}Create user</button>`,
    onMount(el, close) {
      const form = $('#userForm', el);
      wirePasswordField(el, form);
      const hint = $('[data-user-hint]', el);
      form.username.addEventListener('input', () => {
        const v = form.username.value.trim();
        const taken = state.users.some((u) => u.username.toLowerCase() === v.toLowerCase());
        hint.classList.toggle('hint-error', !!v && (taken || !USERNAME_RE.test(v)));
        hint.textContent = !v || USERNAME_RE.test(v)
          ? (taken ? 'This username already exists' : 'Letters, digits and . _ @ - (2–64 characters)')
          : 'Only letters, digits and . _ @ - allowed (2–64 characters)';
      });

      const save = async () => {
        const btn = $('#saveUser', el);
        const username = form.username.value.trim();
        const password = form.password.value;
        if (password.length < 8) { $('#userError', el).textContent = 'Password must be at least 8 characters'; return; }
        setBusy(btn, true);
        try {
          const user = await adminApi('POST', '/users', { username, password });
          const linkIds = $$('input[name=linkIds]:checked', form).map((i) => i.value);
          for (const id of linkIds) {
            const link = state.links.find((l) => l.id === id);
            await adminApi('PATCH', `/links/${id}`, { userIds: [...link.userIds, user.id] });
          }
          close();
          await refresh();
          if (onCreated) onCreated(user);
          showCredentials(user, password);
        } catch (err) {
          $('#userError', el).textContent = err.message;
          setBusy(btn, false);
        }
      };
      $('#saveUser', el).addEventListener('click', save);
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    },
  });
}

function openPasswordModal(user) {
  openModal({
    title: 'New password',
    body: `<form class="form-grid" id="pwForm">
      <div class="user-cell"><span class="avatar avatar-lg">${initials(user.username)}</span>${esc(user.username)}</div>
      ${passwordField()}
      <div class="tip">${icon('shield')}<div class="small">Active sessions of this user are logged out immediately.</div></div>
      <div class="form-error" id="pwError"></div>
    </form>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="savePw">${icon('check')}Save password</button>`,
    onMount(el, close) {
      const form = $('#pwForm', el);
      wirePasswordField(el, form);
      const save = async () => {
        const btn = $('#savePw', el);
        const password = form.password.value;
        if (password.length < 8) { $('#pwError', el).textContent = 'Password must be at least 8 characters'; return; }
        setBusy(btn, true);
        try {
          await adminApi('PATCH', `/users/${user.id}`, { password });
          close();
          await refresh();
          showCredentials(user, password);
        } catch (err) {
          $('#pwError', el).textContent = err.message;
          setBusy(btn, false);
        }
      };
      $('#savePw', el).addEventListener('click', save);
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    },
  });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
function fileIconName(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (/^(jpe?g|png|gif|webp|heic|heif|tiff?|bmp|svg|raw|cr2|nef|arw|dng)$/.test(ext)) return 'image';
  if (/^(mp4|mov|avi|mkv|webm|m4v|wmv|mts)$/.test(ext)) return 'video';
  if (/^(mp3|wav|flac|aac|m4a|ogg|aiff?)$/.test(ext)) return 'music';
  if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|iso)$/.test(ext)) return 'archive';
  if (/^(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|csv|md|pages|numbers|key)$/.test(ext)) return 'fileText';
  return 'file';
}

function renderActivity() {
  if (!state.activity.length) {
    return `<div class="card empty">
      <div class="empty-icon">${icon('activity')}</div>
      <h3>No uploads yet</h3>
      <p class="muted">As soon as someone uploads something through a link, you'll see it here.</p>
    </div>`;
  }
  const activity = state.activity.filter((a) => matches(a.file, a.username, a.linkName));
  if (!activity.length) return noResults();
  return `<div class="card table-wrap"><table>
    <thead><tr><th>File</th><th>User</th><th class="hide-sm">Link</th><th>Size</th><th class="hide-sm">Time</th></tr></thead>
    <tbody>${activity.map((a) => `
      <tr>
        <td><div class="file-cell">${icon(fileIconName(a.file))}<span class="truncate" title="/${esc(a.folder ? `${a.folder}/` : '')}${esc(a.file)}">${esc(a.file)}</span></div></td>
        <td><span class="chip"><span class="avatar">${initials(a.username)}</span>${esc(a.username)}</span></td>
        <td class="muted hide-sm">${esc(a.linkName)}</td>
        <td class="muted" style="white-space:nowrap">${formatBytes(a.size)}</td>
        <td class="muted hide-sm" style="white-space:nowrap" title="${esc(formatDate(a.at))}">${timeAgo(a.at)}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderSettings() {
  const o = state.overview;
  return `<div class="card settings-card">
    <form class="form-grid" id="settingsForm">
      <div>
        <h3>Public address</h3>
        <p class="muted small">The address people outside your network use to reach Upload Portal. It's used in the links you share.</p>
      </div>
      <label class="field"><span>Base URL</span>
        <input class="input input-mono" name="publicUrl" value="${esc(o.publicUrl)}" placeholder="https://upload.example.com">
        <span class="hint">Leave empty = <span class="mono">${esc(`http://${location.hostname}:${o.port}`)}</span> (local network only)</span>
      </label>
      <div class="tip">
        ${icon('sparkles')}
        <div class="small"><b>Tip:</b> in DSM, go to <i>Control Panel → Login Portal → Advanced → Reverse Proxy</i> and create a rule from
        <span class="mono">https://upload.example.com:443</span> to <span class="mono">http://localhost:${o.port}</span>, then attach a Let's Encrypt certificate. Enter that address here.</div>
      </div>
      <div class="form-error" id="settingsError"></div>
      <div><button class="btn btn-primary" type="submit">${icon('check')}Save</button></div>
    </form>
  </div>
  <div class="card settings-card">
    <h3>Storage</h3>
    <p class="muted small">For each link you choose the folder on your NAS where files are saved. Upload Portal needs write permission on the shared folder; you can grant it with one click in a link's folder picker.</p>
  </div>`;
}

function wireSettings() {
  const form = $('#settingsForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    setBusy(btn, true);
    $('#settingsError').textContent = '';
    try {
      await adminApi('PUT', '/settings', { publicUrl: form.publicUrl.value });
      await refresh();
      toast('Settings saved');
    } catch (err) {
      $('#settingsError').textContent = err.message;
      setBusy(btn, false);
    }
  });
}

// ---------------------------------------------------------------------------
async function boot() {
  try {
    state.me = (await adminApi('GET', '/me')).username;
    showApp();
  } catch (err) {
    showFatal(err);
  }
}
boot();
