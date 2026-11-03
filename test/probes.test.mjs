import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const src = read('sample-data.js');
const rules = new Function('structuredClone', `${src}
return { bagLettersFromNotes, observationHasFastenerCount, crossCheckAndDerive, deriveNoteQuantities, noteSupportsQuantity, quantitiesInNote, UNLABELED_BAGS_MESSAGE };`)(structuredClone);
const notesOf = (arr) => arr.map((note, i) => ({ panel: i + 1, note }));
const bags = (t) => rules.bagLettersFromNotes(notesOf([t]));
const sup = (t, n, b) => rules.noteSupportsQuantity(t, n, b);
const derived = (t) => { const d = rules.deriveNoteQuantities(notesOf([t])); return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [...v.keys()]])); };

describe('Review probes: bag letters', () => {
  it('lowercase voice transcripts', () => {
    assert.deepEqual(bags('put screws in bag a'), ['A']);
    assert.deepEqual(bags('put 4 screws in bag b'), ['B']);
    assert.deepEqual(bags('bags a, b and c'), ['A', 'B', 'C']);
  });
  it('sentence boundaries and articles', () => {
    assert.deepEqual(bags('Put 4 screws in a bag. A lid came off.'), []);
    assert.deepEqual(bags('Put 4 screws in a bag.\nA screw fell.'), []);
    assert.deepEqual(bags('Put them in a bag'), []);
    assert.deepEqual(bags('bag a lot of screws'), []);
    assert.deepEqual(bags('bag a few screws'), []);
    assert.deepEqual(bags('I will bag a screw'), ['A']);
  });
  it('lists and ranges', () => {
    assert.deepEqual(bags('bags A/B/C'), ['A', 'B', 'C']);
    assert.deepEqual(bags('bags A-C'), ['A', 'B', 'C']);
    assert.deepEqual(bags('bags A to C'), ['A', 'B', 'C']);
    assert.deepEqual(bags('bags a to c'), ['A', 'B', 'C']);
    assert.deepEqual(bags('Bag A, bag B and bag C'), ['A', 'B', 'C']);
  });
  it('unlabeled message mentions letters A to H', () => assert.match(rules.UNLABELED_BAGS_MESSAGE, /letters A to H/));
});

describe('Review probes: bag-bound quantities', () => {
  it('each quantity goes to its own bag', () => {
    assert.deepEqual(derived('4 screws in bag A and 6 screws in bag B'), { A: [4], B: [6] });
    assert.equal(sup('4 screws in bag A and 6 screws in bag B', 6, 'A'), false);
    assert.equal(sup('4 screws in bag A and 6 screws in bag B', 6, 'B'), true);
    assert.deepEqual(derived('bag A: 4 screws, bag B: 6 screws'), { A: [4], B: [6] });
  });
  it('quantity in another sentence does not support the bag', () => {
    assert.equal(sup('6 screws stayed in the tray. Bag A is empty.', 6, 'A'), false);
    assert.deepEqual(derived('6 screws stayed in the tray. Bag A is empty.'), {});
  });
  it('summary form and the simple form work', () => {
    assert.deepEqual(derived('Bags A/B/C each hold 4.'), { A: [4], B: [4], C: [4] });
    assert.equal(sup('Put 4 screws in bag A', 4, 'A'), true);
  });
});

describe('Review probes: non-count numbers', () => {
  const q = (t) => [...rules.quantitiesInNote(t)];
  it('step, shelf, part, No., size and length are not counts', () => {
    assert.deepEqual(q('step 4 screws in bag A'), []);
    assert.deepEqual(q('shelf 4 screws'), []);
    assert.deepEqual(q('part 12 nuts'), []);
    assert.deepEqual(q('No. 8 screws'), []);
    assert.deepEqual(q('M4 x 20 screws'), []);
    assert.deepEqual(q('20 mm screws'), []);
    assert.deepEqual(q('Put 5 in bag A.'), [5]);
  });
});

describe('Review probes: observation filter', () => {
  const f = (t) => rules.observationHasFastenerCount(t);
  it('glued digits, zero counts, wider window', () => {
    assert.equal(f('4screws visible'), true);
    assert.equal(f('There are no screws'), true);
    assert.equal(f('several small metal pieces near screw'), true);
    assert.equal(f('The back panel has a visible seam'), false);
  });
});

describe('Review probes: live client path', () => {
  it('app.js runs crossCheckAndDerive after toImportShape', () => {
    assert.match(read('app.js'), /toImportShape\(j\.proposal\)[\s\S]{0,900}crossCheckAndDerive\(validated, notes\)/);
  });
});
