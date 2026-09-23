import { $, esc, mountChrome, initInput, toast, downloadBlob, formatBytes, nameFromUrl, history, ICONS } from './common.js';
import { segment, onStatus, MODELS, getPreferredModel } from './engine.js';
import { mountModelPicker, modelNotes } from './model-picker.js';
import { Project } from './project.js';
import { openEditor } from './editor.js';

mountChrome('bulk');

const items = []; // { id, name, source, previewUrl, status, project, thumb, error, custom }
const list = $('#list');
const opts = {
  bg: $('#optBg'), color: $('#optColor'), trim: $('#optTrim'), pad: $('#optPad'),
  ratio: $('#optRatio'), shadow: $('#optShadow'), format: $('#optFormat'), size: $('#optSize'),
};
const saveToHistory = $('#optSave');
const DEVICE_LABEL = { server: 'your local GPU server', webgpu: 'your GPU (in the browser)', wasm: 'your CPU (in the browser)' };

// ---------- model ----------
async function updateModelNote() {
  const { notes } = await modelNotes($('#optModel').value);
  $('#modelNote').textContent = notes.join(' ');
}
mountModelPicker($('#optModel'), { onChange: updateModelNote }).then(updateModelNote);

// ---------- input ----------
initInput({
  multiple: true,
  onFiles: (files) => files.forEach((f) => add(f, f.name || 'pasted-image.png')),
  onUrl: (url) => add(url, nameFromUrl(url)),
});

function add(source, name) {
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    name,
    source,
    previewUrl: source instanceof Blob ? URL.createObjectURL(source) : source,
    status: 'queued',
  };
  items.push(item);
  render();
  run(item);
}

async function run(item) {
  try {
    const { original, mask, foreground, model } = await segment(item.source, {
      model: getPreferredModel(),
      onStart: () => { item.status = 'processing'; render(); },
    });
    item.project = new Project(original, mask, {
      id: item.id, name: item.name, foreground, model,
      sourceBlob: item.source instanceof Blob ? item.source : null,
    });
    applySettings(item);
    item.status = 'done';
    if (saveToHistory.checked) {
      item.saved = await history.put(await item.project.toRecord());
    }
  } catch (err) {
    item.status = 'error';
    item.error = err?.message || String(err);
  }
  render();
}

// ---------- settings ----------
function applySettings(item) {
  if (!item.project || item.custom) return;
  const s = item.project.state;
  const bg = opts.bg.value;
  if (bg === 'none') s.bg.type = 'none';
  else if (bg === 'blur') s.bg.type = 'blur';
  else {
    s.bg.type = 'color';
    s.bg.color = bg === 'custom' ? opts.color.value : bg;
  }
  s.layout.trim = opts.trim.checked;
  s.layout.padding = +opts.pad.value / 100;
  s.layout.ratio = +opts.ratio.value;
  s.shadow.on = opts.shadow.checked;
  item.thumb = item.project.thumbnail(320);
}

/** Update the saved copy's edits without re-encoding its images. */
async function syncSaved(item) {
  if (!item.saved) return;
  const rec = await history.get(item.id);
  if (!rec) return;
  rec.state = item.project.storableState();
  rec.thumb = item.project.thumbnail(240);
  rec.updated = Date.now();
  await history.put(rec);
}

let syncTimer;
function syncAllSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => items.filter((i) => i.status === 'done' && !i.custom).forEach(syncSaved), 800);
}

function syncOptionUI() {
  $('#customColorRow').hidden = opts.bg.value !== 'custom';
  $('#padRow').classList.toggle('disabled', !opts.trim.checked);
  $('#padOut').textContent = `${opts.pad.value}%`;
}

Object.values(opts).forEach((input) => {
  input.addEventListener(input.type === 'range' || input.type === 'color' ? 'input' : 'change', () => {
    syncOptionUI();
    if (input === opts.format || input === opts.size) return;
    items.forEach(applySettings);
    render();
    syncAllSoon();
  });
});
syncOptionUI();

// ---------- status ----------
onStatus((st) => {
  const el = $('#modelStatus');
  const name = MODELS[st.model]?.short || 'AI';
  if (st.stage === 'loading') {
    el.textContent = st.device === 'server'
      ? 'The local AI server is still loading its models…'
      : st.total ? `Downloading ${name} model… ${formatBytes(st.loaded)} of ${formatBytes(st.total)} (first time only)` : `Loading ${name} model…`;
  } else if (st.stage === 'error') {
    el.textContent = 'The AI model failed to load. Check your connection and try again.';
  } else if (st.device) {
    el.textContent = `${name} running on ${DEVICE_LABEL[st.device] || 'this device'}.`;
  }
});

