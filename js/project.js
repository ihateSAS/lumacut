// A Project holds one image, its alpha mask and the edit state (background,
// shadow, crop). Everything the editor, previews and exports draw goes through
// Project#render so they always match.

import { createCanvas, copyCanvas, loadImage, toCanvas, sizeOf, estimateForeground } from './engine.js';

const EXPORT_MAX = 8000;
const PREVIEW_PIXELS = 250_000;

export const COLORS = [
  '#ffffff', '#000000', '#f1f2f6', '#d9dce3', '#fde68a', '#fdba74', '#fca5a5', '#f9a8d4',
  '#c4b5fd', '#93c5fd', '#67e8f9', '#6ee7b7', '#bef264', '#1e3a8a', '#14532d', '#7c2d12',
];

const linear = (stops, angle = 90) => (ctx, w, h) => {
  const a = (angle * Math.PI) / 180;
  const cx = w / 2, cy = h / 2;
  const len = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
  const dx = Math.sin(a) * len, dy = -Math.cos(a) * len;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

const radial = (inner, outer, cyRatio = 0.45) => (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h * cyRatio, 0, w / 2, h * cyRatio, Math.max(w, h) * 0.8);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};

export const BACKDROPS = [
  { name: 'Studio', draw: radial('#ffffff', '#c9ced8') },
  { name: 'Horizon', draw: linear([[0, '#f1ede6'], [0.64, '#dcd4c8'], [0.66, '#c9bfb0'], [1, '#e6e0d6']], 180) },
  { name: 'Slate', draw: linear([[0, '#e2e8f0'], [0.64, '#b8c2d1'], [0.66, '#9aa6b8'], [1, '#c7d0dc']], 180) },
  { name: 'Sunset', draw: linear([[0, '#ff9a8b'], [0.55, '#ff6a88'], [1, '#ffd29d']], 160) },
  { name: 'Mint', draw: linear([[0, '#d4fc79'], [1, '#96e6a1']], 135) },
  { name: 'Sky', draw: linear([[0, '#a1c4fd'], [1, '#c2e9fb']], 180) },
  { name: 'Peach', draw: linear([[0, '#ffecd2'], [1, '#fcb69f']], 135) },
  { name: 'Lilac', draw: linear([[0, '#e0c3fc'], [1, '#8ec5fc']], 135) },
  { name: 'Night', draw: radial('#3b4a7a', '#0b1026', 0.4) },
  { name: 'Ember', draw: radial('#5a2a1c', '#140807', 0.4) },
];

export const DEFAULT_STATE = {
  bg: { type: 'none', color: '#ffffff', backdrop: 0, blur: 40, image: null, imageBlob: null },
  shadow: { on: false, opacity: 0.35, blur: 40, dx: 0, dy: 25 },
  layout: { trim: false, padding: 0.08, ratio: 0 },
};

export function cloneState(s) {
  return { bg: { ...s.bg }, shadow: { ...s.shadow }, layout: { ...s.layout } };
}

export function backdropThumb(i, w = 96, h = 96) {
  const c = createCanvas(w, h);
  BACKDROPS[i].draw(c.getContext('2d'), w, h);
  return c.toDataURL();
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image (it may be too large).'))), type, quality);
  });
}

function drawCover(ctx, img, W, H) {
  const { w: iw, h: ih } = sizeOf(img);
  const s = Math.max(W / iw, H / ih);
  ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}

const SUPPORTS_FILTER = (() => {
  try {
    const ctx = createCanvas(1, 1).getContext('2d');
    ctx.filter = 'blur(2px)';
    return ctx.filter === 'blur(2px)';
  } catch { return false; }
})();

function blurCanvas(src, amount) {
  const s = Math.min(1, 1024 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const radius = Math.max(0.5, (amount / 100) * 0.035 * Math.max(w, h));
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (SUPPORTS_FILTER) {
    const pad = radius * 2;
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src, -pad, -pad, w + pad * 2, h + pad * 2); // fills the edges
    ctx.drawImage(src, 0, 0, w, h);
  } else {
    // Fallback (older Safari): downscale then upscale in two steps.
    const f = Math.max(1, radius / 1.2);
    const tiny = createCanvas(w / f, h / f);
    tiny.getContext('2d').drawImage(src, 0, 0, tiny.width, tiny.height);
    const mid = createCanvas(Math.min(w, tiny.width * 4), Math.min(h, tiny.height * 4));
    const mctx = mid.getContext('2d');
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(tiny, 0, 0, mid.width, mid.height);
    ctx.drawImage(mid, 0, 0, w, h);
  }
  return out;
}

