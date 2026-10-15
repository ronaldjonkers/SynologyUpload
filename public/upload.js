/* Upload page */
'use strict';

const TOKEN = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
const API = `/api/l/${encodeURIComponent(TOKEN)}`;
const CONCURRENCY = 3;
const MAX_RETRIES = 5;
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

let info = null;
let chunkSize = 8 * 1024 * 1024;
let items = [];
let active = 0;
let seq = 0;
let samples = [];
let tickTimer = null;
let batch = null; // { start, startBytes } for average speed

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function showError(message) {
  document.title = 'Link unavailable';
  $('#app').innerHTML = `
    <div class="card state-card">
      <div class="empty-icon danger">${icon('alert')}</div>
      <h2>Link unavailable</h2>
      <p class="muted">${esc(message)}</p>
    </div>`;
}

function showLogin() {
  document.title = `Log in · ${info.name}`;
  $('#app').innerHTML = `
    <div class="auth-wrap">
      <form class="card auth-card" id="loginForm">
        <div class="brand-mark">${icon('lock')}</div>
        <h1>${esc(info.name)}</h1>
        <p class="muted">Log in to upload files</p>
        <label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" autocapitalize="none" required></label>
        <label class="field"><span>Password</span>
          <div class="pw-login">
            <input class="input" type="password" name="password" autocomplete="current-password" spellcheck="false" required>
            <button type="button" class="btn-icon" id="pwToggle" title="Show password">${icon('eye')}</button>
          </div>
          <span class="caps-hint" id="capsHint">Caps Lock is on</span>
        </label>
        <div class="form-error" id="loginError"></div>
        <button class="btn btn-primary btn-block" type="submit">Log in</button>
      </form>
    </div>`;
  const form = $('#loginForm');
  setTimeout(() => form.username.focus(), 50);
  $('#pwToggle').addEventListener('click', () => {
    const show = form.password.type === 'password';
    form.password.type = show ? 'text' : 'password';
    $('#pwToggle').innerHTML = icon(show ? 'eyeOff' : 'eye');
    $('#pwToggle').title = show ? 'Hide password' : 'Show password';
  });
  form.password.addEventListener('keyup', (e) => {
    $('#capsHint').classList.toggle('show', !!(e.getModifierState && e.getModifierState('CapsLock')));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    $('#loginError').textContent = '';
    try {
      const res = await api('POST', `${API}/login`, { username: form.username.value, password: form.password.value });
      info.user = res.user;
      showUploader();
    } catch (err) {
      $('#loginError').textContent = err.message;
      btn.disabled = false;
    }
  });
}

