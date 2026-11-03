import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const rules = new Function('structuredClone', `${read('sample-data.js')}
return { bagLettersFromNotes, validateMetaImport, observationHasFastenerCount, crossCheckAndDerive, deriveNoteQuantities, bagPrefill };`)(structuredClone);

function run(note, reports) {
  const notes = [{ panel: 1, note }];
  const bags = Object.entries(reports).map(([id, value]) => ({ id, reported_quantities: [{ value, evidence: 'step1' }], step: 1, evidence: [], confirmed_quantity: null }));
  const raw = { safety_verified: false, questions: [], visual_limitations: [], bags };
  const v = rules.crossCheckAndDerive(rules.validateMetaImport(raw, { expectedBags: rules.bagLettersFromNotes(notes), stepCount: 1, failSoft: true }), notes);
  return Object.fromEntries(v.bags.map(b => [b.id, rules.bagPrefill(b)]));
}

describe('prefill needs a Meta-reported, note-supported value', () => {
  it('bag B stays empty when only A is reported', () => {
    assert.deepEqual(run('Put 4 screws in bag A but bag B is empty.', { A: 4 }), { A: 4, B: null });
  });
  it('bag A stays empty when only B is reported', () => {
    assert.deepEqual(run('Put 9 screws in bag B or bag A is spare.', { B: 9 }), { A: null, B: 9 });
  });
  it('bag B stays empty when it waits', () => {
    assert.deepEqual(run('Put 6 screws in bag A while bag B waits.', { A: 6 }), { A: 6, B: null });
  });
  it('note-derived numbers are not attributed to empty, spare, unused, none or nothing bags', () => {
    for (const w of ['empty', 'spare', 'waits', 'unused', 'none']) {
      const d = rules.deriveNoteQuantities([{ panel: 1, note: `Put 5 screws in bag A, bag B is ${w}.` }]);
      assert.equal(d.B, undefined, w);
      assert.ok(d.A.has(5));
    }
  });
  it('note-only numbers never prefill', () => {
    assert.deepEqual(run('Put 4 screws in bag A.', {}), { A: null });
  });
});

describe('observation count filter hardening', () => {
  for (const t of ['xxi screws on the left', 'xxx screws', 'l screws', '4 scr\u00adews', '4 scr\u200bews', '4 scr\u200dews', '4 of the small round silver head screws']) {
    it('filters ' + JSON.stringify(t), () => assert.equal(rules.observationHasFastenerCount(t), true));
  }
  it('still allows plain text', () => {
    assert.equal(rules.observationHasFastenerCount('Silver screws on the left panel.'), false);
  });
});