let idCounter = 0;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}-${idCounter++}`);

export class Project {
  constructor(original, mask, { id, name = 'image', state, sourceBlob = null, created, foreground = null, model = null } = {}) {
    this.id = id || newId();
    this.name = name;
    this.created = created || Date.now();
    this.sourceBlob = sourceBlob;
    this.original = original;
    this.foreground = foreground || original; // edge-decontaminated colours
    this.mask = mask;
    this.model = model;
    this.width = original.width;
    this.height = original.height;
    this.initialMask = copyCanvas(mask);
    this.cutout = createCanvas(this.width, this.height);
    this.state = cloneState(state || DEFAULT_STATE);
    this._box = null;
    this._blur = null;
    this.updateCutout();
  }

  get baseName() {
    return this.name.replace(/\.[a-z0-9]+$/i, '') || 'image';
  }

  /** Recompose the transparent cut-out (original ∘ mask), optionally only inside a rect. */
  updateCutout(rect) {
    const r = rect || { x: 0, y: 0, w: this.width, h: this.height };
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    const w = Math.min(this.width - x, Math.ceil(r.w + (r.x - x))), h = Math.min(this.height - y, Math.ceil(r.h + (r.y - y)));
    if (w <= 0 || h <= 0) return;
    const ctx = this.cutout.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(this.foreground, x, y, w, h, x, y, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.mask, x, y, w, h, x, y, w, h);
    ctx.restore();
  }

  /** Call after mask edits are finished so the subject bounds are recomputed. */
  invalidate() { this._box = null; }

  resetMask() {
    copyCanvas(this.initialMask, this.mask);
    this.updateCutout();
    this.invalidate();
  }

  /** Bounding box of the foreground in image pixels. */
  subjectBox() {
    if (this._box) return this._box;
    const s = Math.min(1, 512 / Math.max(this.width, this.height));
    const w = Math.max(1, Math.round(this.width * s)), h = Math.max(1, Math.round(this.height * s));
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.mask, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return (this._box = { x: 0, y: 0, w: this.width, h: this.height });
    const bx = Math.max(0, Math.floor(x0 / s)), by = Math.max(0, Math.floor(y0 / s));
    const bx1 = Math.min(this.width, Math.ceil((x1 + 1) / s)), by1 = Math.min(this.height, Math.ceil((y1 + 1) / s));
    return (this._box = { x: bx, y: by, w: bx1 - bx, h: by1 - by });
  }

  /** The region of image space that becomes the output canvas. */
  layout() {
    const L = this.state.layout;
    let r = { x: 0, y: 0, w: this.width, h: this.height };
    if (L.trim) {
      r = { ...this.subjectBox() };
      const p = L.padding * Math.max(r.w, r.h);
      r = { x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 };
    }
    if (L.ratio) {
      if (r.w / r.h < L.ratio) {
        const nw = r.h * L.ratio;
        r.x -= (nw - r.w) / 2;
        r.w = nw;
      } else {
        const nh = r.w / L.ratio;
        r.y -= (nh - r.h) / 2;
        r.h = nh;
      }
    }
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
  }

  _drawBlur(ctx, r) {
    const amount = this.state.bg.blur;
    if (!this._blur || this._blur.amount !== amount) this._blur = { amount, canvas: blurCanvas(this.original, amount) };
    const b = this._blur.canvas;
    if (r.x < 0 || r.y < 0 || r.x + r.w > this.width || r.y + r.h > this.height) drawCover(ctx, b, r.w, r.h);
    ctx.drawImage(b, -r.x, -r.y, this.width, this.height);
  }

  /**
   * Draw the final composition in output coordinates (0..w, 0..h of layout()).
   * The caller sets the transform; `deviceScale` is the total scale from output
   * pixels to device pixels (needed because canvas shadows ignore transforms).
   */
  render(ctx, { deviceScale = 1, ghost = false, showOriginal = false } = {}) {
    const r = this.layout();
    const { bg, shadow } = this.state;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (showOriginal) {
      ctx.drawImage(this.original, -r.x, -r.y);
      ctx.restore();
      return;
    }

    if (bg.type === 'color') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, r.w, r.h);
    } else if (bg.type === 'backdrop') {
      (BACKDROPS[bg.backdrop] || BACKDROPS[0]).draw(ctx, r.w, r.h);
    } else if (bg.type === 'image' && bg.image) {
      drawCover(ctx, bg.image, r.w, r.h);
    } else if (bg.type === 'blur') {
      this._drawBlur(ctx, r);
    }

    if (ghost) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(this.original, -r.x, -r.y);
      ctx.globalAlpha = 1;
    }

    if (shadow.on) {
      const m = Math.max(this.subjectBox().w, this.subjectBox().h);
      ctx.shadowColor = `rgba(0,0,0,${shadow.opacity})`;
      ctx.shadowBlur = (shadow.blur / 100) * 0.12 * m * deviceScale;
      ctx.shadowOffsetX = (shadow.dx / 100) * 0.1 * m * deviceScale;
      ctx.shadowOffsetY = (shadow.dy / 100) * 0.1 * m * deviceScale;
    }
    ctx.drawImage(this.cutout, -r.x, -r.y);
    ctx.restore();
  }

  /** Output dimensions for a download size option. */
  outputSize(size = 'full') {
    const r = this.layout();
    let s = size === 'preview' ? Math.min(1, Math.sqrt(PREVIEW_PIXELS / (r.w * r.h))) : size === 'half' ? 0.5 : 1;
    s = Math.min(s, EXPORT_MAX / Math.max(r.w, r.h));
    return { w: Math.max(1, Math.round(r.w * s)), h: Math.max(1, Math.round(r.h * s)) };
  }

  renderToCanvas(size = 'full', { opaque = false } = {}) {
    const r = this.layout();
    const { w, h } = typeof size === 'object' ? size : this.outputSize(size);
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    if (opaque) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.setTransform(w / r.w, 0, 0, h / r.h, 0, 0);
    this.render(ctx, { deviceScale: w / r.w });
    return c;
  }

  toBlob({ type = 'image/png', size = 'full', quality = 0.92 } = {}) {
    return canvasToBlob(this.renderToCanvas(size, { opaque: type === 'image/jpeg' }), type, quality);
  }

  thumbnail(max = 320) {
    const r = this.layout();
    const s = Math.min(1, max / Math.max(r.w, r.h));
    return this.renderToCanvas({ w: Math.max(1, Math.round(r.w * s)), h: Math.max(1, Math.round(r.h * s)) }).toDataURL('image/png');
  }

  fileName(type = 'image/png') {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type] || 'png';
    const edited = this.state.bg.type !== 'none' || this.state.shadow.on || this.state.layout.trim || this.state.layout.ratio;
    return `${this.baseName}-${edited ? 'edited' : 'nobg'}.${ext}`;
  }

  // ---------- persistence ----------
  /** Edit state in a form IndexedDB can store (the background image stays as its Blob). */
  storableState() {
    const { image, ...bg } = this.state.bg;
    return { bg, shadow: { ...this.state.shadow }, layout: { ...this.state.layout } };
  }

  async toRecord() {
    return {
      id: this.id,
      name: this.name,
      created: this.created,
      updated: Date.now(),
      state: this.storableState(),
      original: this.sourceBlob || await canvasToBlob(this.original, 'image/png'),
      mask: await canvasToBlob(this.mask, 'image/png'),
      thumb: this.thumbnail(240),
      width: this.width,
      height: this.height,
      model: this.model,
    };
  }

  static async fromRecord(rec) {
    const img = await loadImage(rec.original);
    const original = toCanvas(img);
    const maskImg = await loadImage(rec.mask);
    const mask = createCanvas(original.width, original.height);
    mask.getContext('2d').drawImage(maskImg, 0, 0, mask.width, mask.height);
    const state = cloneState({ ...DEFAULT_STATE, ...rec.state, bg: { ...DEFAULT_STATE.bg, ...rec.state?.bg } });
    if (state.bg.imageBlob) {
      try { state.bg.image = await loadImage(state.bg.imageBlob); } catch { state.bg.type = 'none'; }
    }
    const foreground = await estimateForeground(original, mask);
    return new Project(original, mask, {
      id: rec.id, name: rec.name, created: rec.created, state, sourceBlob: rec.original, foreground, model: rec.model,
    });
  }
}
