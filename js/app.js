import {
  $, $$, esc, mountChrome, initInput, toast, history, downloadBlob, copyImageToClipboard, nameFromUrl, formatBytes, ICONS,
} from './common.js';
import { segment, onStatus, MODELS, getPreferredModel } from './engine.js';
import { mountModelPicker, modelNotes } from './model-picker.js';
import { Project, COLORS } from './project.js';
import { openEditor } from './editor.js';

mountChrome('home');

const SAMPLES = [
  ['Portrait', 'portrait'],
  ['Dog', 'dog'],
  ['Sneaker', 'sneaker'],
  ['Car', 'car'],
];
const sample = (key, kind = 'jpg') => `assets/samples/${key}${kind === 'thumb' ? '-thumb.jpg' : `.${kind}`}`;

// [tab, title, text, bullets, sample image, backdrop colour]
const USE_CASES = [
  ['Individuals', 'Make your photos pop', 'Cut yourself out of a cluttered room, put your pet on a bright colour, or make stickers and collages for friends.', ['Profile pictures and avatars', 'Stickers, memes and collages', 'Plain backgrounds for ID-style photos'], 'portrait', '#ffd9a8'],
  ['Photographers', 'Skip the tedious masking', 'Let the models do the masking, then touch up the last few edges with the brush instead of hand-tracing paths.', ['True transparency for hair and fur', 'Blurred-background portrait look', 'Full-resolution PNG export'], 'dog', '#cfe3ff'],
  ['E-commerce', 'Consistent product shots', 'Give every listing the same clean white or studio background and the same framing, so your catalogue looks professional.', ['Crop to product with even padding', '1:1 and 4:5 marketplace sizes', 'Bulk-process a whole shoot'], 'sneaker', '#ffffff'],
  ['Marketing', 'On-brand creative, faster', 'Drop products and people onto brand colours for ads, banners and social posts without waiting on a design queue.', ['Brand colours and custom backdrops', 'Social-ready aspect ratios', 'Drop shadows for depth'], 'watch', '#ffe066'],
  ['Car dealers', 'Showroom look for every car', 'Replace busy lots with a clean backdrop so every vehicle in your inventory is presented the same way.', ['Studio and horizon backdrops', 'Wide 3:2 and 16:9 crops', 'Batch an entire inventory'], 'car', '#e9ecef'],
  ['Media', 'Cut-outs for editorial', 'Isolate people, animals and objects for thumbnails, explainers and cover images in seconds.', ['High-contrast thumbnail cut-outs', 'Transparent WebP for the web', 'Copy straight to the clipboard'], 'cat', '#d8f3dc'],
  ['Developers', 'Background removal as a function call', 'Import the SDK and call removeBackground() from any web app, or post images to the local HTTP API. No keys, no per-image fees.', ['Uses the local GPU server when it’s running', 'Returns a Blob you can upload or display', 'Background, crop and format options'], 'sneaker', '#eef1f5'],
];

// ---------- state ----------
const items = new Map(); // id -> item
let order = []; // newest first
let selected = null;
let view = 'result';
let cmpPos = 0.5;

const el = {
  hero: $('#hero'), ws: $('#workspace'), preview: $('#preview'), stack: $('#stack'),
  result: $('#resultCanvas'), orig: $('#origCanvas'), handle: $('#cmpHandle'),
  loading: $('#loading'), loadingImg: $('#loadingImg'), statusTitle: $('#statusTitle'),
  statusDetail: $('#statusDetail'), statusBar: $('#statusBar'),
  error: $('#errorBox'), errorText: $('#errorText'),
  download: $('#downloadBtn'), info: $('#downloadInfo'), size: $('#sizeSelect'), format: $('#formatSelect'),
  edit: $('#editBtn'), brush: $('#brushBtn'), effects: $('#effectsBtn'), crop: $('#cropBtn'), copy: $('#copyBtn'), quick: $('#quickBg'), recent: $('#recentRow'),
  model: $('#modelSelect'), modelNote: $('#modelNote'), rerun: $('#rerunBtn'),
};

const current = () => items.get(selected);