function showUploader() {
  document.title = `Upload · ${info.name}`;
  const limit = info.maxFileSize ? ` · max. ${formatBytes(info.maxFileSize)} per file` : '';
  const exts = info.allowedExtensions || [];
  const typesHtml = exts.length
    ? `<div class="dz-types">${icon('file', 'icon-sm')}<span>Allowed:</span>${exts.map((e) => `<span class="type-chip">.${esc(e)}</span>`).join('')}</div>`
    : '';
  $('#app').innerHTML = `
    <div class="upload-page">
      <header class="up-header">
        <div class="brand">
          <div class="brand-mark brand-mark-sm">${icon('cloudUpload')}</div>
          <div><div class="eyebrow">Upload to</div><h1>${esc(info.name)}</h1></div>
        </div>
        <div class="user-pill">
          <span class="avatar avatar-lg">${initials(info.user)}</span>${esc(info.user)}
          <button class="btn-icon" id="logoutBtn" title="Log out">${icon('logout', 'icon-sm')}</button>
        </div>
      </header>

      <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Choose files or drag them here">
        <input type="file" id="fileInput" multiple hidden${exts.length ? ` accept="${esc(exts.map((e) => `.${e}`).join(','))}"` : ''}>
        <input type="file" id="dirInput" webkitdirectory multiple hidden>
        <div class="dz-icon">${icon('cloudUpload')}</div>
        <h2>Drag files or folders here</h2>
        <p class="muted">or choose them from your device${limit}</p>
        ${typesHtml}
        <div class="dz-actions">
          <button type="button" class="btn btn-primary btn-lg" id="pickFiles">${icon('file')}Choose files</button>
          <button type="button" class="btn btn-lg" id="pickDir">${icon('folder')}Choose folder</button>
        </div>
      </div>

      <section class="card summary hidden" id="summary">
        <div class="summary-top">
          <div class="grow">
            <div class="summary-title" id="sumTitle">Uploading…</div>
            <div class="muted small" id="sumSub"></div>
          </div>
          <div class="summary-pct" id="sumPct">0%</div>
        </div>
        <div class="progress progress-lg" id="sumProgress"><div class="progress-bar" id="sumBar"></div></div>
        <div class="summary-stats">
          <div class="mini-stat">${icon('zap')}<div><b id="sumSpeed">—</b><small id="sumSpeedLabel">Speed</small></div></div>
          <div class="mini-stat">${icon('clock')}<div><b id="sumEta">—</b><small id="sumEtaLabel">Remaining</small></div></div>
          <div class="mini-stat">${icon('checkCircle')}<div><b id="sumDone">0</b><small>Completed</small></div></div>
        </div>
        <div class="summary-actions">
          <button class="btn btn-sm btn-ghost" id="clearDone">${icon('check', 'icon-sm')}Clear completed</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm hidden" id="retryAll">${icon('refresh', 'icon-sm')}Retry failed</button>
            <button class="btn btn-sm btn-danger hidden" id="cancelAll">${icon('x', 'icon-sm')}Cancel all</button>
          </div>
        </div>
      </section>

      <section class="file-list" id="fileList"></section>

      <footer class="page-foot">${icon('lock')}Files are stored directly and privately on the NAS</footer>
    </div>`;

  wireUploader();
}

// ---------------------------------------------------------------------------
// Drag & drop / file selection
// ---------------------------------------------------------------------------
function wireUploader() {
  const dz = $('#dropzone');
  const fileInput = $('#fileInput');
  const dirInput = $('#dirInput');

  $('#pickFiles').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  $('#pickDir').addEventListener('click', (e) => { e.stopPropagation(); dirInput.click(); });
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });

  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files].map((f) => ({ file: f, relPath: f.name })));
    fileInput.value = '';
  });
  dirInput.addEventListener('change', () => {
    addFiles([...dirInput.files].map((f) => ({ file: f, relPath: f.webkitRelativePath || f.name })));
    dirInput.value = '';
  });

  // Dragging works across the whole page
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    dz.classList.add('is-over');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) dz.classList.remove('is-over');
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dz.classList.remove('is-over');
    try {
      addFiles(await filesFromDataTransfer(e.dataTransfer));
    } catch (err) {
      toast("Couldn't read the dropped files", 'error');
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    if (isBusy() && !confirm('Uploads are still running. Log out anyway?')) return;
    items.forEach((it) => { if (it.status === 'uploading' || it.status === 'queued') cancelItem(it); });
    await api('POST', `${API}/logout`).catch(() => {});
    info.user = null;
    items = [];
    showLogin();
  });

  $('#clearDone').addEventListener('click', () => {
    items = items.filter((it) => {
      const keep = !['done', 'canceled'].includes(it.status);
      if (!keep) it.el.remove();
      return keep;
    });
    updateSummary();
  });
  $('#retryAll').addEventListener('click', () => items.filter((it) => it.status === 'error' && !it.fatal).forEach(retryItem));
  $('#cancelAll').addEventListener('click', () => items.forEach((it) => { if (it.status === 'uploading' || it.status === 'queued') cancelItem(it); }));

  $('#fileList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const it = items.find((x) => x.id === Number(btn.closest('.file-row').dataset.id));
    if (!it) return;
    if (btn.dataset.act === 'cancel') cancelItem(it);
    else if (btn.dataset.act === 'retry') retryItem(it);
    else if (btn.dataset.act === 'remove') {
      items = items.filter((x) => x !== it);
      it.el.remove();
      updateSummary();
    }
  });
}

