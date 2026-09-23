// Full-screen editor: backgrounds, erase/restore brush, shadow, crop, undo/redo, zoom/pan.

import { createCanvas, copyCanvas, loadImage } from './engine.js';
import { COLORS, BACKDROPS, cloneState, backdropThumb } from './project.js';
import { $, $$, ICONS, toast } from './common.js';

const RATIOS = [
  [0, 'Original'], [1, '1:1'], [4 / 5, '4:5'], [3 / 4, '3:4'], [3 / 2, '3:2'], [16 / 9, '16:9'], [9 / 16, '9:16'],
];
const MAX_HISTORY = 40;

export function openEditor(project, opts = {}) {
  return new Editor(project, opts);
}

class Editor {
  constructor(project, { tab = 'background', onDone, onClose } = {}) {
    this.p = project;
    this.onDone = onDone;
    this.onClose = onClose;
    this.startState = cloneState(project.state);
    this.startMask = copyCanvas(project.mask);
    this.undoStack = [];
    this.redoStack = [];
    this.mode = null; // 'erase' | 'restore' | null
    this.brush = { size: 48, softness: 0.35 };
    this.ghost = true;
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.comparing = false;
    this.space = false;
    this.dirty = false;

    this.build();
    this.bind();
    this.setTab(tab);
    this.syncControls();
    requestAnimationFrame(() => { this.resize(); this.fit(); });
  }

