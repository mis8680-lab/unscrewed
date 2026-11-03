/**
 * Unscrewed MVP -- Saved Meta Test Responses / Sample Mode
 *
 * ACTUAL saved outputs from saved Meta Playground sessions (muse-wonder-1.0).
 * NOT live API calls. Seeded sample data for offline extraction->review->confirm flow.
 *
 * Source: fixtures/meta/ in this repo.
 * Model: muse-wonder-1.0 (Meta Playground, single run per case)
 */

const SAMPLE_INPUTS = Object.freeze({
  normal: {
    id: "normal",
    notes: [
      { panel: 1, note: "Fully assembled." },
      { panel: 2, note: "Removed back panel. Put 4 screws in bag A." },
      { panel: 3, note: "Removed upper shelf. Put 4 screws in bag B." },
      { panel: 4, note: "Removed lower shelf. Put 4 screws in bag C." },
      { panel: 5, note: "Wood: 2 side panels, 2 shelves, 1 back panel. Bags A/B/C each hold 4 screws." }
    ]
  },
  missing: {
    id: "missing",
    notes: [
      { panel: 1, note: "Fully assembled." },
      { panel: 2, note: "Removed back panel. Put 4 screws in bag A." },
      { panel: 3, note: "Removed upper shelf." },
      { panel: 4, note: "Removed lower shelf. Put 4 screws in bag C." },
      { panel: 5, note: "Laid out the wood parts and bags." }
    ]
  },
  conflict: {
    id: "conflict",
    notes: [
      { panel: 1, note: "Fully assembled." },
      { panel: 2, note: "Removed back panel. Put 6 screws in bag A." },
      { panel: 3, note: "Removed upper shelf. Put 4 screws in bag B." },
      { panel: 4, note: "Removed lower shelf. Put 4 screws in bag C." },
      { panel: 5, note: "Wood: 2 side panels, 2 shelves, 1 back panel. Bags A/B/C each hold 4 screws." }
    ]
  }
});

const SAMPLE_META_OUTPUTS = Object.freeze({
  normal: {"bags":[{"id":"A","reported_quantities":[{"value":4,"evidence":"panel2"},{"value":4,"evidence":"panel5"}],"confirmed_quantity":null,"step":2,"evidence":["panel2","panel5"]},{"id":"B","reported_quantities":[{"value":4,"evidence":"panel3"},{"value":4,"evidence":"panel5"}],"confirmed_quantity":null,"step":3,"evidence":["panel3","panel5"]},{"id":"C","reported_quantities":[{"value":4,"evidence":"panel4"},{"value":4,"evidence":"panel5"}],"confirmed_quantity":null,"step":4,"evidence":["panel4","panel5"]}],"questions":["Have bags A, B, and C each been explicitly count-checked to confirm 4 screws, rather than only reported?"],"conflicts":[],"visual_limitations":["Tiny screws cannot be reliably counted from this contact sheet; visual quantity is unknown for all bags.","Visual appearance across panels cannot verify reported screw quantities or bag contents."],"safety_verified":false},
  missing: {"bags":[{"id":"A","reported_quantities":[{"value":4,"evidence":"panel2"}],"confirmed_quantity":null,"step":2,"evidence":["panel2"]},{"id":"B","reported_quantities":[],"confirmed_quantity":null,"step":null,"evidence":[]},{"id":"C","reported_quantities":[{"value":4,"evidence":"panel4"}],"confirmed_quantity":null,"step":4,"evidence":["panel4"]}],"questions":["How many screws were put in bag B, and in which panel/step was bag B filled?","Have the reported quantities for bag A (4 from panel2) and bag C (4 from panel4) been explicitly count-checked or confirmed?"],"conflicts":[],"visual_limitations":["Tiny screws cannot be reliably counted from this contact sheet, so visual quantities are unknown.","Bag B is visible in the images but has no user-reported quantity or step mapping in the notes; its contents and origin cannot be established visually."],"safety_verified":false},
  conflict: {"bags":[{"id":"A","reported_quantities":[{"value":6,"evidence":"panel2"},{"value":4,"evidence":"panel5"}],"confirmed_quantity":null,"step":2,"evidence":["panel2","panel5"]},{"id":"B","reported_quantities":[{"value":4,"evidence":"panel3"},{"value":4,"evidence":"panel5"}],"confirmed_quantity":null,"step":3,"evidence":["panel3","panel5"]},{"id":"C","reported_quantities":[{"value":4,"evidence":"panel4"},{"value":4,"evidence":"panel5"}],"confirmed_quantity":null,"step":4,"evidence":["panel4","panel5"]}],"questions":["What is the count-checked quantity in bag A: 6 from panel2 or 4 from panel5?","Please provide an explicit count-checked confirmation for bag A.","Please provide explicit count-checked confirmations for bags B and C, reported as 4 each.","Please confirm that bags A, B, and C correspond to steps 2, 3, and 4 respectively."],"conflicts":[{"bag":"A","values":[{"value":6,"evidence":"panel2"},{"value":4,"evidence":"panel5"}],"status":"unresolved"}],"visual_limitations":["Tiny screws in this contact sheet cannot be reliably counted; visual quantities are unknown.","Visual estimates do not override user records and do not create numeric conflicts.","Any image inconsistencies are limitations only, not established facts."],"safety_verified":false}
});

