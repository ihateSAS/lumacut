// Background removal engine with two backends:
//  - server:  BiRefNet + ViTMatte on the local GPU server (best quality, ~2 s)
//  - browser: RMBG-1.4 via Transformers.js (WebGPU/WASM, works with any static host)
// Browser masks get a guided filter to snap edges to the photo; both then get
// edge-colour decontamination in a Web Worker.

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
export const MAX_SIDE = 4096;
const MODEL_INPUT = 1024;
const SERVER_UPLOAD_SIDE = 2048;
const REFINE_MAX_SIDE = 2048;
const PREF_KEY = 'lumacut-model';

export const MODELS = {
  birefnet: {
    backend: 'server',
    label: 'BiRefNet + ViTMatte — best quality',
    short: 'BiRefNet + ViTMatte',
    size: '830 MB',
    license: 'MIT / Apache-2.0',
    commercial: true,
  },
  rmbg: {
    backend: 'browser',
    id: 'briaai/RMBG-1.4',
    label: 'RMBG-1.4 — fast, runs in browser',
    short: 'RMBG-1.4',
    size: (caps) => (caps.webgpu ? '176 MB' : '44 MB'),
    license: 'non-commercial',
    commercial: false,
  },
};

// ---------- status broadcasting ----------
const listeners = new Set();
let status = { stage: 'idle', progress: 0, loaded: 0, total: 0, device: null, model: null };

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of listeners) {
    try { fn(status); } catch (err) { console.error(err); }
  }
}

export function getStatus() { return status; }

export function onStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

// ---------- canvas helpers ----------
export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function copyCanvas(src, target) {
  const c = target || createCanvas(src.width, src.height);
  if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

export function sizeOf(img) {
  return {
    w: img.naturalWidth || img.videoWidth || img.width,
    h: img.naturalHeight || img.videoHeight || img.height,
  };
}

/** Draw any drawable into a new canvas, downscaling so the long side is <= maxSide. */
export function toCanvas(drawable, maxSide = MAX_SIDE) {
  let { w, h } = sizeOf(drawable);
  if (!w || !h) { w = 1024; h = 1024; } // e.g. SVG without intrinsic size
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = createCanvas(w * s, h * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawable, 0, 0, c.width, c.height);
  return c;
}

/** Accepts File/Blob, URL string, <img>, ImageBitmap or canvas. Returns something drawable. */
export async function loadImage(source) {
  if (typeof source === 'string') {
    let res;
    try {
      res = await fetch(source, { mode: 'cors' });
    } catch {
      throw new Error('Could not load that URL. The site may block access from other websites — try downloading the image and uploading it instead.');
    }
    if (!res.ok) throw new Error(`Could not load that URL (HTTP ${res.status}).`);
    source = await res.blob();
  }
  if (source instanceof Blob) {
    if (source.type && !source.type.startsWith('image/')) {
      throw new Error('That file doesn’t look like an image. Supported formats: JPG, PNG, WebP, GIF, BMP, AVIF.');
    }
    try {
      return await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch {
      const url = URL.createObjectURL(source);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } catch {
        throw new Error('Your browser can’t decode this image format. Try JPG, PNG or WebP.');
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    }
  }
  return source;
}

// ---------- capabilities & model choice ----------
let gpuPromise = null;
let serverCache = { t: 0, value: null };

async function gpuCaps() {
  gpuPromise ||= (async () => {
    try {
      const adapter = navigator.gpu && await navigator.gpu.requestAdapter();
      if (adapter) return { webgpu: true };
    } catch { /* fall through */ }
    return { webgpu: false };
  })();
  return gpuPromise;
}

/** Status of the local BiRefNet server, or null when the site is served statically. */
export async function serverStatus({ fresh = false } = {}) {
  if (!fresh && Date.now() - serverCache.t < 3000) return serverCache.value;
  let value = null;
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.ok && res.headers.get('content-type')?.includes('json')) value = await res.json();
  } catch { /* no server */ }
  serverCache = { t: Date.now(), value };
  return value;
}

export async function getCapabilities() {
  const [gpu, server] = await Promise.all([gpuCaps(), serverStatus()]);
  return { ...gpu, server: server && server.status !== 'error' ? server : null };
}

export function isSupported(key, caps) {
  const m = MODELS[key];
  if (!m) return false;
  return m.backend === 'server' ? !!caps.server : true;
}

export function unsupportedReason(key) {
  return MODELS[key]?.backend === 'server' ? 'run “./start.sh” to enable' : '';
}

export function modelSize(key, caps) {
  const s = MODELS[key].size;
  return typeof s === 'function' ? s(caps) : s;
}

export function autoModel(caps) {
  return caps.server ? 'birefnet' : 'rmbg';
}

export function getPreferredModel() {
  try { return localStorage.getItem(PREF_KEY) || 'auto'; } catch { return 'auto'; }
}

export function setPreferredModel(key) {
  try { localStorage.setItem(PREF_KEY, key); } catch { /* ignore */ }
}