// ---------- input ----------
initInput({
  multiple: true,
  onFiles: (files, total) => {
    if (total > 6) toast(`Tip: the Bulk editor is handier for ${total} images.`, 'info');
    files.forEach((f, i) => addSource(f, f.name || 'pasted-image.png', i === 0));
  },
  onUrl: (url) => addSource(url, nameFromUrl(url)),
});

$('#urlToggle').addEventListener('click', () => {
  const form = $('#urlForm');
  form.hidden = !form.hidden;
  if (!form.hidden) $('#urlInput').focus();
});
$('#urlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#urlInput').value.trim();
  if (url) addSource(url, nameFromUrl(url));
});

$('#samples').innerHTML = SAMPLES.map(([name, key]) =>
  `<button class="sample" data-sample="${key}" title="Try the ${name.toLowerCase()} sample"><img src="${sample(key, 'thumb')}" alt="${name} sample"></button>`).join('');
$('#samples').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sample]');
  if (b) addSource(sample(b.dataset.sample), `${b.dataset.sample}-sample.jpg`);
});

// ---------- processing ----------
function addSource(source, name, doSelect = true) {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  const previewUrl = source instanceof Blob ? URL.createObjectURL(source) : source;
  const item = { id, name, source, previewUrl, status: 'processing' };
  items.set(id, item);
  order.unshift(id);
  if (doSelect || !selected) select(id);
  else renderRecents();
  processItem(item);
}

async function processItem(item) {
  const previous = item.project;
  item.status = 'processing';
  item.error = null;
  refresh(item);
  try {
    const source = previous ? previous.original : item.source;
    const { original, mask, foreground, model } = await segment(source, { model: getPreferredModel() });
    item.project = new Project(original, mask, {
      id: item.id,
      name: item.name,
      sourceBlob: previous ? previous.sourceBlob : item.source instanceof Blob ? item.source : null,
      state: previous?.state,
      foreground,
      model,
    });
    item.thumb = item.project.thumbnail(240);
    item.status = 'done';
    save(item);
  } catch (err) {
    console.error(err);
    if (previous) {
      item.project = previous;
      item.status = 'done';
      toast(err?.message || String(err), 'error');
    } else {
      item.status = 'error';
      item.error = err?.message || String(err);
    }
  }
  refresh(item);
}

function refresh(item) {
  renderRecents();
  if (item.id === selected) renderWorkspace();
}

async function save(item) {
  if (!item.project) return;
  const ok = await history.put(await item.project.toRecord());
  if (!ok) console.warn('History not saved (storage unavailable).');
}

onStatus((st) => {
  const item = current();
  if (!item || item.status !== 'processing') return;
  if (st.stage === 'loading') {
    el.statusTitle.textContent = `Downloading ${MODELS[st.model]?.short || 'AI'} model…`;
    el.statusDetail.textContent = st.total
      ? `${formatBytes(st.loaded)} of ${formatBytes(st.total)} · first time only`
      : st.device === 'server' ? 'Local AI server is loading its models…' : 'Preparing…';
    el.statusBar.parentElement.classList.remove('indeterminate');
    el.statusBar.style.width = `${Math.round(st.progress * 100)}%`;
  } else {
    el.statusTitle.textContent = st.stage === 'refining' ? 'Refining edges…' : 'Removing background…';
    const where = { server: 'local server', webgpu: 'GPU', wasm: 'CPU' }[st.device] || 'device';
    el.statusDetail.textContent = st.device
      ? `${MODELS[st.model]?.short || 'AI'} on your ${where}`
      : '';
    el.statusBar.parentElement.classList.add('indeterminate');
  }
});

// ---------- selection & workspace ----------
async function select(id) {
  selected = id;
  const item = current();
  el.hero.hidden = true;
  el.ws.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderRecents();
  renderWorkspace();
  if (item.status === 'stored') {
    item.status = 'opening';
    renderWorkspace();
    try {
      const rec = await history.get(id);
      if (!rec) throw new Error('This image is no longer in your history.');
      item.project = await Project.fromRecord(rec);
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }
    refresh(item);
  }
}

