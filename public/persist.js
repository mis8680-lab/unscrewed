/**
 * Unscrewed: saving state to browser storage. Plain script, no dependencies.
 * Photos can exceed the storage quota. When they do, the photos are dropped and everything else
 * (notes, the extraction result, its metadata and the action log) is kept.
 */
const PHOTOS_TOO_LARGE_MESSAGE = 'Photos are too large to keep after a reload. Your notes and record are saved.';

/**
 * Writes persist to storage under key. Returns { saved, photosDropped, message }.
 * saved is "full", "without_photos" or "none". message is set whenever photos could not be kept.
 */
function persistState(storage, key, persist) {
  try {
    storage.setItem(key, JSON.stringify(persist));
    return { saved: 'full', photosDropped: false, message: null };
  } catch { /* over quota: retry without photos */ }
  const slim = { ...persist, customSteps: persist.customSteps ? persist.customSteps.map(x => ({ note: x.note, image: null })) : null };
  try {
    storage.setItem(key, JSON.stringify(slim));
    return { saved: 'without_photos', photosDropped: true, message: PHOTOS_TOO_LARGE_MESSAGE };
  } catch {
    return { saved: 'none', photosDropped: true, message: PHOTOS_TOO_LARGE_MESSAGE };
  }
}

/** A restored extraction result is kept only when it is well formed and every bag id is A to H. */
function isRestorableResult(result) {
  return !!(result && result.valid && Array.isArray(result.bags) &&
    result.bags.every(b => b && typeof b.id === 'string' && /^[A-H]$/.test(b.id)));
}
