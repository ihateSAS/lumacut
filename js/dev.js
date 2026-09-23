import { $, esc, mountChrome, formatBytes, toast } from './common.js';
import { removeBackground, onStatus } from './sdk.js';

mountChrome('developers');
document.querySelectorAll('[data-upload]').forEach((b) => {
  b.addEventListener('click', () => { location.href = 'index.html'; });
});

const ctl = { image: $('#pgImage'), bg: $('#pgBg'), ratio: $('#pgRatio'), crop: $('#pgCrop'), shadow: $('#pgShadow') };

function options() {
  const o = {};
  if (ctl.bg.value) o.background = ctl.bg.value;
  if (ctl.crop.checked) o.crop = true;
  if (ctl.ratio.value) o.ratio = +ctl.ratio.value;
  if (ctl.shadow.checked) o.shadow = true;
  return o;
}

function showCode() {
  const o = options();
  const body = Object.entries(o).map(([k, v]) => `  ${k}: ${typeof v === 'string' ? `'${v}'` : v},`).join('\n');
  $('#pgCode').innerHTML = esc(`const png = await removeBackground(url${body ? `, {\n${body}\n}` : ''});`);
}
Object.values(ctl).forEach((c) => c.addEventListener('change', showCode));
showCode();

onStatus((st) => {
  const s = $('#pgStatus');
  if (st.stage === 'loading') s.textContent = st.total ? `Downloading model… ${formatBytes(st.loaded)} / ${formatBytes(st.total)}` : 'Loading model…';
  else if (st.stage === 'processing') s.textContent = 'Running…';
});

let lastUrl;
$('#pgRun').addEventListener('click', async () => {
  const btn = $('#pgRun');
  btn.disabled = true;
  const t0 = performance.now();
  try {
    const url = `https://images.unsplash.com/photo-${ctl.image.value}?w=1200&q=85`;
    const blob = await removeBackground(url, options());
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    $('#pgOut').innerHTML = `<img src="${lastUrl}" alt="Result">`;
    $('#pgStatus').textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${formatBytes(blob.size)} ${blob.type}`;
  } catch (err) {
    toast(err.message, 'error');
    $('#pgStatus').textContent = '';
  } finally {
    btn.disabled = false;
  }
});