async function filesFromDataTransfer(dt) {
  // Entries must be fetched synchronously, before the first await.
  const entries = [...(dt.items || [])]
    .filter((i) => i.kind === 'file')
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.length) return [...dt.files].map((f) => ({ file: f, relPath: f.name }));

  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, relPath: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  }
  for (const entry of entries) await walk(entry, '');
  return out;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
function fileType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (/^(jpe?g|png|gif|webp|heic|heif|tiff?|bmp|svg|raw|cr2|cr3|nef|arw|dng|orf|rw2)$/.test(ext)) return ['image', 't-image'];
  if (/^(mp4|mov|avi|mkv|webm|m4v|wmv|mts|m2ts|3gp)$/.test(ext)) return ['video', 't-video'];
  if (/^(mp3|wav|flac|aac|m4a|ogg|aiff?|wma)$/.test(ext)) return ['music', 't-audio'];
  if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|iso)$/.test(ext)) return ['archive', 't-archive'];
  if (/^(pdf|docx?|xlsx?|pptx?|txt|rtf|odt|ods|csv|md|pages|numbers|key)$/.test(ext)) return ['fileText', 't-doc'];
  return ['file', ''];
}

function allowedTypesText() {
  const exts = info.allowedExtensions || [];
  if (exts.length === 1) return `only .${exts[0]} files`;
  return `only ${exts.slice(0, -1).map((e) => `.${e}`).join(', ')} or .${exts[exts.length - 1]}`;
}

function typeAllowed(name) {
  const exts = info.allowedExtensions || [];
  const lower = name.toLowerCase();
  return !exts.length || exts.some((e) => lower.endsWith(`.${e}`));
}

function addFiles(list) {
  list = list.filter(({ file }) => !IGNORED.has(file.name));
  if (!list.length) return;
  let rejectedTypes = 0;
  const frag = document.createDocumentFragment();
  for (const { file, relPath } of list) {
    const it = {
      id: ++seq,
      file,
      relPath,
      size: file.size,
      loaded: 0,
      status: 'queued',
      speed: 0,
      lastLoaded: 0,
      serverId: null,
      xhr: null,
      error: '',
      fatal: false,
    };
    if (!typeAllowed(file.name)) {
      it.status = 'error';
      it.fatal = true;
      it.error = `File type not allowed — ${allowedTypesText()}`;
      rejectedTypes++;
    } else if (info.maxFileSize && file.size > info.maxFileSize) {
      it.status = 'error';
      it.fatal = true;
      it.error = `Too large (max. ${formatBytes(info.maxFileSize)})`;
    }
    it.el = createRow(it);
    frag.appendChild(it.el);
    items.push(it);
    renderRow(it);
  }
  $('#fileList').prepend(frag);
  const accepted = list.length - rejectedTypes;
  if (rejectedTypes) {
    toast(`${rejectedTypes} ${rejectedTypes === 1 ? 'file' : 'files'} skipped: ${allowedTypesText()} allowed`, 'error');
  }
  if (accepted) toast(`${accepted} ${accepted === 1 ? 'file' : 'files'} added`, 'info');
  startTicker();
  pump();
  updateSummary();
}

function createRow(it) {
  const [ic, cls] = fileType(it.file.name);
  const el = document.createElement('div');
  el.className = 'file-row';
  el.dataset.id = it.id;
  el.innerHTML = `
    <div class="file-icon ${cls}">${icon(ic)}</div>
    <div class="file-main">
      <div class="file-top"><span class="file-name" title="${esc(it.file.name)}">${esc(it.file.name)}</span><span class="file-size">${formatBytes(it.size)}</span></div>
      <div class="progress"><div class="progress-bar"></div></div>
      <div class="file-status"><span class="st-left"></span><span class="st-right"></span></div>
    </div>
    <button class="btn-icon" data-act="cancel" title="Cancel">${icon('x')}</button>`;
  it.ui = {
    progress: $('.progress', el),
    bar: $('.progress-bar', el),
    left: $('.st-left', el),
    right: $('.st-right', el),
    btn: $('[data-act]', el),
  };
  return el;
}

