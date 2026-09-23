import { $, esc, mountChrome, toast, downloadBlob, formatBytes, history, HISTORY_LIMITS, ICONS } from './common.js';
import { MODELS } from './engine.js';
import { Project } from './project.js';
import { openEditor } from './editor.js';

mountChrome('library');
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-upload]')) location.href = 'index.html';
});

let rows = [];
const selected = new Set();
const grid = $('#grid');
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function load() {
  rows = await history.all();
  for (const id of [...selected]) if (!rows.some((r) => r.id === id)) selected.delete(id);
  render();
  renderUsage();
}

function visibleRows() {
  const q = $('#search').value.trim().toLowerCase();
  const out = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : [...rows];
  const sort = $('#sort').value;
  if (sort === 'old') out.sort((a, b) => a.updated - b.updated);
  else if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
  else out.sort((a, b) => b.updated - a.updated);
  return out;
}

function render() {
  const list = visibleRows();
  $('#empty').hidden = rows.length > 0;
  $('#libSummary').textContent = rows.length
    ? `${rows.length} image${rows.length > 1 ? 's' : ''} saved on this device.`
    : 'Every background you remove is saved here, on this device only.';
  grid.innerHTML = list.map((r) => {
    const model = r.model ? MODELS[r.model]?.short || r.model : '';
    const dims = r.width ? `${r.width} × ${r.height}` : '';
    return `<article class="lib-card${selected.has(r.id) ? ' selected' : ''}" data-id="${r.id}">
      <label class="lib-check" title="Select"><input type="checkbox" data-select${selected.has(r.id) ? ' checked' : ''} aria-label="Select ${esc(r.name)}"></label>
      <a class="lib-thumb checker" href="index.html#open=${encodeURIComponent(r.id)}" title="Open ${esc(r.name)}">
        <img src="${esc(r.thumb || '')}" alt="" loading="lazy">
      </a>
      <div class="lib-meta">
        <div class="lib-name" title="${esc(r.name)}">${esc(r.name)}</div>
        <div class="lib-sub">${esc(dateFmt.format(r.updated))}${dims ? ` · ${dims}` : ''}</div>
        ${model ? `<div class="lib-sub">${esc(model)}</div>` : ''}
      </div>
      <div class="lib-actions">
        <button class="icon-btn" data-edit title="Edit">${ICONS.edit}</button>
        <button class="icon-btn" data-dl title="Download">${ICONS.download}</button>
        <button class="icon-btn" data-del title="Delete">${ICONS.trash}</button>
      </div>
    </article>`;
  }).join('');
  if (rows.length && !list.length) grid.innerHTML = '<p class="empty">No images match your search.</p>';
  renderSelection();
}

function renderSelection() {
  $('#selbar').hidden = selected.size === 0;
  $('#selCount').textContent = `${selected.size} selected`;
}

async function renderUsage() {
  const u = await history.usage();
  $('#usage').textContent = u
    ? `This site is using ${formatBytes(u.usage)} of browser storage (images plus the in-browser AI model cache).`
    : 'Your browser doesn’t report storage usage.';
}

async function exportRecord(rec) {
  const p = await Project.fromRecord(rec);
  const type = $('#format').value;
  return { blob: await p.toBlob({ type, size: $('#size').value }), name: p.fileName(type) };
}

// ---------- events ----------
$('#search').addEventListener('input', render);
$('#sort').addEventListener('change', render);

grid.addEventListener('change', (e) => {
  const box = e.target.closest('[data-select]');
  if (!box) return;
  const id = box.closest('[data-id]').dataset.id;
  box.checked ? selected.add(id) : selected.delete(id);
  box.closest('.lib-card').classList.toggle('selected', box.checked);
  renderSelection();
});

grid.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-id]');
  if (!card) return;
  const rec = rows.find((r) => r.id === card.dataset.id);
  if (!rec) return;
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-dl')) {
    btn.disabled = true;
    try {
      const { blob, name } = await exportRecord(rec);
      downloadBlob(blob, name);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  } else if (btn.hasAttribute('data-del')) {
    if (!confirm(`Delete “${rec.name}”?`)) return;
    await history.delete(rec.id);
    selected.delete(rec.id);
    load();
  } else if (btn.hasAttribute('data-edit')) {
    btn.disabled = true;
    try {
      const p = await Project.fromRecord(rec);
      openEditor(p, {
        onDone: async (proj, changed) => {
          if (!changed) return;
          await history.put(await proj.toRecord());
          toast('Saved', 'success');
          load();
        },
      });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }
});

$('#selAll').addEventListener('click', () => {
  visibleRows().forEach((r) => selected.add(r.id));
  render();
});
$('#selNone').addEventListener('click', () => {
  selected.clear();
  render();
});

$('#delSel').addEventListener('click', async () => {
  if (!confirm(`Delete ${selected.size} image${selected.size > 1 ? 's' : ''}?`)) return;
  for (const id of selected) await history.delete(id);
  selected.clear();
  load();
});

$('#zipSel').addEventListener('click', async () => {
  if (!window.JSZip) return toast('ZIP library is still loading — try again in a moment.', 'info');
  const btn = $('#zipSel');
  const label = btn.textContent;
  btn.disabled = true;
  try {
    const zip = new window.JSZip();
    const used = new Set();
    const chosen = rows.filter((r) => selected.has(r.id));
    for (let n = 0; n < chosen.length; n++) {
      btn.textContent = `Preparing ${n + 1}/${chosen.length}…`;
      let { blob, name } = await exportRecord(chosen[n]);
      for (let k = 2; used.has(name); k++) name = name.replace(/(-\d+)?(\.\w+)$/, `-${k}$2`);
      used.add(name);
      zip.file(name, blob);
    }
    btn.textContent = 'Zipping…';
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `lumacut-${chosen.length}-images.zip`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
});

const limitSel = $('#limit');
limitSel.innerHTML = HISTORY_LIMITS.map((n) => `<option value="${n}">${n} images</option>`).join('');
limitSel.value = String(history.limit);
limitSel.addEventListener('change', async () => {
  const n = +limitSel.value;
  if (rows.length > n && !confirm(`This will delete your ${rows.length - n} oldest image${rows.length - n > 1 ? 's' : ''}. Continue?`)) {
    limitSel.value = String(history.limit);
    return;
  }
  await history.setLimit(n);
  load();
});

$('#deleteAll').addEventListener('click', async () => {
  if (!rows.length) return;
  if (!confirm(`Delete all ${rows.length} images from this device? This can’t be undone.`)) return;
  await history.clear();
  selected.clear();
  load();
});

load();
