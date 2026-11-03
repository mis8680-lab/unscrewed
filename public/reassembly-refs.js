/**
 * Unscrewed: pure helper for the Reassembly Reference.
 * Derives per-step confirmation lines from record data only (never model output).
 * Loads as a browser global or via CommonJS-style `module.exports`.
 */
(function (root) {
  // Evidence ids are stepN. Legacy panelN means the same thing.
  function norm(s) { return String(s).trim().toLowerCase().replace(/^panel(\d+)$/, 'step$1'); }

  // Returns reversed steps: { step, refNumber, notes: [{bag, confirmed, corrections:[recordedValue]}] }
  function buildReassemblyRefs(record, extraction, stepMappings, notes) {
    const data = record && record._data ? record._data : { steps: [] };
    const mappings = stepMappings || {};
    const bags = (extraction && Array.isArray(extraction.bags)) ? extraction.bags : [];
    const originalNotes = Array.isArray(notes) ? notes : [];
    const reversed = [...data.steps].reverse();

    return reversed.map((step, i) => {
      const stepNumber = step.stepIndex + 1;
      const evidence = new Set((step.evidence || []).map(norm));
      const lines = [];
      Object.keys(mappings).sort().forEach((bagId) => {
        if (Number(mappings[bagId]) !== stepNumber) return;
        const part = record.getPart ? record.getPart('screws_' + bagId) : null;
        if (!part || !part.quantity || part.quantity.source !== 'user_confirmed') return;
        const confirmed = part.quantity.value;
        const bag = bags.find((b) => b.id === bagId);
        const reports = bag && Array.isArray(bag.reports) ? bag.reports : [];
        const differing = [];
        reports.forEach((r) => {
          const ev = Array.isArray(r.evidence) ? r.evidence : [r.evidence];
          if (r.value !== confirmed && ev.some((e) => e != null && evidence.has(norm(e))) && !differing.includes(r.value)) {
            differing.push(r.value);
          }
        });
        lines.push({
          bag: bagId,
          confirmed,
          text: 'Bag ' + bagId + ': you confirmed ' + confirmed + ' screws',
          corrections: differing.map((v) => 'Note recorded ' + v + '. Corrected to ' + confirmed + ' by your confirmation.')
        });
      });
      const original = step.action && step.action.value != null
        ? step.action.value
        : ((originalNotes.find((n) => 'step' + n.panel === norm((step.evidence || [])[0] || '')) || {}).note || '');
      return { step, refNumber: i + 1, originalNote: original, lines };
    });
  }

  const api = { buildReassemblyRefs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.buildReassemblyRefs = buildReassemblyRefs;
})(typeof window !== 'undefined' ? window : globalThis);