function renderWorkspace() {
  const item = current();
  if (!item) return;
  const busy = item.status === 'processing' || item.status === 'opening';
  const done = item.status === 'done';
  el.loading.hidden = !busy;
  el.error.hidden = item.status !== 'error';
  el.stack.hidden = !done;
  [el.download, el.edit, el.brush, el.effects, el.crop, el.copy].forEach((b) => { b.disabled = !done; });

  if (busy) {
    el.loadingImg.src = item.previewUrl || item.thumb || '';
    if (item.status === 'opening') {
      el.statusTitle.textContent = 'Opening image…';
      el.statusDetail.textContent = '';
      el.statusBar.parentElement.classList.add('indeterminate');
    }
  }
  if (item.status === 'error') el.errorText.textContent = item.error;
  if (done) {
    drawPreview();
    renderQuickBg();
    updateInfo();
    updateModelUI();
  } else {
    el.info.innerHTML = '&nbsp;';
  }
}

function drawPreview() {
  const item = current();
  if (!item?.project) return;
  const p = item.project;
  const r = p.layout();
  const dpr = window.devicePixelRatio || 1;
  const maxW = el.preview.clientWidth - 32;
  const maxH = Math.min(window.innerHeight * 0.62, 640);
  const s = Math.min(maxW / r.w, maxH / r.h, 2);
  const cw = Math.max(1, Math.round(r.w * s)), ch = Math.max(1, Math.round(r.h * s));
  el.stack.style.width = `${cw}px`;
  el.stack.style.height = `${ch}px`;
  for (const [canvas, showOriginal] of [[el.result, false], [el.orig, true]]) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext('2d');
    const k = canvas.width / r.w;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, r.w, r.h);
    p.render(ctx, { deviceScale: k, showOriginal });
  }
  applyView();
}

function applyView() {
  $$('[data-view]').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === view));
  el.orig.hidden = view === 'result';
  el.handle.hidden = view !== 'compare';
  el.stack.classList.toggle('comparing', view === 'compare');
  const pct = view === 'compare' ? cmpPos * 100 : 100;
  el.orig.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  el.handle.style.left = `${cmpPos * 100}%`;
}

$$('[data-view]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; applyView(); }));

let dragging = false;
const setPos = (e) => {
  const rect = el.stack.getBoundingClientRect();
  cmpPos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  applyView();
};
el.stack.addEventListener('pointerdown', (e) => {
  if (view !== 'compare') return;
  dragging = true;
  el.stack.setPointerCapture(e.pointerId);
  setPos(e);
});
el.stack.addEventListener('pointermove', (e) => { if (dragging) setPos(e); });
el.stack.addEventListener('pointerup', () => { dragging = false; });

let resizeRaf;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { if (current()?.status === 'done') drawPreview(); });
});

// ---------- model picker ----------
async function updateModelUI() {
  const { chosen, notes } = await modelNotes(el.model.value);
  const p = current()?.project;
  if (p?.model) notes.unshift(`This result: ${MODELS[p.model]?.short || p.model}.`);
  el.modelNote.textContent = notes.join(' ');
  el.rerun.hidden = !p || !p.model || p.model === chosen;
  el.rerun.textContent = `Re-run with ${MODELS[chosen].short}`;
}

el.rerun.addEventListener('click', () => {
  const item = current();
  if (item?.project) processItem(item);
});
mountModelPicker(el.model, { onChange: updateModelUI }).then(updateModelUI);

$('#retryBtn').addEventListener('click', () => {
  const item = current();
  if (item?.source) processItem(item);
  else toast('Please upload the image again.', 'info');
});

// ---------- actions ----------
function updateInfo() {
  const p = current()?.project;
  if (!p) return;
  const { w, h } = p.outputSize(el.size.value);
  el.info.textContent = `${w} × ${h} px`;
}
el.size.addEventListener('change', updateInfo);

el.download.addEventListener('click', async () => {
  const p = current()?.project;
  if (!p) return;
  const type = el.format.value;
  el.download.disabled = true;
  try {
    const blob = await p.toBlob({ type, size: el.size.value });
    downloadBlob(blob, p.fileName(type));
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    el.download.disabled = false;
  }
});

