// Shared "AI model" <select> used by the home page and the bulk editor.
// The choice is one preference for the whole site (stored by the engine).

import {
  MODELS, getCapabilities, isSupported, unsupportedReason, modelSize, autoModel,
  getPreferredModel, setPreferredModel, resolveModel,
} from './engine.js';

/** Fill `select` with the models available here and keep the preference in sync. */
export async function mountModelPicker(select, { onChange } = {}) {
  const caps = await getCapabilities();
  const auto = autoModel(caps);
  select.innerHTML = `<option value="auto">Auto — ${MODELS[auto].short} (best for this device)</option>` +
    Object.entries(MODELS).map(([key, m]) => {
      const ok = isSupported(key, caps);
      return `<option value="${key}"${ok ? '' : ' disabled'}>${m.label} · ${modelSize(key, caps)}${ok ? '' : ` (${unsupportedReason(key)})`}</option>`;
    }).join('');
  const pref = getPreferredModel();
  select.value = pref === 'auto' || isSupported(pref, caps) ? pref : 'auto';
  select.addEventListener('change', () => {
    setPreferredModel(select.value);
    onChange?.(select.value);
  });
  return caps;
}

/** The concrete model a choice resolves to, plus short notes to show under the picker. */
export async function modelNotes(choice) {
  const caps = await getCapabilities();
  const chosen = await resolveModel(choice || 'auto');
  const notes = [];
  if (!caps.server) notes.push('For the best quality, start the local AI server with “./start.sh” and reload.');
  if (!MODELS[chosen].commercial) notes.push(`${MODELS[chosen].short} is licensed for non-commercial use only.`);
  return { chosen, notes };
}
