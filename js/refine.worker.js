// Foreground colour estimation ("blur fusion", Forte & Pitié 2021).
// Removes the old background colour that bleeds into semi-transparent edges
// (hair, fur, motion blur) so cut-outs don't show halos on new backgrounds.

self.onmessage = (e) => {
  const { id, op = 'foreground', rgba, alpha, w, h } = e.data;
  try {
    const out = op === 'guided'
      ? guidedFilter(rgba, alpha, w, h, e.data.r, e.data.eps)
      : estimate(rgba, alpha, w, h, e.data.r1, e.data.r2);
    self.postMessage({ id, out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};

const EPS = 1e-5;

/** Separable box blur with edge clamping; window = 2k+1. `tmp` is scratch space. */
function boxBlur(src, dst, tmp, w, h, k) {
  if (k < 1) { dst.set(src); return; }
  const norm = 1 / (2 * k + 1);
  // horizontal: src -> tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = src[row] * (k + 1);
    for (let x = 1; x <= k; x++) sum += src[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * norm;
      sum += src[row + Math.min(x + k + 1, w - 1)] - src[row + Math.max(x - k, 0)];
    }
  }
  // vertical: tmp -> dst
  for (let x = 0; x < w; x++) {
    let sum = tmp[x] * (k + 1);
    for (let y = 1; y <= k; y++) sum += tmp[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm;
      sum += tmp[Math.min(y + k + 1, h - 1) * w + x] - tmp[Math.max(y - k, 0) * w + x];
    }
  }
}

/**
 * Colour guided filter (He, Sun & Tang 2010) of the alpha mask, guided by the
 * photo. Snaps soft or slightly misplaced mask edges onto real image edges and
 * recovers strand-level detail in hair and fur. Returns alpha as Uint8.
 */
function guidedFilter(rgba, alphaU8, w, h, r, eps) {
  const n = w * h;
  const I = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    I[0][i] = rgba[i * 4] / 255;
    I[1][i] = rgba[i * 4 + 1] / 255;
    I[2][i] = rgba[i * 4 + 2] / 255;
    p[i] = alphaU8[i] / 255;
  }
  const tmp = new Float32Array(n);
  const prod = new Float32Array(n);
  const box = (src, dst) => boxBlur(src, dst, tmp, w, h, r);

  const mI = I.map((ch) => { const m = new Float32Array(n); box(ch, m); return m; });
  const mp = new Float32Array(n);
  box(p, mp);

  // cov(I, p) per channel
  const cov = [0, 1, 2].map((c) => {
    for (let i = 0; i < n; i++) prod[i] = I[c][i] * p[i];
    const out = new Float32Array(n);
    box(prod, out);
    for (let i = 0; i < n; i++) out[i] -= mI[c][i] * mp[i];
    return out;
  });

  // var(I): symmetric 3×3 per pixel — rr, rg, rb, gg, gb, bb
  const pairs = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
  const v = pairs.map(([a, b]) => {
    for (let i = 0; i < n; i++) prod[i] = I[a][i] * I[b][i];
    const out = new Float32Array(n);
    box(prod, out);
    for (let i = 0; i < n; i++) out[i] -= mI[a][i] * mI[b][i];
    return out;
  });

  // a = (Σ + εU)⁻¹ cov, b = mean(p) − a·mean(I). a overwrites cov, b overwrites mp.
  for (let i = 0; i < n; i++) {
    const rr = v[0][i] + eps, rg = v[1][i], rb = v[2][i], gg = v[3][i] + eps, gb = v[4][i], bb = v[5][i] + eps;
    const i00 = gg * bb - gb * gb, i01 = rb * gb - rg * bb, i02 = rg * gb - rb * gg;
    const i11 = rr * bb - rb * rb, i12 = rb * rg - rr * gb, i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02;
    const c0 = cov[0][i], c1 = cov[1][i], c2 = cov[2][i];
    const a0 = (i00 * c0 + i01 * c1 + i02 * c2) / det;
    const a1 = (i01 * c0 + i11 * c1 + i12 * c2) / det;
    const a2 = (i02 * c0 + i12 * c1 + i22 * c2) / det;
    cov[0][i] = a0; cov[1][i] = a1; cov[2][i] = a2;
    mp[i] -= a0 * mI[0][i] + a1 * mI[1][i] + a2 * mI[2][i];
  }

  // q = mean(a)·I + mean(b); reuse the variance buffers for the means.
  box(cov[0], v[0]); box(cov[1], v[1]); box(cov[2], v[2]); box(mp, v[3]);

  // Only trust the filter near the mask's edge: where the neighbourhood (2r)
  // is confidently all-foreground or all-background, keep the model's value so
  // similar colours elsewhere can't leak in.
  boxBlur(p, v[4], tmp, w, h, r * 2);
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const near = v[4][i];
    out[i] = near < 0.004 || near > 0.996
      ? 255 * p[i]
      : 255 * (v[0][i] * I[0][i] + v[1][i] * I[1][i] + v[2][i] * I[2][i] + v[3][i]);
  }
  return out;
}

function estimate(rgba, alphaU8, w, h, r1, r2) {
  const n = w * h;
  const A = new Float32Array(n);
  for (let i = 0; i < n; i++) A[i] = alphaU8[i] / 255;

  const tmp = new Float32Array(n);
  const bA1 = new Float32Array(n);
  const bA2 = new Float32Array(n);
  boxBlur(A, bA1, tmp, w, h, r1);
  boxBlur(A, bA2, tmp, w, h, r2);

  const I = new Float32Array(n);
  const prod = new Float32Array(n);
  const bF = new Float32Array(n);
  const bB = new Float32Array(n);
  const F1 = new Float32Array(n);
  const out = new Uint8ClampedArray(n * 4);

  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) I[i] = rgba[i * 4 + c] / 255;

    // Pass 1 (large radius): F = B = image
    for (let i = 0; i < n; i++) prod[i] = I[i] * A[i];
    boxBlur(prod, bF, tmp, w, h, r1);
    for (let i = 0; i < n; i++) prod[i] = I[i] * (1 - A[i]);
    boxBlur(prod, bB, tmp, w, h, r1);
    for (let i = 0; i < n; i++) {
      const f = bF[i] / (bA1[i] + EPS);
      const b = bB[i] / (1 - bA1[i] + EPS);
      const a = A[i];
      F1[i] = Math.min(1, Math.max(0, f + a * (I[i] - a * f - (1 - a) * b)));
      bB[i] = b; // blurred background, reused as B in pass 2
    }

    // Pass 2 (small radius): F = F1, B = blurred background from pass 1
    for (let i = 0; i < n; i++) prod[i] = F1[i] * A[i];
    boxBlur(prod, bF, tmp, w, h, r2);
    for (let i = 0; i < n; i++) prod[i] = bB[i] * (1 - A[i]);
    boxBlur(prod, bB, tmp, w, h, r2);
    for (let i = 0; i < n; i++) {
      const f = bF[i] / (bA2[i] + EPS);
      const b = bB[i] / (1 - bA2[i] + EPS);
      const a = A[i];
      out[i * 4 + c] = 255 * (f + a * (I[i] - a * f - (1 - a) * b));
    }
  }
  for (let i = 0; i < n; i++) out[i * 4 + 3] = 255;
  return out;
}