const STATUS_LABEL = { queued: 'Waiting…', processing: 'Working…', done: 'Done', error: 'Failed' };

function render() {
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const pending = items.length - done - failed;
  $('#count').textContent = items.length
    ? `${done} of ${items.length} done${failed ? ` · ${failed} failed` : ''}`
    : 'No images yet';
  $('#zipBtn').disabled = !done;
  $('#clearBtn').disabled = !items.length || pending > 0;
  $('#empty').hidden = items.length > 0;
  $('#progress').hidden = !pending;
  $('#progressBar').style.width = `${items.length ? ((done + failed) / items.length) * 100 : 0}%`;

  list.innerHTML = items.map((it) => {
    const img = it.thumb || it.previewUrl;
    const busy = it.status === 'queued' || it.status === 'processing';
    const model = it.project?.model ? ` · ${MODELS[it.project.model]?.short || it.project.model}` : '';
    return `<article class="bulk-item" data-id="${it.id}">
      <div class="bulk-thumb${it.thumb ? ' checker' : ' pending'}">
        <img src="${esc(img)}" alt="">
        ${busy ? '<span class="spinner"></span>' : ''}
      </div>
      <div class="bulk-meta">
        <div class="bulk-name" title="${esc(it.name)}">${esc(it.name)}
          <div class="bulk-status${it.status === 'error' ? ' err' : ''}" title="${esc(it.error || '')}">${STATUS_LABEL[it.status]}${it.status === 'done' ? esc(model) : ''}${it.custom ? ' · edited' : ''}</div>
        </div>
        ${it.status === 'done' ? `
          <button class="icon-btn" data-edit title="Edit">${ICONS.edit}</button>
          <button class="icon-btn" data-dl title="Download">${ICONS.download}</button>` : ''}
        ${it.status === 'error' ? '<button class="icon-btn" data-retry title="Retry">↻</button>' : ''}
        ${!busy ? `<button class="icon-btn" data-remove title="Remove from this list">${ICONS.close}</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

list.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-id]');
  if (!card) return;
  const item = items.find((i) => i.id === card.dataset.id);
  if (!item) return;
  if (e.target.closest('[data-dl]')) {
    const blob = await item.project.toBlob({ type: opts.format.value, size: opts.size.value });
    downloadBlob(blob, item.project.fileName(opts.format.value));
  } else if (e.target.closest('[data-edit]')) {
    openEditor(item.project, {
      onDone: async (p, changed) => {
        if (!changed) return;
        item.custom = true;
        item.thumb = p.thumbnail(320);
        // Brush edits change the mask, so store the whole record again.
        if (item.saved) await history.put(await p.toRecord());
        render();
      },
      onClose: render,
    });
  } else if (e.target.closest('[data-retry]')) {
    item.status = 'queued';
    item.error = null;
    render();
    run(item);
  } else if (e.target.closest('[data-remove]')) {
    items.splice(items.indexOf(item), 1);
    render();
  }
});

$('#clearBtn').addEventListener('click', () => {
  items.length = 0;
  render();
  if (saveToHistory.checked) toast('Cleared this list. Your results are still in My images.', 'info');
});

$('#zipBtn').addEventListener('click', async () => {
  if (!window.JSZip) return toast('ZIP library is still loading — try again in a moment.', 'info');
  const btn = $('#zipBtn');
  btn.disabled = true;
  const label = btn.textContent;
  try {
    const zip = new window.JSZip();
    const used = new Set();
    const done = items.filter((i) => i.status === 'done');
    for (let n = 0; n < done.length; n++) {
      btn.textContent = `Preparing ${n + 1}/${done.length}…`;
      let name = done[n].project.fileName(opts.format.value);
      for (let k = 2; used.has(name); k++) name = name.replace(/(-\d+)?(\.\w+)$/, `-${k}$2`);
      used.add(name);
      zip.file(name, await done[n].project.toBlob({ type: opts.format.value, size: opts.size.value }));
    }
    btn.textContent = 'Zipping…';
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `lumacut-${done.length}-images.zip`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
});

render();