function setButton(it, act, ic, title) {
  if (it.ui.btn.dataset.act === act) return;
  it.ui.btn.dataset.act = act;
  it.ui.btn.title = title;
  it.ui.btn.innerHTML = icon(ic);
  it.ui.btn.classList.toggle('danger', act === 'cancel');
}

function renderRow(it) {
  const pct = it.size ? Math.min(100, (it.loaded / it.size) * 100) : it.status === 'done' ? 100 : 0;
  const { progress, bar, left, right } = it.ui;
  bar.style.width = `${pct}%`;
  progress.classList.toggle('is-active', it.status === 'uploading');
  progress.classList.toggle('is-done', it.status === 'done');
  progress.classList.toggle('is-error', it.status === 'error');
  it.el.classList.toggle('is-error', it.status === 'error');
  it.el.classList.toggle('is-canceled', it.status === 'canceled');

  switch (it.status) {
    case 'queued':
      left.textContent = 'Queued';
      right.textContent = '';
      setButton(it, 'cancel', 'x', 'Cancel');
      break;
    case 'uploading': {
      const remaining = it.speed > 0 ? formatDuration((it.size - it.loaded) / it.speed) : '';
      left.textContent = `${Math.floor(pct)}% · ${formatBytes(it.loaded)} of ${formatBytes(it.size)}`;
      right.textContent = it.speed > 0 ? `${formatBytes(it.speed)}/s · ${remaining} left` : 'Starting…';
      setButton(it, 'cancel', 'x', 'Cancel');
      break;
    }
    case 'finishing':
      left.textContent = 'Finishing…';
      right.textContent = '';
      break;
    case 'done':
      left.innerHTML = `<span class="ok">${icon('check')}Uploaded</span>`;
      right.textContent = it.finalName && it.finalName !== it.file.name ? `saved as ${it.finalName}` : '';
      setButton(it, 'remove', 'x', 'Remove from list');
      break;
    case 'error':
      left.innerHTML = `<span class="err">${esc(it.error || 'Failed')}</span>`;
      right.textContent = '';
      if (it.fatal) setButton(it, 'remove', 'x', 'Remove from list');
      else setButton(it, 'retry', 'refresh', 'Retry');
      break;
    case 'canceled':
      left.textContent = 'Cancelled';
      right.textContent = '';
      setButton(it, 'retry', 'refresh', 'Retry');
      break;
  }
}

function pump() {
  while (active < CONCURRENCY) {
    const next = items.find((it) => it.status === 'queued');
    if (!next) break;
    uploadItem(next);
  }
}

function isBusy() {
  return items.some((it) => ['queued', 'uploading', 'finishing'].includes(it.status));
}

// ---------------------------------------------------------------------------
// Chunked upload
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadItem(it) {
  active++;
  it.status = 'uploading';
  it.loaded = 0;
  it.lastLoaded = 0;
  it.speed = 0;
  it.error = '';
  renderRow(it);
  try {
    const init = await api('POST', `${API}/uploads`, { name: it.file.name, size: it.size, relPath: it.relPath });
    it.serverId = init.id;
    const size = init.chunkSize || chunkSize;
    let offset = 0;
    while (offset < it.size) {
      if (it.status === 'canceled') throw new Error('canceled');
      const end = Math.min(offset + size, it.size);
      const res = await sendChunkWithRetry(it, offset, end);
      offset = res.received;
      it.loaded = offset;
    }
    if (it.status === 'canceled') throw new Error('canceled');
    it.status = 'finishing';
    renderRow(it);
    const done = await api('POST', `${API}/uploads/${it.serverId}/complete`);
    it.status = 'done';
    it.loaded = it.size;
    it.finalName = done.name;
  } catch (err) {
    if (it.status !== 'canceled') {
      it.status = 'error';
      it.error = err.status === 401 ? 'Session expired — please log in again' : err.message || 'Upload failed';
      if (err.status === 415 || err.status === 413) it.fatal = true;
      if (it.serverId) api('DELETE', `${API}/uploads/${it.serverId}`).catch(() => {});
    }
    it.serverId = null;
  } finally {
    it.xhr = null;
    active--;
    renderRow(it);
    updateSummary();
    pump();
    if (!isBusy()) onAllFinished();
  }
}