el.copy.addEventListener('click', async () => {
  const p = current()?.project;
  if (!p) return;
  try {
    await copyImageToClipboard(p.toBlob({ type: 'image/png', size: el.size.value }));
    toast('Copied to clipboard', 'success');
  } catch (err) {
    toast(err.message || 'Could not copy', 'error');
  }
});

function edit(tab) {
  const item = current();
  if (!item?.project) return;
  openEditor(item.project, {
    tab,
    onDone: (p, changed) => {
      if (!changed) return;
      item.thumb = p.thumbnail(240);
      save(item);
    },
    onClose: () => refresh(item),
  });
}
el.edit.addEventListener('click', () => edit('background'));
el.brush.addEventListener('click', () => edit('brush'));
el.effects.addEventListener('click', () => edit('effects'));
el.crop.addEventListener('click', () => edit('crop'));

const QUICK = [
  { key: 'none', label: 'Transparent', apply: (bg) => { bg.type = 'none'; } },
  ...['#ffffff', '#000000', '#f1f2f6', '#fde68a', '#93c5fd', '#fca5a5'].map((c) => ({
    key: c, label: c, color: c, apply: (bg) => { bg.type = 'color'; bg.color = c; },
  })),
  { key: 'blur', label: 'Blur', apply: (bg) => { bg.type = 'blur'; } },
];

function renderQuickBg() {
  const bg = current()?.project?.state.bg;
  if (!bg) return;
  const activeKey = bg.type === 'none' ? 'none' : bg.type === 'blur' ? 'blur' : bg.type === 'color' ? bg.color : null;
  el.quick.innerHTML = QUICK.map((q) => {
    const cls = q.key === 'none' ? 'sw sw-none' : q.key === 'blur' ? 'sw sw-blur' : 'sw';
    return `<button class="${cls}${q.key === activeKey ? ' active' : ''}" data-quick="${q.key}" title="${q.label}" aria-label="${q.label}"${q.color ? ` style="--c:${q.color}"` : ''}>${q.key === 'blur' ? '<span>Blur</span>' : ''}</button>`;
  }).join('') + `<button class="sw sw-more" data-more title="More backgrounds" aria-label="More backgrounds">${ICONS.plus}</button>`;
}

el.quick.addEventListener('click', (e) => {
  const item = current();
  if (!item?.project) return;
  if (e.target.closest('[data-more]')) return edit('background');
  const b = e.target.closest('[data-quick]');
  if (!b) return;
  QUICK.find((q) => q.key === b.dataset.quick).apply(item.project.state.bg);
  item.thumb = item.project.thumbnail(240);
  drawPreview();
  renderQuickBg();
  renderRecents();
  save(item);
});

// ---------- recent images ----------
function renderRecents() {
  el.recent.innerHTML = `<button class="recent-tile add" data-upload title="Add image">${ICONS.plus}</button>` +
    order.map((id) => {
      const it = items.get(id);
      const busy = it.status === 'processing' || it.status === 'opening';
      const img = it.thumb || it.previewUrl;
      return `<div class="recent-tile${id === selected ? ' active' : ''}${it.status === 'error' ? ' failed' : ''}" data-id="${id}">
        <button class="recent-open" title="${esc(it.name)}">${img ? `<img src="${esc(img)}" alt="">` : ''}${busy ? '<span class="spinner sm"></span>' : ''}</button>
        <button class="recent-del" data-del="${id}" title="Remove" aria-label="Remove ${esc(it.name)}">${ICONS.close}</button>
      </div>`;
    }).join('');
}

el.recent.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    const id = del.dataset.del;
    const it = items.get(id);
    if (it?.status === 'processing') return toast('Wait for this image to finish first.', 'info');
    items.delete(id);
    order = order.filter((x) => x !== id);
    await history.delete(id);
    if (selected === id) {
      if (order.length) select(order[0]);
      else goHome();
    } else renderRecents();
    return;
  }
  const tile = e.target.closest('[data-id]');
  if (tile && tile.dataset.id !== selected) select(tile.dataset.id);
});

$('#clearHistory').addEventListener('click', async () => {
  if (!confirm('Remove all images from your history on this device?')) return;
  await history.clear();
  for (const id of [...order]) {
    if (items.get(id).status !== 'processing') items.delete(id);
  }
  order = order.filter((id) => items.has(id));
  if (!items.has(selected)) {
    if (order.length) select(order[0]);
    else goHome();
  } else renderRecents();
});