  // ---------- DOM ----------
  build() {
    const el = document.createElement('div');
    el.className = 'ed-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Image editor');
    el.innerHTML = `
      <div class="ed">
        <header class="ed-top">
          <div class="ed-title" title=""></div>
          <div class="ed-tools">
            <button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)" disabled>${ICONS.undo}</button>
            <button class="icon-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)" disabled>${ICONS.redo}</button>
            <span class="ed-sep"></span>
            <button class="icon-btn" data-act="zoom-out" title="Zoom out">−</button>
            <button class="ed-zoom" data-act="fit" title="Fit to screen">100%</button>
            <button class="icon-btn" data-act="zoom-in" title="Zoom in">+</button>
            <span class="ed-sep"></span>
            <button class="btn btn-ghost btn-sm" data-act="compare" title="Hold to see the original">${ICONS.compare}<span>Hold to compare</span></button>
          </div>
          <div class="ed-actions">
            <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>
            <button class="btn btn-primary btn-sm" data-act="done">${ICONS.check}<span>Done</span></button>
          </div>
        </header>
        <div class="ed-body">
          <div class="ed-stage">
            <canvas class="ed-canvas"></canvas>
            <div class="brush-cursor"></div>
            <div class="ed-hint small"></div>
          </div>
          <aside class="ed-side">
            <nav class="ed-tabs" role="tablist">
              <button role="tab" data-tab="background">Background</button>
              <button role="tab" data-tab="brush">Erase / Restore</button>
              <button role="tab" data-tab="effects">Effects</button>
              <button role="tab" data-tab="crop">Crop</button>
            </nav>
            <div class="ed-panels">
              <section class="ed-panel" data-panel="background">
                <h4>Colors</h4>
                <div class="swatches">
                  <button class="sw sw-none" data-bg="none" title="Transparent" aria-label="Transparent"></button>
                  ${COLORS.map((c) => `<button class="sw" data-color="${c}" style="--c:${c}" title="${c}" aria-label="Color ${c}"></button>`).join('')}
                  <label class="sw sw-custom" title="Custom color"><input type="color" value="#5b3df5" data-custom-color aria-label="Custom color"></label>
                </div>
                <h4>Backdrops</h4>
                <div class="tiles">
                  <label class="tile tile-upload" title="Use your own photo">
                    <input type="file" accept="image/*" hidden data-bg-upload>
                    ${ICONS.upload}<span>Upload</span>
                  </label>
                  <button class="tile" data-bg-image hidden title="Your photo"></button>
                  ${BACKDROPS.map((b, i) => `<button class="tile" data-backdrop="${i}" title="${b.name}" style="background-image:url(${backdropThumb(i)})"><span>${b.name}</span></button>`).join('')}
                </div>
                <h4>Blur original background</h4>
                <button class="tile tile-wide" data-bg="blur"><span>Blur</span></button>
                <label class="field" data-blur-field>
                  <span>Blur amount <output data-out="blur"></output></span>
                  <input type="range" min="1" max="100" data-range="bg.blur">
                </label>
              </section>

              <section class="ed-panel" data-panel="brush">
                <div class="seg">
                  <button data-mode="erase">Erase</button>
                  <button data-mode="restore">Restore</button>
                </div>
                <label class="field"><span>Brush size <output data-out="size"></output></span>
                  <input type="range" min="4" max="240" data-brush="size"></label>
                <label class="field"><span>Edge softness <output data-out="softness"></output></span>
                  <input type="range" min="0" max="100" data-brush="softness"></label>
                <label class="check"><input type="checkbox" data-ghost> Show original faintly</label>
                <button class="btn btn-ghost btn-sm btn-block" data-act="reset-mask">Reset to AI result</button>
                <p class="muted small">Paint over areas to erase or bring them back. Tips: <kbd>[</kbd> <kbd>]</kbd> change size, hold <kbd>Space</kbd> and drag to pan, scroll/pinch to zoom.</p>
              </section>

              <section class="ed-panel" data-panel="effects">
                <label class="switch"><input type="checkbox" data-toggle="shadow.on"><span></span> Drop shadow</label>
                <div data-shadow-fields>
                  <label class="field"><span>Opacity <output data-out="shadow.opacity"></output></span>
                    <input type="range" min="0" max="100" data-range="shadow.opacity" data-scale="100"></label>
                  <label class="field"><span>Softness <output data-out="shadow.blur"></output></span>
                    <input type="range" min="0" max="100" data-range="shadow.blur"></label>
                  <label class="field"><span>Horizontal offset <output data-out="shadow.dx"></output></span>
                    <input type="range" min="-100" max="100" data-range="shadow.dx"></label>
                  <label class="field"><span>Vertical offset <output data-out="shadow.dy"></output></span>
                    <input type="range" min="-100" max="100" data-range="shadow.dy"></label>
                </div>
              </section>

              <section class="ed-panel" data-panel="crop">
                <label class="switch"><input type="checkbox" data-toggle="layout.trim"><span></span> Crop to subject</label>
                <label class="field" data-padding-field><span>Padding <output data-out="layout.padding"></output></span>
                  <input type="range" min="0" max="50" data-range="layout.padding" data-scale="100"></label>
                <h4>Aspect ratio</h4>
                <div class="chips">
                  ${RATIOS.map(([v, l]) => `<button class="chip" data-ratio="${v}">${l}</button>`).join('')}
                </div>
                <p class="muted small" data-out-size></p>
              </section>
            </div>
          </aside>
        </div>
      </div>`;
    document.body.append(el);
    document.body.classList.add('no-scroll');
    this.el = el;
    this.canvas = $('.ed-canvas', el);
    this.stage = $('.ed-stage', el);
    this.cursor = $('.brush-cursor', el);
    $('.ed-title', el).textContent = this.p.name;
    $('.ed-title', el).title = this.p.name;