/** Resolve 'auto' / unavailable choices to a concrete model key. */
export async function resolveModel(key = getPreferredModel()) {
  const caps = await getCapabilities();
  return key !== 'auto' && isSupported(key, caps) ? key : autoModel(caps);
}

// ---------- browser backend (RMBG-1.4) ----------
let browserModel = null;

export function loadModel() {
  browserModel ||= initBrowserModel().catch((err) => {
    browserModel = null;
    setStatus({ stage: 'error', error: err });
    throw err;
  });
  return browserModel;
}

async function initBrowserModel() {
  const { webgpu } = await gpuCaps();
  setStatus({ stage: 'loading', progress: 0, loaded: 0, total: 0, model: 'rmbg' });
  const { AutoModel, AutoProcessor, RawImage, env } = await import(TRANSFORMERS_URL);
  env.allowLocalModels = false;

  const files = new Map();
  const progress_callback = (p) => {
    if (!p.file) return;
    if (p.status === 'progress' && p.total) files.set(p.file, { loaded: p.loaded, total: p.total });
    else if (p.status === 'done' && files.has(p.file)) files.get(p.file).loaded = files.get(p.file).total;
    else return;
    let l = 0, t = 0;
    for (const f of files.values()) { l += f.loaded; t += f.total; }
    setStatus({ stage: 'loading', loaded: l, total: t, progress: t ? l / t : 0 });
  };

  const load = (device) => AutoModel.from_pretrained(MODELS.rmbg.id, {
    config: { model_type: 'custom' },
    device,
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback,
  });
  let device = webgpu ? 'webgpu' : 'wasm';
  let model;
  try {
    model = await load(device);
  } catch (err) {
    if (device !== 'webgpu') throw err;
    console.warn('WebGPU failed, falling back to WASM', err);
    device = 'wasm';
    files.clear();
    model = await load(device);
  }
  const processor = await AutoProcessor.from_pretrained(MODELS.rmbg.id, {
    config: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      feature_extractor_type: 'ImageFeatureExtractor',
      image_std: [1, 1, 1],
      resample: 2,
      rescale_factor: 1 / 255,
      size: { width: MODEL_INPUT, height: MODEL_INPUT },
    },
  });
  setStatus({ stage: 'ready', progress: 1, device, model: 'rmbg' });
  return { model, processor, RawImage, device };
}

async function browserMask(original) {
  const { model, processor, RawImage, device } = await loadModel();
  setStatus({ stage: 'processing', model: 'rmbg', device });
  const small = toCanvas(original, MODEL_INPUT);
  const { data } = small.getContext('2d').getImageData(0, 0, small.width, small.height);
  const rgb = new Uint8ClampedArray(small.width * small.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
  }
  const { pixel_values } = await processor(new RawImage(rgb, small.width, small.height, 3));
  const { output } = await model({ input: pixel_values });
  const [h, w] = output.dims.slice(-2);
  const v = output.data;
  // RMBG-1.4's reference post-processing: min-max normalise.
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < w * h; i++) { if (v[i] < min) min = v[i]; if (v[i] > max) max = v[i]; }
  const range = max - min || 1;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = ((v[i] - min) / range) * 255;
  output.dispose?.();
  pixel_values.dispose?.();
  return { alpha, w, h };
}

// ---------- server backend (BiRefNet + ViTMatte) ----------
async function waitForServer() {
  for (;;) {
    const st = await serverStatus({ fresh: true });
    if (!st) throw new Error('The local AI server isn’t running. Start it with “./start.sh”, or pick RMBG-1.4.');
    if (st.status === 'ready') return st;
    if (st.status === 'error') throw new Error(`AI server error: ${st.error}`);
    setStatus({ stage: 'loading', model: 'birefnet', device: 'server', loaded: 0, total: 0, progress: 0 });
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Sends the photo (long side <= SERVER_UPLOAD_SIDE) and gets back a finished alpha matte. */
async function serverMatte(original) {
  await waitForServer();
  setStatus({ stage: 'processing', model: 'birefnet', device: 'server' });
  const upload = toCanvas(original, SERVER_UPLOAD_SIDE);
  const body = await new Promise((resolve, reject) => {
    upload.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.95);
  });
  const res = await fetch('/api/matte', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(`AI server failed: ${msg}`);
  }
  const bitmap = await createImageBitmap(await res.blob());
  const { width: w, height: h } = bitmap;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const d = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4];
  return { alpha, w, h, matted: true };
}

// ---------- segmentation ----------
let browserQueue = Promise.resolve();
const SERVER_CONCURRENCY = 2;
let serverActive = 0;
const serverWaiting = [];

/** Run fn when one of the server slots is free. */
async function withServerSlot(fn) {
  if (serverActive >= SERVER_CONCURRENCY) await new Promise((resolve) => serverWaiting.push(resolve));
  serverActive++;
  try {
    return await fn();
  } finally {
    serverActive--;
    serverWaiting.shift()?.();
  }
}