const SEEDED_INPUT_HASH = Object.freeze({
  normal: JSON.stringify(SAMPLE_INPUTS.normal.notes),
  missing: JSON.stringify(SAMPLE_INPUTS.missing.notes),
  conflict: JSON.stringify(SAMPLE_INPUTS.conflict.notes),
});

/** Required bag IDs for this fixed sample prototype. */
const REQUIRED_BAG_IDS = Object.freeze(['A', 'B', 'C']);

/**
 * Match user input against seeded scenarios.
 * Returns { matched, scenarioId, metaOutput } or { matched:false }.
 * Custom image always returns matched:false (seeded data is for the synthetic image only).
 */
function matchSeededInput(notes, hasCustomImage) {
  if (hasCustomImage) return { matched: false, scenarioId: null, metaOutput: null };
  const hash = JSON.stringify(notes);
  for (const [id, expected] of Object.entries(SEEDED_INPUT_HASH)) {
    if (hash === expected) {
      return { matched: true, scenarioId: id, metaOutput: structuredClone(SAMPLE_META_OUTPUTS[id]) };
    }
  }
  return { matched: false, scenarioId: null, metaOutput: null };
}

/**
 * Validate a Meta JSON import. Structural check only.
 *
 * Fixed rules for this sample prototype:
 *  - Exactly 3 bags with IDs A, B, C (no duplicates, no missing, no extras)
 *  - reported_quantities values must be positive safe integers (>0) with non-blank evidence
 *  - confirmed_quantity is ALWAYS forced to null (model cannot confirm)
 *  - Imported conflicts are IGNORED; conflicts are derived from reported_quantities
 *  - All imported strings are treated as untrusted (escaped at render time)
 *  - safety_verified must be false
 */
function validateMetaImport(raw) {
  if (!raw || !Array.isArray(raw.bags) || raw.safety_verified !== false) {
    return { valid: false, error: 'Invalid format: bags array and safety_verified:false required' };
  }

  if (raw.bags.length !== 3) {
    return { valid: false, error: 'Exactly 3 bags (A, B, C) required (got ' + raw.bags.length + ')' };
  }

  const ids = new Set();
  try {
    const bags = raw.bags.map(b => {
      if (typeof b.id !== 'string') throw new Error('Bag ID must be a string');
      const bid = b.id.trim();
      if (!REQUIRED_BAG_IDS.includes(bid)) throw new Error('Invalid bag ID: ' + bid + ' (only A/B/C allowed)');
      if (ids.has(bid)) throw new Error('Duplicate bag ID: ' + bid);
      ids.add(bid);
      if (!Array.isArray(b.reported_quantities)) throw new Error('reported_quantities array required (bag ' + bid + ')');

      const reports = b.reported_quantities.map(r => {
        if (!Number.isSafeInteger(r.value) || r.value < 1) throw new Error('Quantity must be a positive integer (bag ' + bid + ', value: ' + r.value + ')');
        const ev = typeof r.evidence === 'string' ? [r.evidence] : r.evidence ?? [];
        if (!Array.isArray(ev) || ev.length === 0 || ev.some(e => typeof e !== 'string' || !e.trim())) {
          throw new Error('Evidence missing or contains blank strings (bag ' + bid + ')');
        }
        return { value: r.value, evidence: ev.map(e => String(e).trim()) };
      });

      if (b.step !== null && b.step !== undefined && (!Number.isSafeInteger(b.step) || b.step < 1 || b.step > 5)) {
        throw new Error('Step must be 1-5 or null (bag ' + bid + ')');
      }

      return {
        id: bid,
        reports,
        step: (b.step != null && Number.isSafeInteger(b.step) && b.step >= 1 && b.step <= 5) ? b.step : null,
        evidence: typeof b.evidence === 'string' ? [b.evidence] : (Array.isArray(b.evidence) ? b.evidence.map(e => String(e)) : []),
        confirmed_quantity: null,
        model_confirmation_proposal: b.confirmed_quantity ?? null,
        requires_user_event: true
      };
    });

    for (const rid of REQUIRED_BAG_IDS) {
      if (!ids.has(rid)) throw new Error('Missing bag: ' + rid);
    }

    const derivedConflicts = [];
    bags.forEach(bag => {
      if (bag.reports.length > 1) {
        const values = bag.reports.map(r => r.value);
        const unique = [...new Set(values)];
        if (unique.length > 1) {
          derivedConflicts.push({
            bag: bag.id,
            reported_values: unique,
            evidence: bag.reports.flatMap(r => r.evidence),
            status: 'unresolved',
            resolution: null
          });
        }
      }
    });

    const questions = Array.isArray(raw.questions)
      ? raw.questions.filter(q => typeof q === 'string').map(q => String(q))
      : [];
    const visual_limitations = Array.isArray(raw.visual_limitations)
      ? raw.visual_limitations.filter(l => typeof l === 'string').map(l => String(l))
      : [];

    return { valid: true, bags, questions, conflicts: derivedConflicts, visual_limitations };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
