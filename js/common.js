// Shared page chrome and helpers used by every page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatBytes(n) {
  if (!n) return '0 MB';
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function copyImageToClipboard(blobPromise) {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('Clipboard images aren’t supported in this browser.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
}

export const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="8" fill="#2463eb"/>
  <circle cx="12" cy="12" r="4.5" fill="#fff"/>
  <path d="M7 26 26 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="2.6 3"/>
  <path d="M19 26c0-4 2.6-7 7-7v7z" fill="#fff"/>
</svg>`;

export const ICONS = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6 8.4 12z"/><path d="M8 13c-2.5 0-4 1.8-4 4 0 1.5-.8 2.5-2 3 4 1 9 0 9-4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  zip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M10 5h1M10 8h1M10 11h1M10 14h1v3h-1z"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect x="3" y="5" width="18" height="14" rx="2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};

const NAV = [
  ['home', 'index.html', 'Remove background'],
  ['bulk', 'bulk.html', 'Bulk editor'],
  ['library', 'library.html', 'My images'],
  ['developers', 'developers.html', 'Developers'],
  ['pricing', 'pricing.html', 'Pricing'],
];

export function mountChrome(active) {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="container nav">
      <a class="brand" href="index.html">${LOGO}<span>Lumacut</span></a>
      <nav class="nav-links" id="navLinks">
        ${NAV.map(([k, href, label]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
      <div class="nav-actions">
        <button class="btn btn-ghost btn-sm" data-upload>Upload</button>
        <button class="icon-btn nav-toggle" aria-label="Menu" aria-expanded="false">${ICONS.menu}</button>
      </div>
    </div>`;
  document.body.prepend(header);
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const toggle = $('.nav-toggle', header);
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="container footer-grid">
      <div>
        <a class="brand" href="index.html">${LOGO}<span>Lumacut</span></a>
        <p class="muted small">Free background removal that runs on your own machine. Your photos never go to a third party.</p>
      </div>
      <div><h4>Product</h4><a href="index.html">Remove background</a><a href="bulk.html">Bulk editor</a><a href="library.html">My images</a><a href="index.html#features">Features</a><a href="pricing.html">Pricing</a></div>
      <div><h4>Learn</h4><a href="index.html#how">How it works</a><a href="index.html#use-cases">Use cases</a><a href="index.html#faq">FAQ</a></div>
      <div><h4>Developers</h4><a href="developers.html">JavaScript SDK</a><a href="developers.html#playground">Playground</a><a href="developers.html#options">Options</a></div>
    </div>
    <div class="container footer-bottom small muted">
      <span>© ${new Date().getFullYear()} Lumacut</span>
      <span>AI models: <a href="https://huggingface.co/ZhengPeng7/BiRefNet" target="_blank" rel="noopener">BiRefNet</a>, <a href="https://huggingface.co/hustvl/vitmatte-base-distinctions-646" target="_blank" rel="noopener">ViTMatte</a>, <a href="https://huggingface.co/briaai/RMBG-1.4" target="_blank" rel="noopener">RMBG-1.4</a></span>
    </div>`;
  document.body.append(footer);

  const toasts = document.createElement('div');
  toasts.className = 'toasts';
  toasts.setAttribute('aria-live', 'polite');
  document.body.append(toasts);
}

export function toast(message, type = 'info', ms = 3600) {
  const box = $('.toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|svg|heic|heif|tiff?)$/i;
const isImageFile = (f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);

/**
 * Wire every way of getting images into the page: [data-upload] buttons,
 * drag & drop anywhere, and pasting files or URLs.
 */
export function initInput({ onFiles, onUrl, multiple = false }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = multiple;
  input.hidden = true;
  document.body.append(input);

  const deliver = (files) => {
    const images = [...files].filter(isImageFile);
    if (!images.length) {
      toast('Please choose an image file (JPG, PNG, WebP…).', 'error');
      return;
    }
    if (images.some((f) => /\.(heic|heif|tiff?)$/i.test(f.name) && !f.type)) {
      toast('HEIC/TIFF may not be supported by your browser — convert to JPG if it fails.', 'info');
    }
    onFiles(multiple ? images : images.slice(0, 1), images.length);
  };

  input.addEventListener('change', () => {
    if (input.files.length) deliver(input.files);
    input.value = '';
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-upload]')) {
      e.preventDefault();
      input.click();
    }
  });

  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = `<div class="drop-overlay-inner">${ICONS.upload}<strong>Drop ${multiple ? 'images' : 'an image'} anywhere</strong></div>`;
  document.body.append(overlay);

  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    depth = 0;
    overlay.classList.remove('show');
    if (!hasFiles(e)) {
      const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
      if (url && /^https?:\/\//i.test(url.trim()) && onUrl) { e.preventDefault(); onUrl(url.trim()); }
      return;
    }
    e.preventDefault();
    deliver(e.dataTransfer.files);
  });

  window.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      deliver(files);
      return;
    }
    const text = e.clipboardData?.getData('text')?.trim();
    if (text && /^https?:\/\/\S+$/i.test(text) && onUrl) {
      e.preventDefault();
      onUrl(text);
    }
  });

  return { open: () => input.click() };
}

export function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || 'image';
    return decodeURIComponent(last).slice(0, 80);
  } catch { return 'image'; }
}

// ---------- IndexedDB history ----------
const DB_NAME = 'lumacut';
const STORE = 'projects';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const LIMIT_KEY = 'lumacut-history-limit';
export const HISTORY_LIMITS = [25, 50, 100, 250, 500];

export const history = {
  get limit() {
    try { return +localStorage.getItem(LIMIT_KEY) || 100; } catch { return 100; }
  },
  async setLimit(n) {
    try { localStorage.setItem(LIMIT_KEY, String(n)); } catch { /* ignore */ }
    await this.trim();
  },
  async trim() {
    const rows = await this.all();
    for (const old of rows.slice(this.limit)) await this.delete(old.id);
  },
  /** Bytes used by this site's storage (history + model caches), if the browser reports it. */
  async usage() {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    } catch { return null; }
  },
  async all() {
    try {
      const rows = await run('readonly', (s) => s.getAll());
      return rows.sort((a, b) => b.updated - a.updated);
    } catch { return []; }
  },
  async get(id) {
    try { return await run('readonly', (s) => s.get(id)); } catch { return null; }
  },
  async put(record) {
    try {
      await run('readwrite', (s) => s.put(record));
      await this.trim();
      return true;
    } catch (err) {
      console.warn('Could not save to history', err);
      return false;
    }
  },
  async delete(id) {
    try { await run('readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
  },
  async clear() {
    try { await run('readwrite', (s) => s.clear()); } catch { /* ignore */ }
  },
};
