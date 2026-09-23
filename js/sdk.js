// Public JavaScript SDK.
//
//   import { removeBackground } from './js/sdk.js';
//   const blob = await removeBackground(file, { background: '#fff', crop: true });
//
// Also exposed as window.Lumacut for non-module scripts.

import { segment, loadModel, onStatus, getStatus, MODELS } from './engine.js';
import { Project } from './project.js';

export { loadModel, onStatus, getStatus, MODELS };

/**
 * Remove the background from an image.
 * @param {File|Blob|string|HTMLImageElement|HTMLCanvasElement|ImageBitmap} input
 * @param {object} [options]
 * @param {'image/png'|'image/webp'|'image/jpeg'} [options.format='image/png']
 * @param {string} [options.background] CSS color, or 'blur' to blur the original background
 * @param {number} [options.blur=40] Blur strength 1–100 when background is 'blur'
 * @param {boolean} [options.crop=false] Crop to the subject
 * @param {number} [options.padding=0.08] Padding around the subject when cropping (fraction of subject size)
 * @param {number} [options.ratio] Output aspect ratio (width / height), e.g. 1 for square
 * @param {boolean} [options.shadow=false] Add a soft drop shadow
 * @param {'full'|'half'|'preview'} [options.size='full']
 * @param {number} [options.quality=0.92] JPEG/WebP quality
 * @param {'auto'|'birefnet'|'lite'|'rmbg'} [options.model='auto'] Which AI model to use
 * @returns {Promise<Blob>}
 */
export async function removeBackground(input, options = {}) {
  const project = await createProject(input, options);
  return project.toBlob({ type: options.format || 'image/png', size: options.size || 'full', quality: options.quality ?? 0.92 });
}

/** Returns the raw alpha mask as a canvas (foreground probability in the alpha channel). */
export async function getMask(input, { model } = {}) {
  const { mask } = await segment(input, { model });
  return mask;
}

/** Returns a Project you can render or export yourself (advanced). */
export async function createProject(input, options = {}) {
  const { original, mask, foreground, model } = await segment(input, { model: options.model });
  const p = new Project(original, mask, { name: options.name || 'image', foreground, model });
  const s = p.state;
  if (options.background === 'blur') {
    s.bg.type = 'blur';
    s.bg.blur = options.blur ?? 40;
  } else if (options.background && options.background !== 'transparent') {
    s.bg.type = 'color';
    s.bg.color = options.background;
  }
  if (options.crop) s.layout.trim = true;
  if (options.padding != null) s.layout.padding = options.padding;
  if (options.ratio) s.layout.ratio = options.ratio;
  if (options.shadow) s.shadow.on = true;
  return p;
}

if (typeof window !== 'undefined') {
  window.Lumacut = { removeBackground, getMask, createProject, loadModel, onStatus, getStatus, MODELS };
}
