/**
 * Unscrewed Deterministic Record Safeguards - v2
 *
 * Plain JS, zero dependencies. Manages disassembly records with per-field
 * provenance, conflict tracking, and history preservation.
 *
 * Core invariants:
 *  1. Only "user_confirmed" fields are authoritative counts.
 *  2. "user_reported" facts are recorded but not silently promoted to confirmed.
 *  3. "visual_estimate" NEVER overwrites a user-sourced quantity.
 *  4. Conflicting user reports stay unresolved until explicit correction.
 *  5. Every field change preserves history.
 *  6. Missing data is null, never zero or inferred.
 *  7. Confirmed counts are not evidence of physical safety.
 */

// -- Source hierarchy (higher = more authoritative) ------------------
const SOURCE_RANK = Object.freeze({
  user_confirmed: 3,
  user_reported:  2,
  visual_estimate: 1,
  inferred:       0,
});

const VALID_SOURCES = new Set(Object.keys(SOURCE_RANK));

// -- Helpers ---------------------------------------------------------

function now() { return new Date().toISOString(); }

function validateSource(s) {
  if (!VALID_SOURCES.has(s)) throw new Error(`Invalid source: ${s}`);
}

function makeField(value, source, evidence = []) {
  validateSource(source);
  return { value, source, evidence: [...evidence], history: [] };
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// -- FieldRecord operations ------------------------------------------

/**
 * Attempt to update a FieldRecord. Returns { updated, blocked, conflict, reason }.
 *
 * Rules:
 *  - visual_estimate NEVER overwrites user_confirmed or user_reported quantity.
 *  - Lower-ranked source cannot overwrite higher-ranked value.
 *  - Same-rank same-source with DIFFERENT value: blocked as conflict.
 *    The caller (updatePartField) is responsible for auto-registering it.
 *  - Same-rank same-source with SAME value: treated as re-confirmation
 *    (promoted if higher source, otherwise idempotent).
 *  - Higher-ranked source overwrites lower; history preserved.
 *  - Every accepted update preserves previousValue, previousSource, AND
 *    previousEvidence in history.
 */
function updateField(field, newValue, newSource, evidence, reason) {
  validateSource(newSource);
  const oldRank = SOURCE_RANK[field.source];
  const newRank = SOURCE_RANK[newSource];

  // Hard block: visual_estimate never overwrites user quantities
  if (newSource === 'visual_estimate' &&
      (field.source === 'user_confirmed' || field.source === 'user_reported')) {
    return {
      updated: false,
      blocked: true,
      conflict: false,
      reason: `visual_estimate cannot overwrite ${field.source} value`,
    };
  }

  // Soft block: lower-ranked source cannot overwrite higher-ranked
  if (newRank < oldRank) {
    return {
      updated: false,
      blocked: true,
      conflict: false,
      reason: `${newSource} (rank ${newRank}) cannot overwrite ${field.source} (rank ${oldRank})`,
    };
  }

  // Same rank, same source, DIFFERENT value -> conflict, not last-write-wins.
  // Exception: user_confirmed always wins (it is an explicit resolution act).
  if (newRank === oldRank && newSource !== 'user_confirmed' &&
      !valuesEqual(field.value, newValue)) {
    return {
      updated: false,
      blocked: true,
      conflict: true,
      existingValue: field.value,
      existingEvidence: [...field.evidence],
      reason: `same-rank ${newSource} conflict: existing ${JSON.stringify(field.value)} vs incoming ${JSON.stringify(newValue)}`,
    };
  }

  // Proceed: push history (with evidence), replace value
  field.history.push({
    previousValue: field.value,
    previousSource: field.source,
    previousEvidence: [...field.evidence],
    reason: reason || `updated by ${newSource}`,
    timestamp: now(),
  });
  field.value = newValue;
  field.source = newSource;
  field.evidence = [...(evidence || [])];
  return { updated: true, blocked: false, conflict: false, reason: null };
}

/** Shallow equality for field values (handles null, primitives, simple arrays). */
function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

// -- Record class ----------------------------------------------------

class UnscrewedRecord {
  constructor(sessionId) {
    const ts = now();
    this._data = {
      version: 'unscrewed-record-v2',
      sessionId: sessionId || `session-${Date.now()}`,
      metadata: { createdAt: ts, updatedAt: ts },
      steps: [],
      parts: [],
      conflicts: [],
    };
  }

  // -- Steps -------------------------------------------------------

  addStep({ action, source, evidence, removedPartIds }) {
    validateSource(source);
    const step = {
      stepIndex: this._data.steps.length,
      action: makeField(action, source, evidence),
      removedPartIds: removedPartIds || [],
      evidence: evidence || [],
    };
    this._data.steps.push(step);
    this._touch();
    return step.stepIndex;
  }

  // -- Parts -------------------------------------------------------

  addPart({ partId, name, quantity, storage, linkedStep, source, evidence }) {
    validateSource(source);
    if (this._data.parts.find(p => p.partId === partId)) {
      throw new Error(`Duplicate partId: ${partId}`);
    }
    const part = {
      partId,
      name: makeField(name, source, evidence),
      quantity: makeField(quantity, source, evidence),
      storage: makeField(storage, source, evidence),
      linkedStep: makeField(linkedStep ?? null, source, evidence),
    };
    this._data.parts.push(part);
    this._touch();
    return part;
  }

  getPart(partId) {
    return this._data.parts.find(p => p.partId === partId) || null;
  }

  /**
   * Update a single field on a part. Enforces all safeguard invariants.
   *
   * When a same-rank user_reported value conflicts with the existing value,
   * an unresolved conflict is AUTO-REGISTERED and the field is left unchanged.
   * The returned object has `conflict: true` and `autoConflictId`.
   */
  updatePartField(partId, fieldName, newValue, newSource, evidence, reason) {
    const part = this.getPart(partId);
    if (!part) throw new Error(`Part not found: ${partId}`);
    if (!part[fieldName]) throw new Error(`Unknown field: ${fieldName}`);
    const result = updateField(part[fieldName], newValue, newSource, evidence, reason);

    // Auto-register conflict when updateField signals one
    if (result.conflict) {
      const conflictId = `auto_${partId}_${fieldName}_${Date.now()}`;
      this.addConflict({
        conflictId,
        fieldPath: `parts.${partId}.${fieldName}`,
        reports: [
          { value: result.existingValue, source: part[fieldName].source, evidence: result.existingEvidence },
          { value: newValue, source: newSource, evidence: [...(evidence || [])] },
        ],
      });
      result.autoConflictId = conflictId;
    }

    if (result.updated) this._touch();
    return result;
  }

  // -- Conflicts ---------------------------------------------------

  /**
   * Register a conflict between two or more reports for the same field.
   * Each report: { value, source, evidence }.
   */
  addConflict({ conflictId, fieldPath, reports }) {
    if (reports.length < 2) throw new Error('A conflict needs at least 2 reports');
    reports.forEach(r => validateSource(r.source));
    if (this._data.conflicts.find(c => c.conflictId === conflictId)) {
      throw new Error(`Duplicate conflictId: ${conflictId}`);
    }
    const conflict = {
      conflictId,
      fieldPath,
      reports: deepClone(reports),
      status: 'unresolved',
      resolution: null,
    };
    this._data.conflicts.push(conflict);
    this._touch();
    return conflict;
  }

  /**
   * Resolve a conflict. ONLY user_confirmed is accepted as resolution source.
   * The corresponding part field is updated; history preserved on both
   * the conflict and the part.
   *
   * Throws if fieldPath does not match a supported pattern.
   */
  resolveConflict(conflictId, { resolvedValue, reason, evidence }) {
    const conflict = this._data.conflicts.find(c => c.conflictId === conflictId);
    if (!conflict) throw new Error(`Conflict not found: ${conflictId}`);
    if (conflict.status === 'resolved') throw new Error('Already resolved');

    // Parse and validate fieldPath (only "parts.<partId>.<fieldName>" supported)
    const segments = conflict.fieldPath.split('.');
    if (segments[0] !== 'parts' || segments.length !== 3) {
      throw new Error(
        `Unsupported fieldPath for resolution: "${conflict.fieldPath}". ` +
        `Only "parts.<partId>.<fieldName>" is supported.`
      );
    }
    const partId = segments[1];
    const fieldName = segments[2];
    const part = this.getPart(partId);
    if (!part) {
      throw new Error(`Part "${partId}" from fieldPath not found in record`);
    }
    if (!part[fieldName]) {
      throw new Error(`Field "${fieldName}" from fieldPath not found on part "${partId}"`);
    }

    // Apply resolution via user_confirmed (bypasses same-rank conflict check)
    const partResult = this.updatePartField(
      partId, fieldName, resolvedValue, 'user_confirmed', evidence,
      `conflict ${conflictId} resolved: ${reason}`
    );
    if (!partResult.updated) {
      throw new Error(`Part field update blocked during resolution: ${partResult.reason}`);
    }

    conflict.status = 'resolved';
    conflict.resolution = {
      resolvedValue,
      resolvedSource: 'user_confirmed',
      reason,
      timestamp: now(),
    };
    this._touch();
    return conflict;
  }

  getUnresolvedConflicts() {
    return this._data.conflicts.filter(c => c.status === 'unresolved');
  }

  // -- Confirmation helpers -----------------------------------------

  /**
   * Confirm a part field value. Requires an explicit (partId, fieldName) target.
   * An ambiguous confirmation that does not specify which part/field it applies
   * to MUST be rejected - the caller must resolve the target first.
   *
   * `tentative` flag: if true, the value is recorded as user_reported (not
   * promoted to user_confirmed). Use this for hedged language like "probably 4".
   */
  confirmPartField(partId, fieldName, value, evidence, { tentative = false } = {}) {
    if (!partId || !fieldName) {
      throw new Error('confirmPartField requires explicit partId and fieldName target');
    }
    const source = tentative ? 'user_reported' : 'user_confirmed';
    return this.updatePartField(
      partId, fieldName, value, source, evidence,
      tentative ? 'tentative user statement (not confirmed)' : 'explicit user confirmation'
    );
  }

  /**
   * Move a part to a different storage bag.
   * Invariant: this MUST NOT alter the storage of any other part.
   * Returns the set of partIds whose storage field was touched (should be exactly 1).
   */
  movePartStorage(partId, newStorage, evidence, reason) {
    const touched = [];
    const result = this.updatePartField(
      partId, 'storage', newStorage, 'user_confirmed', evidence,
      reason || `moved to ${newStorage}`
    );
    if (result.updated) touched.push(partId);
    // Verify no other part was modified (this is a code-level safeguard;
    // the method only touches the one part, but we document the contract).
    return { result, touchedPartIds: touched };
  }

  // -- Queries -----------------------------------------------------

  /**
   * Return all fields that are still null (missing user input).
   */
  getMissingFields() {
    const missing = [];
    for (const part of this._data.parts) {
      for (const key of ['name', 'quantity', 'storage', 'linkedStep']) {
        if (part[key] && part[key].value === null) {
          missing.push({ partId: part.partId, field: key, source: part[key].source });
        }
      }
    }
    return missing;
  }

  /**
   * Return a summary safe for reassembly guidance. Marks non-confirmed
   * counts explicitly. Does NOT assert physical safety.
   */
  toReassemblySummary() {
    return {
      safe: false, // Confirmed counts are NEVER evidence of structural safety.
      parts: this._data.parts.map(p => ({
        partId: p.partId,
        name: p.name.value,
        quantity: p.quantity.value,
        quantityIsConfirmed: p.quantity.source === 'user_confirmed',
        storage: p.storage.value,
        linkedStep: p.linkedStep.value,
        hasUnresolvedConflict: this._data.conflicts.some(
          c => c.status === 'unresolved' && c.fieldPath.startsWith(`parts.${p.partId}.`)
        ),
      })),
    };
  }

  // -- Serialisation -----------------------------------------------

  toJSON() { return deepClone(this._data); }

  /**
   * Reconstruct a UnscrewedRecord from a plain JSON object.
   *
   * WARNING: TRUST LIMITATIONS:
   *  - This performs a structural deep-clone only. It does NOT validate
   *    that the JSON conforms to schema.json, that source strings are
   *    valid, or that history entries are internally consistent.
   *  - Callers MUST validate untrusted input (e.g. LLM extractor output)
   *    against schema.json with an external JSON Schema validator before
   *    passing it here. This library has zero dependencies and ships no
   *    runtime schema validator.
   *  - Evidence arrays from external models may use strings instead of
   *    arrays, or omit required fields. Normalise before calling.
   */
  static fromJSON(data) {
    const rec = new UnscrewedRecord(data.sessionId);
    rec._data = deepClone(data);
    return rec;
  }

  _touch() { this._data.metadata.updatedAt = now(); }
}

// -- Exports ---------------------------------------------------------
export {
  UnscrewedRecord,
  makeField,
  updateField,
  SOURCE_RANK,
  VALID_SOURCES,
};