function goHome() {
  selected = null;
  el.ws.hidden = true;
  el.hero.hidden = false;
  renderResume();
}

function renderResume() {
  $('.resume')?.remove();
  if (!order.length) return;
  const p = document.createElement('p');
  p.className = 'resume small';
  p.innerHTML = `<button class="linkish">Continue with your ${order.length} recent image${order.length > 1 ? 's' : ''} →</button>`;
  p.querySelector('button').addEventListener('click', () => select(order[0]));
  $('#uploadCard').append(p);
}

(async () => {
  const rows = await history.all();
  for (const row of rows) {
    if (items.has(row.id)) continue;
    items.set(row.id, { id: row.id, name: row.name, thumb: row.thumb, status: 'stored' });
    order.push(row.id);
  }
  const wanted = decodeURIComponent(location.hash.match(/^#open=(.+)$/)?.[1] || '');
  if (wanted && items.has(wanted)) {
    window.history.replaceState(null, '', location.pathname);
    select(wanted);
  } else if (wanted) {
    toast('That image is no longer in your history.', 'info');
  }
  if (selected) renderRecents();
  else renderResume();
})();

// ---------- quality showcase ----------
const SHOWCASE = [['People', 'portrait'], ['Animals', 'cat'], ['Products', 'sneaker'], ['Cars', 'car']];
const scTabs = $('#scTabs');
const scStage = $('#scStage');
scTabs.innerHTML = SHOWCASE.map(([label], i) => `<button role="tab" data-sc="${i}">${label}</button>`).join('');
function showShowcase(i) {
  const [label, key] = SHOWCASE[i];
  $$('[data-sc]', scTabs).forEach((b) => b.setAttribute('aria-selected', +b.dataset.sc === i));
  $('#scBefore').src = sample(key);
  $('#scBefore').alt = `${label} example, original photo`;
  $('#scAfter').src = sample(key, 'webp');
  $('#scAfter').alt = `${label} example, background removed`;
  scStage.dataset.key = key;
  setShowcasePos(0.5);
}
function setShowcasePos(f) {
  scStage.style.setProperty('--pos', `${Math.min(100, Math.max(0, f * 100))}%`);
}
scTabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sc]');
  if (b) showShowcase(+b.dataset.sc);
});
let scDrag = false;
const scMove = (e) => {
  const r = scStage.getBoundingClientRect();
  setShowcasePos((e.clientX - r.left) / r.width);
};
scStage.addEventListener('pointerdown', (e) => { scDrag = true; scStage.setPointerCapture(e.pointerId); scMove(e); });
scStage.addEventListener('pointermove', (e) => { if (scDrag) scMove(e); });
scStage.addEventListener('pointerup', () => { scDrag = false; });
showShowcase(0);

// ---------- use cases ----------
const ucTabs = $('#ucTabs');
ucTabs.innerHTML = USE_CASES.map(([tab], i) => `<button role="tab" data-uc="${i}">${tab}</button>`).join('');
function showUseCase(i) {
  const [, title, text, bullets, key, bg] = USE_CASES[i];
  $$('[data-uc]', ucTabs).forEach((b) => b.setAttribute('aria-selected', +b.dataset.uc === i));
  $('#ucPanel').innerHTML = `
    <div class="uc-visual" style="background:${bg}"><img src="${sample(key, 'webp')}" alt=""></div>
    <div class="uc-copy">
      <h3>${title}</h3>
      <p>${text}</p>
      <ul class="checks">${bullets.map((b) => `<li>${ICONS.check}${b}</li>`).join('')}</ul>
      ${key === 'sneaker' && i === USE_CASES.length - 1
        ? '<a class="btn btn-ghost" href="developers.html">Read the SDK docs</a>'
        : '<button class="btn btn-primary" data-upload>Upload Image</button>'}
    </div>`;
}
ucTabs.addEventListener('click', (e) => {
  const b = e.target.closest('[data-uc]');
  if (b) showUseCase(+b.dataset.uc);
});
showUseCase(0);