async function sendChunkWithRetry(it, offset, end) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await sendChunk(it, offset, end);
    } catch (err) {
      if (it.status === 'canceled') throw err;
      lastErr = err;
      // Server is at a different offset: resume from there
      if (err.status === 409 && err.data && Number.isFinite(err.data.received)) return { received: err.data.received };
      if ([401, 403, 404, 413, 415, 507].includes(err.status)) throw err;
      it.ui.right.textContent = `Connection lost, retrying (${attempt + 1}/${MAX_RETRIES})…`;
      await sleep(Math.min(15000, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

function sendChunk(it, offset, end) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    it.xhr = xhr;
    xhr.open('PUT', `${API}/uploads/${it.serverId}?offset=${offset}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { it.loaded = offset + e.loaded; };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = new Error((data && data.error) || `Server error (${xhr.status})`);
      err.status = xhr.status;
      err.data = data;
      it.loaded = offset;
      reject(err);
    };
    xhr.onerror = () => { it.loaded = offset; reject(new Error('Network error')); };
    xhr.onabort = () => { it.loaded = offset; reject(new Error('canceled')); };
    xhr.send(it.file.slice(offset, end));
  });
}

function cancelItem(it) {
  if (!['queued', 'uploading', 'finishing'].includes(it.status)) return;
  const wasUploading = it.status !== 'queued';
  it.status = 'canceled';
  if (it.xhr) it.xhr.abort();
  if (wasUploading && it.serverId) api('DELETE', `${API}/uploads/${it.serverId}`).catch(() => {});
  it.loaded = 0;
  renderRow(it);
  updateSummary();
}

function retryItem(it) {
  if (it.fatal) return;
  it.status = 'queued';
  it.loaded = 0;
  it.error = '';
  renderRow(it);
  startTicker();
  pump();
  updateSummary();
}

// ---------------------------------------------------------------------------
// Speed & summary
// ---------------------------------------------------------------------------
function counted() {
  return items.filter((it) => it.status !== 'canceled' && !it.fatal);
}

function loadedTotal() {
  return counted().reduce((sum, it) => sum + (it.status === 'done' ? it.size : it.loaded), 0);
}

function startTicker() {
  if (tickTimer) return;
  samples = [];
  batch = { start: performance.now(), startBytes: loadedTotal(), end: 0, endBytes: 0 };
  let last = performance.now();
  tickTimer = setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    for (const it of items) {
      if (it.status !== 'uploading') continue;
      const inst = Math.max(0, (it.loaded - it.lastLoaded) / dt);
      it.speed = it.speed ? it.speed * 0.75 + inst * 0.25 : inst;
      it.lastLoaded = it.loaded;
      renderRow(it);
    }
    updateSummary();
    if (!isBusy()) stopTicker();
  }, 400);
}

function stopTicker() {
  clearInterval(tickTimer);
  tickTimer = null;
  if (batch && !batch.end) {
    batch.end = performance.now();
    batch.endBytes = loadedTotal();
  }
}

function currentSpeed() {
  // Average over the last 5 seconds: stable but responsive
  const now = performance.now();
  const total = counted().reduce((s, it) => s + (it.status === 'done' ? it.size : it.loaded), 0);
  samples.push({ t: now, bytes: total });
  while (samples.length > 2 && now - samples[0].t > 5000) samples.shift();
  if (samples.length < 2) return 0;
  const first = samples[0];
  const dt = (now - first.t) / 1000;
  return dt > 0 ? Math.max(0, (total - first.bytes) / dt) : 0;
}

function updateSummary() {
  const summary = $('#summary');
  if (!summary) return;
  const list = counted();
  $('#dropzone').classList.toggle('is-compact', items.length > 0);
  if (!items.length) {
    summary.classList.add('hidden');
    return;
  }
  summary.classList.remove('hidden');

  const totalBytes = list.reduce((s, it) => s + it.size, 0);
  const loadedBytes = list.reduce((s, it) => s + (it.status === 'done' ? it.size : it.loaded), 0);
  const doneCount = list.filter((it) => it.status === 'done').length;
  // Skipped = rejected up front (type/size); errors = uploads that actually failed
  const skipped = items.filter((it) => it.status === 'error' && it.fatal).length;
  const errCount = items.filter((it) => it.status === 'error' && !it.fatal).length;
  const retryable = items.filter((it) => it.status === 'error' && !it.fatal).length;
  const busy = isBusy();
  const pct = totalBytes ? (loadedBytes / totalBytes) * 100 : list.length && doneCount === list.length ? 100 : 0;

  $('#sumBar').style.width = `${pct}%`;
  $('#sumPct').textContent = `${Math.floor(pct)}%`;
  $('#sumProgress').classList.toggle('is-active', busy);
  $('#sumProgress').classList.toggle('is-done', !busy && doneCount > 0 && !errCount);
  $('#sumDone').textContent = `${doneCount} / ${list.length}`;
  $('#sumSub').textContent = `${formatBytes(loadedBytes)} of ${formatBytes(totalBytes)}${errCount ? ` · ${errCount} failed` : ''}${skipped ? ` · ${skipped} skipped` : ''}`;

  if (busy) {
    const speed = tickTimer ? currentSpeed() : 0;
    $('#sumTitle').textContent = `Uploading ${list.length - doneCount} ${list.length - doneCount === 1 ? 'file' : 'files'}`;
    $('#sumSpeed').textContent = speed > 0 ? `${formatBytes(speed)}/s` : '—';
    $('#sumEta').textContent = speed > 0 ? formatDuration((totalBytes - loadedBytes) / speed) : '—';
    $('#sumSpeedLabel').textContent = 'Speed';
    $('#sumEtaLabel').textContent = 'Remaining';
  } else {
    const doneText = `${doneCount} ${doneCount === 1 ? 'file' : 'files'} uploaded`;
    $('#sumTitle').innerHTML = errCount
      ? `${icon('alert', 'warn')}<span>Done, with ${errCount} ${errCount === 1 ? 'error' : 'errors'}</span>`
      : doneCount && skipped ? `${icon('checkCircle')}<span>${doneText}, ${skipped} skipped</span>`
      : doneCount ? `${icon('checkCircle')}<span>All files uploaded</span>`
      : skipped ? `${icon('alert', 'warn')}<span>No eligible files to upload</span>` : '<span>Nothing to upload</span>';
    const secs = batch && batch.end ? (batch.end - batch.start) / 1000 : 0;
    const avg = secs > 0 ? (batch.endBytes - batch.startBytes) / secs : 0;
    $('#sumSpeed').textContent = avg > 0 ? `${formatBytes(avg)}/s` : '—';
    $('#sumEta').textContent = secs > 0 ? formatDuration(secs) : '—';
    $('#sumSpeedLabel').textContent = 'Avg. speed';
    $('#sumEtaLabel').textContent = 'Duration';
  }
  $('#retryAll').classList.toggle('hidden', !retryable || busy);
  $('#cancelAll').classList.toggle('hidden', !busy);
}

function onAllFinished() {
  stopTicker();
  updateSummary();
  const done = items.filter((it) => it.status === 'done').length;
  const errors = items.filter((it) => it.status === 'error' && !it.fatal).length;
  if (errors) toast(`${errors} ${errors === 1 ? 'file' : 'files'} failed`, 'error');
  else if (done) toast('All uploads completed');
}

window.addEventListener('beforeunload', (e) => {
  if (isBusy()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------------------
(async function boot() {
  if (!TOKEN) return showError('Open the upload link you received to upload files.');
  try {
    info = await api('GET', API);
    chunkSize = info.chunkSize || chunkSize;
    if (info.user) showUploader();
    else showLogin();
  } catch (err) {
    showError(err.status === 404 ? err.message : "The server can't be reached. Please try again later.");
  }
})();