/**
 * Segment the foreground of an image.
 * Resolves to { original, mask, foreground, model }:
 *  - original:   the input as a canvas (long side <= MAX_SIDE)
 *  - mask:       same size, black with the foreground probability in alpha
 *  - foreground: the original with edge colours decontaminated (use it for the cut-out)
 * Browser-model jobs run one at a time. Server jobs overlap two at a time, so
 * one image uploads and gets its colour clean-up while the GPU works on the next.
 * `onStart(modelKey)` fires when this image actually begins processing.
 */
export async function segment(source, { model, onStart } = {}) {
  const key = await resolveModel(model);
  if (MODELS[key].backend === 'server') return withServerSlot(() => runSegment(source, key, onStart));
  const job = browserQueue.then(() => runSegment(source, key, onStart));
  browserQueue = job.catch(() => {});
  return job;
}

async function runSegment(source, key, onStart) {
  onStart?.(key);
  const drawable = await loadImage(source);
  const original = toCanvas(drawable);
  if (typeof drawable.close === 'function' && drawable !== source) drawable.close();

  try {
    const { alpha, w, h, matted } = key === 'birefnet' ? await serverMatte(original) : await browserMask(original);

    const small = createCanvas(w, h);
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = alpha[i];
    sctx.putImageData(img, 0, 0);

    const raw = createCanvas(original.width, original.height);
    const mctx = raw.getContext('2d');
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(small, 0, 0, raw.width, raw.height);

    setStatus({ stage: 'refining' });
    // ViTMatte output is already a true matte; only the browser model needs edge snapping.
    const mask = matted ? raw : await refineMask(original, raw);
    const foreground = await estimateForeground(original, mask);
    return { original, mask, foreground, model: key };
  } finally {
    setStatus({ stage: 'ready' });
  }
}

// ---------- edge colour refinement ----------
let worker = null;
let workerSeq = 0;
const pending = new Map();

function refineWorker() {
  if (!worker) {
    worker = new Worker(new URL('./refine.worker.js', import.meta.url));
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.error ? p.reject(new Error(data.error)) : p.resolve(data.out);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Refinement worker failed'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function callWorker(msg, transfer) {
  const id = ++workerSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    refineWorker().postMessage({ id, ...msg }, transfer);
  });
}

/** Photo and mask alpha at a working resolution (long side <= REFINE_MAX_SIDE). */
function workingPixels(original, mask) {
  const W = original.width, H = original.height;
  const s = Math.min(1, REFINE_MAX_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(original, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(mask, 0, 0, w, h);
  const m = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = m[i * 4 + 3];
  return { rgba, alpha, w, h };
}

/**
 * Edge-aware mask refinement: a colour guided filter snaps the model's soft,
 * low-resolution edges onto the real edges in the photo. Returns a new mask.
 */
export async function refineMask(original, mask, { radius = 8, eps = 1e-4 } = {}) {
  try {
    const { rgba, alpha, w, h } = workingPixels(original, mask);
    const r = Math.max(1, Math.round(radius * (Math.max(w, h) / 1024)));
    const out = await callWorker({ op: 'guided', rgba, alpha, w, h, r, eps }, [rgba.buffer, alpha.buffer]);
    const small = createCanvas(w, h);
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(w, h);
    for (let i = 0; i < out.length; i++) img.data[i * 4 + 3] = out[i];
    sctx.putImageData(img, 0, 0);
    const refined = createCanvas(original.width, original.height);
    const rctx = refined.getContext('2d');
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(small, 0, 0, refined.width, refined.height);
    return refined;
  } catch (err) {
    console.warn('Mask refinement failed; using raw mask', err);
    return mask;
  }
}

/**
 * Returns a copy of `original` where semi-transparent edge pixels carry the
 * estimated true foreground colour instead of foreground+background blended.
 * Fully opaque and fully transparent pixels keep their original colour, so the
 * restore brush still brings back the real photo.
 */
export async function estimateForeground(original, mask) {
  const W = original.width, H = original.height;
  try {
    const { rgba, alpha, w, h } = workingPixels(original, mask);
    const f = Math.max(w, h) / REFINE_MAX_SIDE;
    const r1 = Math.max(8, Math.round(45 * f));
    const r2 = Math.max(2, Math.round(3 * f));
    const out = await callWorker({ op: 'foreground', rgba, alpha, w, h, r1, r2 }, [rgba.buffer, alpha.buffer]);

    const est = createCanvas(w, h);
    est.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);

    const result = createCanvas(W, H);
    const rctx = result.getContext('2d', { willReadFrequently: true });
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(est, 0, 0, W, H);
    const fdata = rctx.getImageData(0, 0, W, H).data;
    const odata = original.getContext('2d').getImageData(0, 0, W, H);
    const od = odata.data;
    const md = mask.getContext('2d').getImageData(0, 0, W, H).data;
    for (let i = 0; i < od.length; i += 4) {
      const a = md[i + 3];
      if (a > 2 && a < 253) {
        od[i] = fdata[i]; od[i + 1] = fdata[i + 1]; od[i + 2] = fdata[i + 2];
      }
    }
    rctx.putImageData(odata, 0, 0);
    return result;
  } catch (err) {
    console.warn('Edge refinement failed; using original colours', err);
    return copyCanvas(original);
  }
}
