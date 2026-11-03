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

/**
 * Bag letters in one piece of text. "bag A", "BAG A", "bagA", "bag-A", "bag #A", "bags A/B/C", "bags A, B and C".
 * The word is matched without regard to case; the letter must be an upper-case A to H on its own.
 */
const BAG_HEAD_RE = /(?<![A-Za-z])bags?[\s\-#:]*([A-Ha-h])(?![A-Za-z0-9])/gi;
const BAG_CONT_RE = /\s*(?:(?:[\/,&]|and\b|or\b)|(-|\u2013|to\b))\s*([A-Ha-h])(?![A-Za-z0-9])/y;
// A lowercase "a" right after "bag" is a letter only when what follows cannot make it an article.
const LOWER_A_OK = /^(?:\s*(?:[,;:.!?)\/&\-\u2013=]|$)|\s+(?:and|or|to|is|are|was|has|have|had|holds?|contains?|with|each|total|screws?|bolts?|fasteners?|washers?|nuts?|dowels?|\d))/i;
function letterOk(ch, rest) { return ch !== 'a' || LOWER_A_OK.test(rest); }
/** Sentences of a text: split after . ! ? ; and on newlines. */
function sentencesOf(text) { return String(text).normalize('NFKC').split(/(?<=[.;!?])\s+|\s*\n\s*/).filter(x => x.trim()); }
function bagLettersInSentence(sentence) {
  const found = new Set();
  const re = new RegExp(BAG_HEAD_RE.source, 'gi');
  let m;
  while ((m = re.exec(sentence)) !== null) {
    if (!letterOk(m[1], sentence.slice(m.index + m[0].length))) { re.lastIndex = m.index + 4; continue; }
    let last = m[1].toUpperCase();
    found.add(last);
    let pos = m.index + m[0].length;
    for (;;) {
      const c = new RegExp(BAG_CONT_RE.source, 'y'); c.lastIndex = pos;
      const cm = c.exec(sentence);
      if (!cm || !letterOk(cm[2], sentence.slice(c.lastIndex === pos ? pos : pos + cm[0].length))) break;
      const next = cm[2].toUpperCase();
      if (cm[1]) { for (let k = last.charCodeAt(0); k <= next.charCodeAt(0); k++) found.add(String.fromCharCode(k)); }
      else found.add(next);
      last = next; pos += cm[0].length; re.lastIndex = pos;
    }
  }
  return [...found];
}
function bagLettersInText(text) {
  const found = new Set();
  for (const sen of sentencesOf(text)) for (const l of bagLettersInSentence(sen)) found.add(l);
  return [...found];
}
/** Clauses of a text: sentences, split again on commas and " and " when each side names its own bag. */
function clausesOf(text) {
  const out = [];
  for (const sen of sentencesOf(text)) {
    const parts = sen.split(/\s*,\s*|\s+and\s+/i);
    let cur = '';
    for (const p of parts) {
      if (cur && bagLettersInSentence(p).length && bagLettersInSentence(cur).length) { out.push(cur); cur = p; }
      else cur = cur ? cur + ' ' + p : p;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Bag letters (A to H) a set of notes mentions. Sorted, unique. */
function bagLettersFromNotes(notes) {
  const found = new Set();
  for (const n of (Array.isArray(notes) ? notes : [])) {
    for (const l of bagLettersInText(n && n.note != null ? n.note : '')) found.add(l);
  }
  return [...found].sort();
}

/** True when the notes talk about screws, bolts or fasteners. Used to ask for bag labels before a live call. */
function notesMentionFasteners(notes) {
  return (Array.isArray(notes) ? notes : []).some(n => /\b(?:screws?|bolts?|fasteners?)\b/i.test(String(n && n.note != null ? n.note : '').normalize('NFKC')));
}
const UNLABELED_BAGS_MESSAGE = 'Your notes mention screws but no bag letter. Label the bags using the letters A to H (for example "bag A") and try again.';

// ---- Quantities stated in notes ------------------------------------------------------
const NW_ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const NW_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NW_UNITS = Object.keys(NW_ONES).filter(w => NW_ONES[w] >= 1 && NW_ONES[w] <= 9);
const NUMW_SOURCE = '(?:(?:' + Object.keys(NW_TENS).join('|') + ')(?:[\\s-]+(?:' + NW_UNITS.join('|') + '))?|' + Object.keys(NW_ONES).sort((x, y) => y.length - x.length).join('|') + ')';
// A number that stands alone: not part of M4, #8, 3.5, 4mm or a longer token.
const NUM_SOURCE = '(?<![A-Za-z0-9#.])(\\d+|' + NUMW_SOURCE + ')(?![A-Za-z0-9])';
const NUM_SOURCE_GLUED = '(?<![A-Za-z0-9#.])(\\d+|' + NUMW_SOURCE + ')(?![0-9])(?=\\s|screws?|bolts?|nuts?|washers?|dowels?|fasteners?)';
const FASTENER_WORD = '(?:screws?|bolts?|fasteners?|washers?|nuts?|dowels?)\\b';
const UNIT_WORD = /^(?:mm|cm|m|in|inch|inches|millimeters?|centimeters?|x|by|long|length|wide|thick)$/i;

// A number after step/shelf/panel/part/no./# or after "x" (M4 x 20), or before mm/cm/in, is not a count.
const NONCOUNT_BEFORE = /(?:\b(?:steps?|shelf|shelves|panels?|parts?|no|nos|number|item|page|figure|fig|photo|image)\.?\s*#?\s*|#\s*|[x\u00d7]\s*)$/i;
const NONCOUNT_AFTER = /^\s*-?\s*(?:mm|cm|in(?!\s+(?:bags?|total)\b)|inch|inches|millimeters?|centimeters?)\b/i;
function isNonCount(t, start, len) { return NONCOUNT_BEFORE.test(t.slice(0, start)) || NONCOUNT_AFTER.test(t.slice(start + len)); }

/** "twenty-four" / "twenty four" / "24" -> 24, else NaN. Number words run to ninety-nine. */
function numberFromToken(t) {
  const s = String(t).toLowerCase().trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(/[\s-]+/);
  if (parts.length === 1) return s in NW_ONES ? NW_ONES[s] : (s in NW_TENS ? NW_TENS[s] : NaN);
  if (parts.length === 2 && parts[0] in NW_TENS && parts[1] in NW_ONES && NW_ONES[parts[1]] >= 1 && NW_ONES[parts[1]] <= 9) return NW_TENS[parts[0]] + NW_ONES[parts[1]];
  return NaN;
}

/**
 * Integers a note states as a count of fasteners or of what is in a bag. A number counts only when it
 * quantifies a screw, bolt, fastener, washer, nut or dowel ("4 screws", "four small screws"), follows
 * holds/has/have/contains ("holds 4"), or sits next to a bag ("4 in bag A", "bag A: 4").
 * Size tokens (M4, #8, 3.5, 4mm) and step, shelf, panel or part numbers never count.
 */
function quantitiesInNote(text) {
  const t = String(text).normalize('NFKC');
  const out = new Set();
  const add = (tok, start) => { const n = numberFromToken(tok); if (Number.isSafeInteger(n) && !isNonCount(t, start, String(tok).length)) out.add(n); };
  const re = new RegExp(NUM_SOURCE_GLUED + '\\s*((?:[A-Za-z0-9#.]+\\s+){0,2}?)' + FASTENER_WORD, 'gi');
  let m;
  while ((m = re.exec(t)) !== null) {
    const between = m[2].trim().split(/\s+/).filter(Boolean);
    // A skipped candidate must not swallow the numbers after it ("shelf 4 and 6 screws").
    if (between.some(w => UNIT_WORD.test(w) || /^(?:and|or|then|to)$/i.test(w) || Number.isFinite(numberFromToken(w)) || /^\d/.test(w))) { re.lastIndex = m.index + 1; continue; }
    add(m[1], m.index + m[0].indexOf(m[1]));
  }
  for (const m of t.matchAll(new RegExp('\\b(?:holds?|has|have|contains?)\\s+' + NUM_SOURCE + '(?=\\s*(?:[.,;!?]|$)|\\s+(?:each|total|in total|pieces?|items?)\\b)', 'gi'))) add(m[1], m.index + m[0].indexOf(m[1]));
  for (const m of t.matchAll(new RegExp(NUM_SOURCE + '\\s+(?:of them\\s+)?(?:in|into|for)\\s+bags?\\b', 'gi'))) add(m[1], m.index + m[0].indexOf(m[1]));
  for (const m of t.matchAll(new RegExp('\\bbags?[\\s\\-#]*[A-H]\\s*[:=]\\s*' + NUM_SOURCE, 'gi'))) add(m[1], m.index + m[0].indexOf(m[1]));
  return out;
}

/** True when the note states n as a fastener or bag quantity. */
function noteSupportsQuantity(text, n, bagId) {
  if (!bagId) return quantitiesInNote(text).has(n);
  return clausesOf(text).some(c => bagLettersInSentence(c).includes(bagId) && quantitiesInNote(c).has(n));
}

/** Integers each note states for each bag, e.g. { A: Map(4 -> [5], 6 -> [2]) }. */
function deriveNoteQuantities(notes) {
  const out = {};
  for (const { panel, note } of notes) {
    for (const sentence of clausesOf(note)) {
      const bags = bagLettersInSentence(sentence);
      if (!bags.length) continue;
      for (const b of bags) for (const n of quantitiesInNote(sentence)) {
        if (!Number.isSafeInteger(n) || n < 1) continue;
        if (!out[b]) out[b] = new Map();
        if (!out[b].has(n)) out[b].set(n, []);
        if (!out[b].get(n).includes(panel)) out[b].get(n).push(panel);
      }
    }
  }
  return out;
}

/**
 * Cross-check a validated import against the notes, add note-derived reports, recompute conflicts.
 * Every cited step must exist and its note must state the reported quantity. Evidence becomes stepN.
 * Throws an Error with code "unsupported_quantity" when a report is not backed by its cited note.
 */
function crossCheckAndDerive(v, notes) {
  const byStep = new Map(notes.map(n => [n.panel, n.note]));
  const unsupported = () => { const e = new Error('a reported quantity is not supported by the notes'); e.code = 'unsupported_quantity'; return e; };
  for (const bag of v.bags) {
    for (const r of bag.reports) {
      for (const ev of r.evidence) {
        const n = evidenceStepNumber(ev);
        if (n === null || !byStep.has(n) || !noteSupportsQuantity(byStep.get(n), r.value, bag.id)) throw unsupported();
      }
      r.evidence = r.evidence.map(e => 'step' + evidenceStepNumber(e));
    }
    bag.evidence = (bag.evidence || []).map(e => { const n = evidenceStepNumber(e); return n === null ? e : 'step' + n; });
  }
  const derived = deriveNoteQuantities(notes);
  for (const bag of v.bags) {
    const vals = derived[bag.id];
    if (!vals || vals.size < 2) continue;
    for (const [value, panels] of vals) {
      for (const p of panels) {
        const ev = 'step' + p;
        if (!bag.reports.some(r => r.value === value && r.evidence.includes(ev))) bag.reports.push({ value, evidence: [ev] });
      }
    }
  }
  v.conflicts = [];
  for (const bag of v.bags) {
    const unique = [...new Set(bag.reports.map(r => r.value))];
    if (unique.length > 1) {
      v.conflicts.push({ bag: bag.id, reported_values: unique, evidence: bag.reports.flatMap(r => r.evidence), status: 'unresolved', resolution: null });
    }
  }
  return v;
}

const OBS_MAX_PER_STEP = 3;
const OBS_MAX_CHARS = 140;
const COUNT_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'dozen', 'dozens', 'pair', 'pairs', 'couple', 'single', 'double', 'triple',
  'few', 'several', 'many', 'handful', 'handfuls', 'lots', 'lot', 'numerous', 'some', 'plenty', 'multiple', 'bunch', 'bunches', 'loads', 'both', 'no', 'none', 'zero']);
const ROMAN_RE = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv|xvi{0,3}|xx)$/;
const FASTENER_RE = /^(?:screws?|bolts?|nuts?|washers?|fasteners?|dowels?)$/;

/**
 * True when a text states or hints at a count of fasteners: a digit (fullwidth digits are normalized
 * first), number word, vague quantity (a few, several, many, a handful of, lots of, numerous, some) or
 * roman numeral within four words of screw, bolt, nut, washer, dowel or fastener. Numbers that name a
 * step or photo ("step 3") do not count. Over-blocking is intended.
 */
function observationHasFastenerCount(text) {
  const tokens = String(text).normalize('NFKC').toLowerCase().match(/\d+|[a-z]+\d*/g) || [];
  const fastener = [];
  const numeric = [];
  tokens.forEach((t, i) => {
    if (FASTENER_RE.test(t)) fastener.push(i);
    const prev = i > 0 ? tokens[i - 1] : '';
    const isRef = /^(?:step|steps|panel|photo|image|picture|page|figure)$/.test(prev);
    if (isRef) return;
    if (t === 'many' && prev === 'how') return;
    if (/\d/.test(t) || COUNT_WORDS.has(t) || ROMAN_RE.test(t)) numeric.push(i);
  });
  return fastener.some(f => numeric.some(n => Math.abs(f - n) <= 6));
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
      ? raw.questions.filter(q => typeof q === 'string' && (o.trustedSample || !observationHasFastenerCount(q))).map(q => String(q))
      : [];
    const visual_limitations = Array.isArray(raw.visual_limitations)
      ? raw.visual_limitations.filter(l => typeof l === 'string' && (o.trustedSample || !observationHasFastenerCount(l))).map(l => String(l))
      : [];

    const obs = sanitizeObservations(raw.observations, stepCount);

    return { valid: true, bags, questions, conflicts: derivedConflicts, visual_limitations, observations: obs.observations, observations_dropped: obs.dropped, stepCount: Number.isSafeInteger(o.stepCount) ? stepCount : null };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}