    const tile = createCanvas(16, 16);
    const tctx = tile.getContext('2d');
    tctx.fillStyle = '#ffffff'; tctx.fillRect(0, 0, 16, 16);
    tctx.fillStyle = '#e4e6ec'; tctx.fillRect(0, 0, 8, 8); tctx.fillRect(8, 8, 8, 8);
    this.checker = this.canvas.getContext('2d').createPattern(tile, 'repeat');
    this.refreshBgImageTile();
  }

  refreshBgImageTile() {
    const t = $('[data-bg-image]', this.el);
    const bg = this.p.state.bg;
    if (bg.image) {
      const c = createCanvas(96, 96);
      const ctx = c.getContext('2d');
      const w = bg.image.width, h = bg.image.height, s = Math.max(96 / w, 96 / h);
      ctx.drawImage(bg.image, (96 - w * s) / 2, (96 - h * s) / 2, w * s, h * s);
      t.style.backgroundImage = `url(${c.toDataURL()})`;
      t.hidden = false;
    } else {
      t.hidden = true;
    }
  }

  // ---------- events ----------
  bind() {
    const el = this.el;
    el.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      if (t.dataset.tab) this.setTab(t.dataset.tab);
      else if (t.dataset.mode) this.setMode(t.dataset.mode);
      else if (t.dataset.color) this.change('bg', (s) => { s.bg.type = 'color'; s.bg.color = t.dataset.color; });
      else if (t.dataset.bg === 'none') this.change('bg', (s) => { s.bg.type = 'none'; });
      else if (t.dataset.bg === 'blur') this.change('bg', (s) => { s.bg.type = 'blur'; });
      else if (t.dataset.backdrop) this.change('bg', (s) => { s.bg.type = 'backdrop'; s.bg.backdrop = +t.dataset.backdrop; });
      else if (t.hasAttribute('data-bg-image')) this.change('bg', (s) => { s.bg.type = 'image'; });
      else if (t.dataset.ratio != null) this.change('ratio', (s) => { s.layout.ratio = +t.dataset.ratio; }, true);
      else if (t.dataset.act) this.action(t.dataset.act);
    });

    const compare = $('[data-act="compare"]', el);
    const setCompare = (on) => { this.comparing = on; compare.classList.toggle('active', on); this.requestDraw(); };
    compare.addEventListener('pointerdown', () => setCompare(true));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => compare.addEventListener(ev, () => setCompare(false)));

    $('[data-custom-color]', el).addEventListener('input', (e) => {
      this.change('bg-custom', (s) => { s.bg.type = 'color'; s.bg.color = e.target.value; });
    });

    $('[data-bg-upload]', el).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const img = await loadImage(file);
        this.change('bg', (s) => { s.bg.type = 'image'; s.bg.image = img; s.bg.imageBlob = file; });
        this.refreshBgImageTile();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $$('[data-range]', el).forEach((input) => {
      input.addEventListener('input', () => {
        const [group, key] = input.dataset.range.split('.');
        const scale = +(input.dataset.scale || 1);
        this.change(input.dataset.range, (s) => { s[group][key] = +input.value / scale; }, group === 'layout');
      });
    });
    $$('[data-toggle]', el).forEach((input) => {
      input.addEventListener('change', () => {
        const [group, key] = input.dataset.toggle.split('.');
        this.change(input.dataset.toggle, (s) => { s[group][key] = input.checked; }, group === 'layout');
      });
    });
    $$('[data-brush]', el).forEach((input) => {
      input.addEventListener('input', () => {
        const k = input.dataset.brush;
        this.brush[k] = k === 'softness' ? +input.value / 100 : +input.value;
        this.syncControls();
        this.updateCursorSize();
      });
    });
    $('[data-ghost]', el).addEventListener('change', (e) => { this.ghost = e.target.checked; this.requestDraw(); });

    // Canvas pointer handling
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => this.pointerUp(e));
    c.addEventListener('pointerleave', () => { this.cursor.style.display = 'none'; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = c.getBoundingClientRect();
        this.zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        this.view.ox -= e.deltaX;
        this.view.oy -= e.deltaY;
        this.requestDraw();
      }
    }, { passive: false });

    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => {
      if (e.code === 'Space') { this.space = false; this.stage.classList.remove('panning'); }
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.ro = new ResizeObserver(() => { this.resize(); this.fit(); });
    this.ro.observe(this.stage);
  }

  keyDown(e) {
    if (e.target.closest?.('input[type="color"]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if (e.code === 'Space' && !e.target.closest?.('button, input')) { e.preventDefault(); this.space = true; this.stage.classList.add('panning'); }
    else if (e.key === '[' || e.key === ']') {
      this.brush.size = Math.max(4, Math.min(240, this.brush.size + (e.key === ']' ? 8 : -8)));
      this.syncControls();
      this.updateCursorSize();
    }
    else if (e.key === 'Escape') this.action('cancel');
  }

  // ---------- tabs & modes ----------
  setTab(tab) {
    this.tab = tab;
    $$('[data-tab]', this.el).forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    $$('[data-panel]', this.el).forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    this.setMode(tab === 'brush' ? (this.mode || 'erase') : null);
  }

  setMode(mode) {
    this.mode = mode;
    $$('[data-mode]', this.el).forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    this.stage.classList.toggle('brushing', !!mode);
    $('.ed-hint', this.el).textContent = mode
      ? (mode === 'erase' ? 'Paint to erase' : 'Paint to restore')
      : 'Drag to move · scroll or pinch to zoom';
    this.requestDraw();
  }

  // ---------- state changes & history ----------
  change(key, fn, relayout = false) {
    const before = cloneState(this.p.state);
    fn(this.p.state);
    const after = cloneState(this.p.state);
    const top = this.undoStack[this.undoStack.length - 1];
    const now = performance.now();
    if (top && top.kind === 'state' && top.key === key && now - top.t < 800) {
      top.after = after;
      top.t = now;
    } else {
      this.push({ kind: 'state', key, before, after, t: now });
    }
    this.dirty = true;
    this.syncControls();
    if (relayout) this.fit(); else this.requestDraw();
  }

  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.updateHistoryButtons();
  }

  apply(entry, dir) {
    if (entry.kind === 'state') {
      this.p.state = cloneState(dir === 'undo' ? entry.before : entry.after);
      this.refreshBgImageTile();
      this.syncControls();
      this.fit();
    } else {
      const { rect } = entry;
      this.p.mask.getContext('2d').putImageData(dir === 'undo' ? entry.before : entry.after, rect.x, rect.y);
      this.p.updateCutout(rect);
      this.p.invalidate();
      this.requestDraw();
    }
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this.apply(e, 'undo');
    this.redoStack.push(e);
    this.updateHistoryButtons();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.apply(e, 'redo');
    this.undoStack.push(e);
    this.updateHistoryButtons();
  }

  updateHistoryButtons() {
    $('[data-act="undo"]', this.el).disabled = !this.undoStack.length;
    $('[data-act="redo"]', this.el).disabled = !this.redoStack.length;
  }

  syncControls() {
    const s = this.p.state;
    const el = this.el;
    $$('.sw, .tile', el).forEach((b) => b.classList.remove('active'));
    const bg = s.bg;
    const sel = bg.type === 'none' ? '[data-bg="none"]'
      : bg.type === 'blur' ? '[data-bg="blur"]'
      : bg.type === 'backdrop' ? `[data-backdrop="${bg.backdrop}"]`
      : bg.type === 'image' ? '[data-bg-image]'
      : `[data-color="${bg.color}"]`;
    const active = $(sel, el) || (bg.type === 'color' ? $('.sw-custom', el) : null);
    active?.classList.add('active');
    $('.sw-custom', el).style.setProperty('--c', bg.type === 'color' ? bg.color : 'transparent');
    $('[data-blur-field]', el).hidden = bg.type !== 'blur';

    $$('[data-range]', el).forEach((input) => {
      const [g, k] = input.dataset.range.split('.');
      input.value = s[g][k] * +(input.dataset.scale || 1);
    });
    $$('[data-toggle]', el).forEach((input) => {
      const [g, k] = input.dataset.toggle.split('.');
      input.checked = !!s[g][k];
    });
    $('[data-shadow-fields]', el).classList.toggle('disabled', !s.shadow.on);
    $('[data-padding-field]', el).classList.toggle('disabled', !s.layout.trim);
    $$('[data-ratio]', el).forEach((b) => b.classList.toggle('active', Math.abs(+b.dataset.ratio - s.layout.ratio) < 1e-6));

    const out = (k, v) => { const o = $(`[data-out="${k}"]`, el); if (o) o.textContent = v; };
    out('blur', s.bg.blur);
    out('shadow.opacity', `${Math.round(s.shadow.opacity * 100)}%`);
    out('shadow.blur', s.shadow.blur);
    out('shadow.dx', s.shadow.dx);
    out('shadow.dy', s.shadow.dy);
    out('layout.padding', `${Math.round(s.layout.padding * 100)}%`);
    out('size', `${this.brush.size}px`);
    out('softness', `${Math.round(this.brush.softness * 100)}%`);
    $('[data-brush="size"]', el).value = this.brush.size;
    $('[data-brush="softness"]', el).value = Math.round(this.brush.softness * 100);
    $('[data-ghost]', el).checked = this.ghost;
    const r = this.p.layout();
    $('[data-out-size]', el).textContent = `Output size: ${r.w} × ${r.h} px`;
  }

  action(act) {
    switch (act) {
      case 'undo': return this.undo();
      case 'redo': return this.redo();
      case 'zoom-in': return this.zoomAt(1.25);
      case 'zoom-out': return this.zoomAt(0.8);
      case 'fit': return this.fit();
      case 'reset-mask': {
        const before = this.p.mask.getContext('2d').getImageData(0, 0, this.p.width, this.p.height);
        this.p.resetMask();
        const after = this.p.mask.getContext('2d').getImageData(0, 0, this.p.width, this.p.height);
        this.push({ kind: 'mask', rect: { x: 0, y: 0, w: this.p.width, h: this.p.height }, before, after });
        this.dirty = true;
        return this.requestDraw();
      }
      case 'cancel': {
        if (this.dirty && !confirm('Discard your changes?')) return;
        this.p.state = this.startState;
        copyCanvas(this.startMask, this.p.mask);
        this.p.updateCutout();
        this.p.invalidate();
        return this.close();
      }
      case 'done':
        this.close();
        return this.onDone?.(this.p, this.dirty);
    }
  }

  close() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.ro.disconnect();
    this.el.remove();
    document.body.classList.remove('no-scroll');
    this.onClose?.(this.p);
  }

  // ---------- view ----------
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.stage;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  fit() {
    const r = this.p.layout();
    const { clientWidth: w, clientHeight: h } = this.stage;
    const pad = w < 600 ? 16 : 48;
    const scale = Math.min((w - pad * 2) / r.w, (h - pad * 2) / r.h);
    this.view = { scale, ox: (w - r.w * scale) / 2, oy: (h - r.h * scale) / 2 };
    this.syncControls();
    this.requestDraw();
  }

  zoomAt(factor, cx, cy) {
    const { clientWidth: w, clientHeight: h } = this.stage;
    cx ??= w / 2;
    cy ??= h / 2;
    const v = this.view;
    const scale = Math.max(0.02, Math.min(16, v.scale * factor));
    const f = scale / v.scale;
    this.view = { scale, ox: cx - (cx - v.ox) * f, oy: cy - (cy - v.oy) * f };
    this.updateCursorSize();
    this.requestDraw();
  }

  requestDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.draw();
    });
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const { scale, ox, oy } = this.view;
    const r = this.p.layout();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.checker;
    ctx.fillRect(Math.round(ox * dpr), Math.round(oy * dpr), Math.round(r.w * scale * dpr), Math.round(r.h * scale * dpr));
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
    this.p.render(ctx, { deviceScale: scale * dpr, ghost: !!this.mode && this.ghost, showOriginal: this.comparing });
    $('.ed-zoom', this.el).textContent = `${Math.round(scale * 100)}%`;
  }

  // ---------- pointer / brush ----------
  toImage(e) {
    const rect = this.canvas.getBoundingClientRect();
    const r = this.p.layout();
    const { scale, ox, oy } = this.view;
    return { x: (e.clientX - rect.left - ox) / scale + r.x, y: (e.clientY - rect.top - oy) / scale + r.y };
  }

  updateCursorSize() {
    const d = this.brush.size;
    this.cursor.style.width = this.cursor.style.height = `${d}px`;
  }

  pointerDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    if (!this.mode || this.space || e.button === 1) {
      this.pan = { x: e.clientX, y: e.clientY };
      this.stage.classList.add('grabbing');
      return;
    }
    if (e.button !== 0) return;
    this.stroke = { rect: null, last: null };
    this.backup = copyCanvas(this.p.mask, this.backup);
    this.strokeTo(e);
  }

  pointerMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (this.mode && !this.space) {
      this.cursor.style.display = 'block';
      this.cursor.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px) translate(-50%, -50%)`;
      this.updateCursorSize();
    }
    if (this.pan) {
      this.view.ox += e.clientX - this.pan.x;
      this.view.oy += e.clientY - this.pan.y;
      this.pan = { x: e.clientX, y: e.clientY };
      this.requestDraw();
    } else if (this.stroke) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) this.strokeTo(ev);
    }
  }

  pointerUp() {
    if (this.pan) {
      this.pan = null;
      this.stage.classList.remove('grabbing');
    }
    if (this.stroke) {
      const { rect } = this.stroke;
      this.stroke = null;
      if (!rect) return;
      const before = this.backup.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h);
      const after = this.p.mask.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h);
      this.push({ kind: 'mask', rect, before, after });
      this.p.invalidate();
      this.dirty = true;
      if (this.p.state.layout.trim) this.fit();
    }
  }

  strokeTo(e) {
    const pt = this.toImage(e);
    const radius = this.brush.size / 2 / this.view.scale;
    const from = this.stroke.last || pt;
    const dist = Math.hypot(pt.x - from.x, pt.y - from.y);
    const step = Math.max(0.5, radius * 0.15);
    const n = Math.max(1, Math.ceil(dist / step));
    const ctx = this.p.mask.getContext('2d');
    const hard = 1 - this.brush.softness;
    ctx.save();
    ctx.globalCompositeOperation = this.mode === 'erase' ? 'destination-out' : 'source-over';
    for (let i = this.stroke.last ? 1 : 0; i <= n; i++) {
      const t = i / n;
      const x = from.x + (pt.x - from.x) * t;
      const y = from.y + (pt.y - from.y) * t;
      if (hard > 0.98) {
        ctx.fillStyle = '#000';
      } else {
        const g = ctx.createRadialGradient(x, y, radius * hard, x, y, radius);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    this.stroke.last = pt;

    const x0 = Math.max(0, Math.floor(Math.min(from.x, pt.x) - radius - 2));
    const y0 = Math.max(0, Math.floor(Math.min(from.y, pt.y) - radius - 2));
    const x1 = Math.min(this.p.width, Math.ceil(Math.max(from.x, pt.x) + radius + 2));
    const y1 = Math.min(this.p.height, Math.ceil(Math.max(from.y, pt.y) + radius + 2));
    if (x1 <= x0 || y1 <= y0) return;
    const seg = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.p.updateCutout(seg);
    const r = this.stroke.rect;
    this.stroke.rect = r
      ? (() => {
          const nx = Math.min(r.x, seg.x), ny = Math.min(r.y, seg.y);
          return { x: nx, y: ny, w: Math.max(r.x + r.w, seg.x + seg.w) - nx, h: Math.max(r.y + r.h, seg.y + seg.h) - ny };
        })()
      : seg;
    this.requestDraw();
  }
}
