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

/** Bag letters Unscrewed supports. How many bags a record has depends on the notes. */
const ALL_BAG_IDS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
const MIN_STEPS = 2;
const MAX_STEPS = 12;

/** Bag letters (A to H) a set of notes mentions, e.g. "bag A", "bags A/B and C". Sorted, unique. */
function bagLettersFromNotes(notes) {
  const found = new Set();
  for (const n of (Array.isArray(notes) ? notes : [])) {
    const text = String(n && n.note != null ? n.note : '');
    for (const m of text.matchAll(/[Bb]ags?\s+([A-H](?:\s*(?:[\/,&]|and)\s*[A-H])*)(?![A-Za-z])/g)) {
      for (const l of m[1].match(/[A-H]/g)) found.add(l);
    }
  }
  return [...found].sort();
}

const OBS_MAX_PER_STEP = 3;
const OBS_MAX_CHARS = 140;
const COUNT_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'dozen', 'dozens', 'pair', 'pairs', 'couple', 'single', 'double', 'triple']);
const FASTENER_RE = /^(?:screws?|bolts?|nuts?|washers?|fasteners?)$/;

/**
 * True when an observation states a count of fasteners: a digit or number word within four words of
 * screw, bolt, nut, washer or fastener. Numbers that name a step or photo ("step 3") do not count.
 */
function observationHasFastenerCount(text) {
  const tokens = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  const fastener = [];
  const numeric = [];
  tokens.forEach((t, i) => {
    if (FASTENER_RE.test(t)) fastener.push(i);
    const prev = i > 0 ? tokens[i - 1] : '';
    const isRef = /^(?:step|steps|panel|photo|image|picture|page|figure)$/.test(prev);
    if ((/\d/.test(t) || COUNT_WORDS.has(t)) && !isRef) numeric.push(i);
  });
  return fastener.some(f => numeric.some(n => Math.abs(f - n) <= 4));
}

/**
 * Per-step photo observations from the model. Suggestions only, never facts. Entries are stripped (not
 * trusted) when they are not {step, text}, point outside the record, exceed 140 characters, are empty,
 * contain a fastener count, or exceed 3 per step. Returns { observations, dropped }.
 */
function sanitizeObservations(raw, stepCount) {
  const out = [];
  const perStep = {};
  let dropped = 0;
  const list = Array.isArray(raw) ? raw : [];
  for (const o of list) {
    const ok = o && typeof o === 'object' && Number.isSafeInteger(o.step) && o.step >= 1 && o.step <= stepCount && typeof o.text === 'string';
    const text = ok ? o.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!ok || !text || text.length > OBS_MAX_CHARS || observationHasFastenerCount(text) || (perStep[o.step] || 0) >= OBS_MAX_PER_STEP) { dropped++; continue; }
    perStep[o.step] = (perStep[o.step] || 0) + 1;
    out.push({ step: o.step, text });
  }
  return { observations: out.sort((a, b) => a.step - b.step), dropped };
}

/** "step3" or legacy "panel3" -> 3, else null. */
function evidenceStepNumber(e) {
  const m = /^(?:step|panel)(\d+)$/i.exec(String(e).trim());
  return m ? Number(m[1]) : null;
}

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
 * Rules:
 *  - Bag IDs are A to H, no duplicates. When opts.expectedBags is given (the bag letters the notes
 *    mention), the bags must equal that set exactly: missing or extra bags are rejected.
 *    Saved sample responses pass expectedBags: null (structure only).
 *  - Steps are 1 to opts.stepCount (default 12). Evidence ids are stepN (legacy panelN is accepted).
 *  - reported_quantities values must be positive safe integers (>0) with non-blank evidence
 *  - confirmed_quantity is ALWAYS forced to null (model cannot confirm)
 *  - Imported conflicts are IGNORED; conflicts are derived from reported_quantities
 *  - All imported strings are treated as untrusted (escaped at render time)
 *  - safety_verified must be false
 */
function validateMetaImport(raw, opts) {
  const o = opts || {};
  const stepCount = Number.isSafeInteger(o.stepCount) && o.stepCount >= 1 && o.stepCount <= MAX_STEPS ? o.stepCount : MAX_STEPS;
  const expected = Array.isArray(o.expectedBags) ? [...new Set(o.expectedBags)].sort() : null;
  if (!raw || !Array.isArray(raw.bags) || raw.safety_verified !== false) {
    return { valid: false, error: 'Invalid format: bags array and safety_verified:false required' };
  }
  if (raw.bags.length > ALL_BAG_IDS.length) {
    return { valid: false, error: 'At most ' + ALL_BAG_IDS.length + ' bags (A to H) are allowed (got ' + raw.bags.length + ')' };
  }
  if (!expected && raw.bags.length < 1) {
    return { valid: false, error: 'At least one bag is required (got 0)' };
  }

  const ids = new Set();
  try {
    const bags = raw.bags.map(b => {
      if (!b || typeof b.id !== 'string') throw new Error('Bag ID must be a string');
      const bid = b.id.trim();
      if (!ALL_BAG_IDS.includes(bid)) throw new Error('Invalid bag ID: ' + bid + ' (only A to H allowed)');
      if (ids.has(bid)) throw new Error('Duplicate bag ID: ' + bid);
      ids.add(bid);
      if (!Array.isArray(b.reported_quantities)) throw new Error('reported_quantities array required (bag ' + bid + ')');

      const reports = b.reported_quantities.map(r => {
        if (!r || !Number.isSafeInteger(r.value) || r.value < 1) throw new Error('Quantity must be a positive integer (bag ' + bid + ', value: ' + (r && r.value) + ')');
        const ev = typeof r.evidence === 'string' ? [r.evidence] : r.evidence ?? [];
        if (!Array.isArray(ev) || ev.length === 0 || ev.some(e => typeof e !== 'string' || !e.trim())) {
          throw new Error('Evidence missing or contains blank strings (bag ' + bid + ')');
        }
        return { value: r.value, evidence: ev.map(e => String(e).trim()) };
      });

      if (b.step !== null && b.step !== undefined && (!Number.isSafeInteger(b.step) || b.step < 1 || b.step > stepCount)) {
        throw new Error('Step must be 1-' + stepCount + ' or null (bag ' + bid + ')');
      }

      return {
        id: bid,
        reports,
        step: (b.step != null && Number.isSafeInteger(b.step) && b.step >= 1 && b.step <= stepCount) ? b.step : null,
        evidence: typeof b.evidence === 'string' ? [b.evidence] : (Array.isArray(b.evidence) ? b.evidence.map(e => String(e)) : []),
        confirmed_quantity: null,
        model_confirmation_proposal: b.confirmed_quantity ?? null,
        requires_user_event: true
      };
    });

    if (expected) {
      const got = [...ids].sort();
      const missing = expected.filter(x => !ids.has(x));
      const extra = got.filter(x => !expected.includes(x));
      if (missing.length) throw new Error('Missing bag ' + missing.join(', ') + ' (your notes mention it)');
      if (extra.length) throw new Error('Extra bag ' + extra.join(', ') + ' (your notes do not mention it)');
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

    const obs = sanitizeObservations(raw.observations, stepCount);

    return { valid: true, bags, questions, conflicts: derivedConflicts, visual_limitations, observations: obs.observations, observations_dropped: obs.dropped, stepCount: Number.isSafeInteger(o.stepCount) ? stepCount : null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
