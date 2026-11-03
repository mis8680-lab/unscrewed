/**
 * PackBack Deterministic Record Safeguards - v2 (Browser build)
 * Identical logic to lib/record.mjs, adapted for <script> loading.
 * Plain JS, zero dependencies.
 */

const SOURCE_RANK = Object.freeze({
  user_confirmed: 3,
  user_reported:  2,
  visual_estimate: 1,
  inferred:       0,
});
const VALID_SOURCES = new Set(Object.keys(SOURCE_RANK));

function now() { return new Date().toISOString(); }
function validateSource(s) { if (!VALID_SOURCES.has(s)) throw new Error(`Invalid source: ${s}`); }
function makeField(value, source, evidence = []) {
  validateSource(source);
  return { value, source, evidence: [...evidence], history: [] };
}
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return false;
}

function updateField(field, newValue, newSource, evidence, reason) {
  validateSource(newSource);
  const oldRank = SOURCE_RANK[field.source];
  const newRank = SOURCE_RANK[newSource];
  if (newSource === 'visual_estimate' && (field.source === 'user_confirmed' || field.source === 'user_reported')) {
    return { updated: false, blocked: true, conflict: false, reason: `visual_estimate cannot overwrite ${field.source} value` };
  }
  if (newRank < oldRank) {
    return { updated: false, blocked: true, conflict: false, reason: `${newSource} (rank ${newRank}) cannot overwrite ${field.source} (rank ${oldRank})` };
  }
  if (newRank === oldRank && newSource !== 'user_confirmed' && !valuesEqual(field.value, newValue)) {
    return { updated: false, blocked: true, conflict: true, existingValue: field.value, existingEvidence: [...field.evidence],
      reason: `same-rank ${newSource} conflict: existing ${JSON.stringify(field.value)} vs incoming ${JSON.stringify(newValue)}` };
  }
  field.history.push({ previousValue: field.value, previousSource: field.source, previousEvidence: [...field.evidence], reason: reason || `updated by ${newSource}`, timestamp: now() });
  field.value = newValue;
  field.source = newSource;
  field.evidence = [...(evidence || [])];
  return { updated: true, blocked: false, conflict: false, reason: null };
}

class PackBackRecord {
  constructor(sessionId) {
    const ts = now();
    this._data = { version: 'packback-record-v2', sessionId: sessionId || `session-${Date.now()}`, metadata: { createdAt: ts, updatedAt: ts }, steps: [], parts: [], conflicts: [] };
  }
  addStep({ action, source, evidence, removedPartIds }) {
    validateSource(source);
    const step = { stepIndex: this._data.steps.length, action: makeField(action, source, evidence), removedPartIds: removedPartIds || [], evidence: evidence || [] };
    this._data.steps.push(step);
    this._touch();
    return step.stepIndex;
  }
  addPart({ partId, name, quantity, storage, linkedStep, source, evidence }) {
    validateSource(source);
    if (this._data.parts.find(p => p.partId === partId)) throw new Error(`Duplicate partId: ${partId}`);
    const part = { partId, name: makeField(name, source, evidence), quantity: makeField(quantity, source, evidence), storage: makeField(storage, source, evidence), linkedStep: makeField(linkedStep ?? null, source, evidence) };
    this._data.parts.push(part);
    this._touch();
    return part;
  }
  getPart(partId) { return this._data.parts.find(p => p.partId === partId) || null; }
  updatePartField(partId, fieldName, newValue, newSource, evidence, reason) {
    const part = this.getPart(partId);
    if (!part) throw new Error(`Part not found: ${partId}`);
    if (!part[fieldName]) throw new Error(`Unknown field: ${fieldName}`);
    const result = updateField(part[fieldName], newValue, newSource, evidence, reason);
    if (result.conflict) {
      const conflictId = `auto_${partId}_${fieldName}_${Date.now()}`;
      this.addConflict({ conflictId, fieldPath: `parts.${partId}.${fieldName}`, reports: [
        { value: result.existingValue, source: part[fieldName].source, evidence: result.existingEvidence },
        { value: newValue, source: newSource, evidence: [...(evidence || [])] }
      ] });
      result.autoConflictId = conflictId;
    }
    if (result.updated) this._touch();
    return result;
  }
  addConflict({ conflictId, fieldPath, reports }) {
    if (reports.length < 2) throw new Error('A conflict needs at least 2 reports');
    reports.forEach(r => validateSource(r.source));
    if (this._data.conflicts.find(c => c.conflictId === conflictId)) throw new Error(`Duplicate conflictId: ${conflictId}`);
    const conflict = { conflictId, fieldPath, reports: deepClone(reports), status: 'unresolved', resolution: null };
    this._data.conflicts.push(conflict);
    this._touch();
    return conflict;
  }
  resolveConflict(conflictId, { resolvedValue, reason, evidence }) {
    const conflict = this._data.conflicts.find(c => c.conflictId === conflictId);
    if (!conflict) throw new Error(`Conflict not found: ${conflictId}`);
    if (conflict.status === 'resolved') throw new Error('Already resolved');
    const segments = conflict.fieldPath.split('.');
    if (segments[0] !== 'parts' || segments.length !== 3) throw new Error(`Unsupported fieldPath: "${conflict.fieldPath}"`);
    const [, partId, fieldName] = segments;
    const part = this.getPart(partId);
    if (!part) throw new Error(`Part "${partId}" not found`);
    if (!part[fieldName]) throw new Error(`Field "${fieldName}" not found on "${partId}"`);
    const partResult = this.updatePartField(partId, fieldName, resolvedValue, 'user_confirmed', evidence, `conflict ${conflictId} resolved: ${reason}`);
    if (!partResult.updated) throw new Error(`Part field update blocked during resolution: ${partResult.reason}`);
    conflict.status = 'resolved';
    conflict.resolution = { resolvedValue, resolvedSource: 'user_confirmed', reason, timestamp: now() };
    this._touch();
    return conflict;
  }
  getUnresolvedConflicts() { return this._data.conflicts.filter(c => c.status === 'unresolved'); }
  confirmPartField(partId, fieldName, value, evidence, { tentative = false } = {}) {
    if (!partId || !fieldName) throw new Error('confirmPartField requires explicit partId and fieldName target');
    const source = tentative ? 'user_reported' : 'user_confirmed';
    return this.updatePartField(partId, fieldName, value, source, evidence, tentative ? 'tentative user statement (not confirmed)' : 'explicit user confirmation');
  }
  getMissingFields() {
    const missing = [];
    for (const part of this._data.parts) {
      for (const key of ['name', 'quantity', 'storage', 'linkedStep']) {
        if (part[key] && part[key].value === null) missing.push({ partId: part.partId, field: key, source: part[key].source });
      }
    }
    return missing;
  }
  toReassemblySummary() {
    return { safe: false, parts: this._data.parts.map(p => ({
      partId: p.partId, name: p.name.value, quantity: p.quantity.value,
      quantityIsConfirmed: p.quantity.source === 'user_confirmed',
      storage: p.storage.value, linkedStep: p.linkedStep.value,
      hasUnresolvedConflict: this._data.conflicts.some(c => c.status === 'unresolved' && c.fieldPath.startsWith(`parts.${p.partId}.`))
    })) };
  }
  toJSON() { return deepClone(this._data); }
  static fromJSON(data) { const rec = new PackBackRecord(data.sessionId); rec._data = deepClone(data); return rec; }
  _touch() { this._data.metadata.updatedAt = now(); }
}

// Expose globally for browser
window.PackBackRecord = PackBackRecord;
window.SOURCE_RANK = SOURCE_RANK;
