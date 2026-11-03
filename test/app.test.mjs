/**
 * PackBack MVP -- Unit + Regression Tests
 * Uses node:test + node:assert, zero external dependencies.
 *
 * Covers:
 *  - Record safeguard invariants
 *  - Meta output validation (bag count, positive qty, evidence, conflict derivation)
 *  - Sample data integrity
 *  - Static file existence
 *  - Regression: localStorage restore strips confirmations
 *  - Regression: bags validation requires exactly A/B/C
 *  - Regression: qty must be positive (>=1) for screw sample
 *  - Regression: imported conflicts ignored, derived from reports
 *  - Regression: blank evidence rejected
 *  - Regression: HTML escape coverage
 *  - Regression: custom image disables seeded match
 *  - Regression: step mapping gate
 *  - Regression: no emoji in UI
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');
const SIBLING = join(ROOT, 'lib', 'record.mjs');
const VALIDATOR = join(ROOT, 'lib', 'validate-output.mjs');
const META_DIR = join(ROOT, 'fixtures', 'meta');

// -- Load modules -----------------------------------------------------
const { PackBackRecord, SOURCE_RANK } = await import(SIBLING);
const { validateProposal } = await import(VALIDATOR);

const metaNormal = JSON.parse(readFileSync(join(META_DIR, 'normal.json'), 'utf8'));
const metaMissing = JSON.parse(readFileSync(join(META_DIR, 'missing.json'), 'utf8'));
const metaConflict = JSON.parse(readFileSync(join(META_DIR, 'conflict.json'), 'utf8'));
const sampleInputs = JSON.parse(readFileSync(join(META_DIR, 'inputs.json'), 'utf8'));

// -- Load sample-data.js validation function (eval in Node) -----------
const sampleSrc = readFileSync(join(PUBLIC, 'sample-data.js'), 'utf8');
const sampleModule = new Function('structuredClone', `
  ${sampleSrc}
  return { SAMPLE_INPUTS, SAMPLE_META_OUTPUTS, SEEDED_INPUT_HASH, REQUIRED_BAG_IDS, matchSeededInput, validateMetaImport };
`)(structuredClone);
const { validateMetaImport, matchSeededInput, REQUIRED_BAG_IDS, SAMPLE_INPUTS, SAMPLE_META_OUTPUTS } = sampleModule;

// =====================================================================
// 1. Record safeguard invariants
// =====================================================================
describe('Record safeguards', () => {
  function buildRecord() {
    const rec = new PackBackRecord('test');
    rec.addStep({ action: 'Fully assembled.', source: 'user_reported', evidence: ['panel1'] });
    rec.addStep({ action: 'Removed back panel.', source: 'user_reported', evidence: ['panel2'] });
    rec.addPart({ partId: 'screws_A', name: 'Bag A screws', quantity: 4, storage: 'Bag A', linkedStep: 1, source: 'user_reported', evidence: ['panel2'] });
    rec.addPart({ partId: 'screws_B', name: 'Bag B screws', quantity: 4, storage: 'Bag B', linkedStep: 2, source: 'user_reported', evidence: ['panel3'] });
    return rec;
  }

  it('visual_estimate cannot overwrite user_reported quantity', () => {
    const rec = buildRecord();
    const res = rec.updatePartField('screws_A', 'quantity', 9, 'visual_estimate', ['img']);
    assert.equal(res.updated, false);
    assert.equal(res.blocked, true);
    assert.equal(rec.getPart('screws_A').quantity.value, 4);
  });

  it('visual_estimate cannot overwrite user_confirmed quantity', () => {
    const rec = buildRecord();
    rec.confirmPartField('screws_A', 'quantity', 4, ['ui']);
    const res = rec.updatePartField('screws_A', 'quantity', 5, 'visual_estimate', ['img']);
    assert.equal(res.blocked, true);
    assert.equal(rec.getPart('screws_A').quantity.value, 4);
  });

  it('user_confirmed overwrites user_reported', () => {
    const rec = buildRecord();
    rec.confirmPartField('screws_A', 'quantity', 6, ['recount']);
    assert.equal(rec.getPart('screws_A').quantity.value, 6);
    assert.equal(rec.getPart('screws_A').quantity.source, 'user_confirmed');
  });

  it('same-rank different-value triggers auto-conflict', () => {
    const rec = buildRecord();
    const res = rec.updatePartField('screws_A', 'quantity', 6, 'user_reported', ['note5']);
    assert.equal(res.conflict, true);
    assert.ok(res.autoConflictId);
    assert.equal(rec.getUnresolvedConflicts().length, 1);
    assert.equal(rec.getPart('screws_A').quantity.value, 4);
  });

  it('conflict resolution requires user_confirmed', () => {
    const rec = buildRecord();
    rec.updatePartField('screws_A', 'quantity', 6, 'user_reported', ['note5']);
    const conflict = rec.getUnresolvedConflicts()[0];
    rec.resolveConflict(conflict.conflictId, { resolvedValue: 4, reason: 'User confirmed', evidence: ['ui'] });
    assert.equal(rec.getUnresolvedConflicts().length, 0);
    assert.equal(rec.getPart('screws_A').quantity.source, 'user_confirmed');
  });

  it('history preserved on field updates', () => {
    const rec = buildRecord();
    rec.confirmPartField('screws_A', 'quantity', 5, ['recount']);
    const hist = rec.getPart('screws_A').quantity.history;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].previousValue, 4);
  });

  it('missing fields detected', () => {
    const rec = new PackBackRecord('missing-test');
    rec.addPart({ partId: 'p1', name: 'x', quantity: null, storage: null, linkedStep: null, source: 'inferred', evidence: [] });
    const missing = rec.getMissingFields();
    assert.ok(missing.some(m => m.partId === 'p1' && m.field === 'quantity'));
  });

  it('reassembly summary always has safe:false', () => {
    const rec = buildRecord();
    rec.confirmPartField('screws_A', 'quantity', 4, ['ui']);
    rec.confirmPartField('screws_B', 'quantity', 4, ['ui']);
    const summary = rec.toReassemblySummary();
    assert.equal(summary.safe, false);
  });

  it('toJSON / fromJSON roundtrip preserves structure', () => {
    const rec = buildRecord();
    rec.confirmPartField('screws_A', 'quantity', 4, ['ui']);
    const json = rec.toJSON();
    const rec2 = PackBackRecord.fromJSON(json);
    assert.equal(rec2.getPart('screws_A').quantity.value, 4);
    assert.equal(rec2.getPart('screws_A').quantity.source, 'user_confirmed');
  });
});

// =====================================================================
// 2. Meta output validation (via lib/validate-output)
// =====================================================================
describe('Meta output validation (lib/validate-output)', () => {
  for (const [name, data] of [['normal', metaNormal], ['missing', metaMissing], ['conflict', metaConflict]]) {
    it(`${name}: accepted as proposal with confirmed_quantity=null`, () => {
      const out = validateProposal(data);
      assert.ok(out.bags.every(b => b.confirmed_quantity === null));
      assert.equal(out.safety_verified, false);
      assert.ok(out.bags.every(b => b.requires_user_event === true));
    });
  }

  it('rejects safety_verified:true', () => {
    assert.throws(() => validateProposal({ bags: [], safety_verified: true }));
  });

  it('rejects negative quantity', () => {
    assert.throws(() => validateProposal({
      bags: [{ id: 'A', step: 1, reported_quantities: [{ value: -1, evidence: 'x' }] }],
      safety_verified: false
    }));
  });
});

// =====================================================================
// 3. Sample data integrity
// =====================================================================
describe('Sample data integrity', () => {
  it('sample inputs match fixtures/meta', () => {
    assert.deepEqual(
      sampleInputs.normal.map(n => n.note),
      SAMPLE_INPUTS.normal.notes.map(n => n.note)
    );
  });

  it('conflict scenario has bag A with differing reported values', () => {
    const bagA = metaConflict.bags.find(b => b.id === 'A');
    const values = bagA.reported_quantities.map(r => r.value);
    assert.ok(values.includes(6));
    assert.ok(values.includes(4));
  });

  it('missing scenario has bag B with no reported quantities', () => {
    const bagB = metaMissing.bags.find(b => b.id === 'B');
    assert.equal(bagB.reported_quantities.length, 0);
    assert.equal(bagB.step, null);
  });

  it('all scenarios have safety_verified:false', () => {
    assert.equal(metaNormal.safety_verified, false);
    assert.equal(metaMissing.safety_verified, false);
    assert.equal(metaConflict.safety_verified, false);
  });
});

// =====================================================================
// 4. Static file existence
// =====================================================================
describe('Static files', () => {
  for (const f of ['index.html', 'style.css', 'app.js', 'record-browser.js', 'sample-data.js']) {
    it(`public/${f} exists`, () => {
      assert.doesNotThrow(() => readFileSync(join(PUBLIC, f)));
    });
  }
  it('synthetic 5-panel image exists', () => {
    const stat = readFileSync(join(ROOT, 'fixtures', 'synthetic-shelf.png'));
    assert.ok(stat.length > 100000, 'image should be substantial');
  });
});

// =====================================================================
// 5. REGRESSION: validateMetaImport -- exact A/B/C requirement
// =====================================================================
describe('Regression: validateMetaImport bag validation', () => {
  const baseBag = (id, qty = 4, step = 2) => ({
    id, reported_quantities: [{ value: qty, evidence: 'panel2' }],
    confirmed_quantity: null, step, evidence: ['panel2']
  });

  it('rejects empty bags array', () => {
    const r = validateMetaImport({ bags: [], safety_verified: false });
    assert.equal(r.valid, false);
    assert.match(r.error, /3/);
  });

  it('rejects only bag A (missing B and C)', () => {
    const r = validateMetaImport({ bags: [baseBag('A')], safety_verified: false });
    assert.equal(r.valid, false);
  });

  it('rejects bags A, B only (missing C)', () => {
    const r = validateMetaImport({ bags: [baseBag('A'), baseBag('B', 4, 3)], safety_verified: false });
    assert.equal(r.valid, false);
  });

  it('rejects duplicate bag A', () => {
    const r = validateMetaImport({ bags: [baseBag('A'), baseBag('A'), baseBag('C', 4, 4)], safety_verified: false });
    assert.equal(r.valid, false);
    assert.match(r.error, /[Dd]uplicate/);
  });

  it('rejects bag D (invalid ID)', () => {
    const r = validateMetaImport({ bags: [baseBag('A'), baseBag('B', 4, 3), baseBag('D', 4, 4)], safety_verified: false });
    assert.equal(r.valid, false);
    assert.match(r.error, /[Ii]nvalid|allowed/);
  });

  it('accepts exactly A, B, C', () => {
    const r = validateMetaImport({ bags: [baseBag('A'), baseBag('B', 4, 3), baseBag('C', 4, 4)], safety_verified: false });
    assert.equal(r.valid, true);
    assert.equal(r.bags.length, 3);
  });

  it('accepts A, B, C in any order', () => {
    const r = validateMetaImport({ bags: [baseBag('C', 4, 4), baseBag('A'), baseBag('B', 4, 3)], safety_verified: false });
    assert.equal(r.valid, true);
  });
});

// =====================================================================
// 6. REGRESSION: positive quantity requirement (>=1)
// =====================================================================
describe('Regression: positive quantity requirement', () => {
  const mkBags = (qtyA) => ({
    bags: [
      { id: 'A', reported_quantities: [{ value: qtyA, evidence: 'p2' }], confirmed_quantity: null, step: 2, evidence: ['p2'] },
      { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], confirmed_quantity: null, step: 3, evidence: ['p3'] },
      { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], confirmed_quantity: null, step: 4, evidence: ['p4'] },
    ],
    safety_verified: false
  });

  it('rejects quantity 0', () => {
    const r = validateMetaImport(mkBags(0));
    assert.equal(r.valid, false);
    assert.match(r.error, /positive|1/);
  });

  it('rejects quantity -1', () => {
    const r = validateMetaImport(mkBags(-1));
    assert.equal(r.valid, false);
  });

  it('rejects quantity 0.5 (non-integer)', () => {
    const r = validateMetaImport(mkBags(0.5));
    assert.equal(r.valid, false);
  });

  it('accepts quantity 1', () => {
    const r = validateMetaImport(mkBags(1));
    assert.equal(r.valid, true);
  });

  it('accepts quantity 4', () => {
    const r = validateMetaImport(mkBags(4));
    assert.equal(r.valid, true);
  });
});

// =====================================================================
// 7. REGRESSION: blank evidence rejected
// =====================================================================
describe('Regression: blank evidence rejected', () => {
  it('rejects empty string evidence', () => {
    const r = validateMetaImport({
      bags: [
        { id: 'A', reported_quantities: [{ value: 4, evidence: '' }], step: 2, evidence: ['p2'] },
        { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], step: 3, evidence: ['p3'] },
        { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], step: 4, evidence: ['p4'] },
      ],
      safety_verified: false
    });
    assert.equal(r.valid, false);
    assert.match(r.error, /[Ee]vidence/);
  });

  it('rejects whitespace-only evidence', () => {
    const r = validateMetaImport({
      bags: [
        { id: 'A', reported_quantities: [{ value: 4, evidence: '   ' }], step: 2, evidence: ['p2'] },
        { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], step: 3, evidence: ['p3'] },
        { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], step: 4, evidence: ['p4'] },
      ],
      safety_verified: false
    });
    assert.equal(r.valid, false);
  });

  it('rejects null evidence array', () => {
    const r = validateMetaImport({
      bags: [
        { id: 'A', reported_quantities: [{ value: 4, evidence: null }], step: 2, evidence: ['p2'] },
        { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], step: 3, evidence: ['p3'] },
        { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], step: 4, evidence: ['p4'] },
      ],
      safety_verified: false
    });
    assert.equal(r.valid, false);
  });
});

// =====================================================================
// 8. REGRESSION: imported conflicts ignored, derived from reports
// =====================================================================
describe('Regression: conflict derivation', () => {
  it('imported conflict status/resolution is ignored', () => {
    const r = validateMetaImport({
      bags: [
        { id: 'A', reported_quantities: [{ value: 6, evidence: 'p2' }, { value: 4, evidence: 'p5' }], step: 2, evidence: ['p2', 'p5'] },
        { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], step: 3, evidence: ['p3'] },
        { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], step: 4, evidence: ['p4'] },
      ],
      conflicts: [{ bag: 'A', reported_values: [6, 4], status: 'resolved', resolution: { value: 6 } }],
      safety_verified: false
    });
    assert.equal(r.valid, true);
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.conflicts[0].bag, 'A');
    assert.equal(r.conflicts[0].status, 'unresolved');
    assert.equal(r.conflicts[0].resolution, null);
  });

  it('no conflict when all reports agree', () => {
    const r = validateMetaImport({
      bags: [
        { id: 'A', reported_quantities: [{ value: 4, evidence: 'p2' }, { value: 4, evidence: 'p5' }], step: 2, evidence: ['p2', 'p5'] },
        { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], step: 3, evidence: ['p3'] },
        { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], step: 4, evidence: ['p4'] },
      ],
      safety_verified: false
    });
    assert.equal(r.valid, true);
    assert.equal(r.conflicts.length, 0);
  });

  it('conflict derived from differing reported values', () => {
    const r = validateMetaImport({
      bags: [
        { id: 'A', reported_quantities: [{ value: 6, evidence: 'p2' }, { value: 4, evidence: 'p5' }], step: 2, evidence: ['p2'] },
        { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], step: 3, evidence: ['p3'] },
        { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], step: 4, evidence: ['p4'] },
      ],
      safety_verified: false
    });
    assert.equal(r.conflicts.length, 1);
    assert.deepEqual(r.conflicts[0].reported_values, [6, 4]);
  });
});

// =====================================================================
// 9. REGRESSION: confirmed_quantity always null in validated output
// =====================================================================
describe('Regression: confirmed_quantity always null', () => {
  it('model-proposed confirmation is stripped to null', () => {
    const r = validateMetaImport({
      bags: [
        { id: 'A', reported_quantities: [{ value: 4, evidence: 'p2' }], confirmed_quantity: 4, step: 2, evidence: ['p2'] },
        { id: 'B', reported_quantities: [{ value: 4, evidence: 'p3' }], confirmed_quantity: 4, step: 3, evidence: ['p3'] },
        { id: 'C', reported_quantities: [{ value: 4, evidence: 'p4' }], confirmed_quantity: 4, step: 4, evidence: ['p4'] },
      ],
      safety_verified: false
    });
    assert.equal(r.valid, true);
    r.bags.forEach(b => {
      assert.equal(b.confirmed_quantity, null);
      assert.equal(b.model_confirmation_proposal, 4);
      assert.equal(b.requires_user_event, true);
    });
  });
});

// =====================================================================
// 10. REGRESSION: matchSeededInput with custom image
// =====================================================================
describe('Regression: custom image disables seeded match', () => {
  it('custom image returns matched:false even with exact seeded notes', () => {
    const notes = SAMPLE_INPUTS.normal.notes;
    const result = matchSeededInput(notes, true);
    assert.equal(result.matched, false);
  });

  it('no custom image matches seeded notes', () => {
    const notes = SAMPLE_INPUTS.normal.notes;
    const result = matchSeededInput(notes, false);
    assert.equal(result.matched, true);
    assert.equal(result.scenarioId, 'normal');
  });
});

// =====================================================================
// 11. REGRESSION: localStorage never restores confirmed record
// =====================================================================
describe('Regression: localStorage safety', () => {
  it('app.js loadState strips record, confirmations, stepMappings', () => {
    const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    assert.ok(appSrc.includes('delete parsed.record'), 'loadState must delete parsed.record');
    assert.ok(appSrc.includes('delete parsed.confirmations'), 'loadState must delete parsed.confirmations');
    assert.ok(appSrc.includes('delete parsed.stepMappings'), 'loadState must delete parsed.stepMappings');
  });

  it('saveState does not include record or confirmations', () => {
    const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    const saveIdx = appSrc.indexOf('function saveState()');
    const persistBlock = appSrc.substring(saveIdx, saveIdx + 600);
    assert.ok(!persistBlock.includes("record:"), 'saveState must not persist record');
    assert.ok(!persistBlock.includes("confirmations:"), 'saveState must not persist confirmations');
  });
});

// =====================================================================
// 12. REGRESSION: no emoji in UI
// =====================================================================
describe('Regression: no emoji in UI', () => {
  it('index.html contains no emoji characters', () => {
    const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
    const emojiPattern = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.ok(!emojiPattern.test(html), 'index.html should not contain emoji');
  });

  it('app.js contains no emoji characters', () => {
    const js = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    const emojiPattern = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.ok(!emojiPattern.test(js), 'app.js should not contain emoji');
  });
});

// =====================================================================
// 13. REGRESSION: step mapping gate in app logic
// =====================================================================
describe('Regression: step mapping gate in app logic', () => {
  it('app.js checks allMapped before enabling reassembly', () => {
    const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    assert.ok(appSrc.includes('allMapped'), 'app.js must check allMapped gate');
    assert.ok(appSrc.includes('stepMappings'), 'app.js must track stepMappings');
  });

  it('app.js has step mapping UI for missing mappings', () => {
    const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    assert.ok(appSrc.includes('confirm-mapping'), 'app.js must have mapping confirmation buttons');
    assert.ok(appSrc.includes('step-map-'), 'app.js must have step mapping select elements');
  });
});

// =====================================================================
// 14. REGRESSION: HTML escaping
// =====================================================================
describe('Regression: HTML escaping', () => {
  it('app.js uses esc() for all dynamic content rendering', () => {
    const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    const escCalls = (appSrc.match(/esc\(/g) || []).length;
    assert.ok(escCalls >= 30, `Expected at least 30 esc() calls, found ${escCalls}`);
  });

  it('app.js uses esc() not the old escapeHtml()', () => {
    const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    assert.ok(!appSrc.includes('escapeHtml'), 'Should use esc() not escapeHtml()');
  });
});

// =====================================================================
// 15. Seeded scenarios validate through validateMetaImport
// =====================================================================
describe('All seeded scenarios pass validateMetaImport', () => {
  for (const id of ['normal', 'missing', 'conflict']) {
    it(`${id} scenario validates successfully`, () => {
      const r = validateMetaImport(SAMPLE_META_OUTPUTS[id]);
      assert.equal(r.valid, true, `${id} should be valid: ${r.error}`);
      assert.equal(r.bags.length, 3);
      r.bags.forEach(b => {
        assert.equal(b.confirmed_quantity, null);
        assert.equal(b.requires_user_event, true);
      });
    });
  }
});

// =====================================================================
// 16. Reassembly refs: confirmed quantity lines and corrections
// =====================================================================
describe('buildReassemblyRefs', () => {
  const refsSrc = readFileSync(join(PUBLIC, 'reassembly-refs.js'), 'utf8');
  const { buildReassemblyRefs } = new Function('module', 'window', `${refsSrc}; return module.exports;`)({ exports: {} }, undefined);
  const NOTE = 'Removed back panel. Put 6 screws in bag A.';

  function build(confirmA) {
    const rec = new PackBackRecord('t');
    rec.addStep({ action: 'Fully assembled.', source: 'user_reported', evidence: ['panel1'] });
    rec.addStep({ action: NOTE, source: 'user_reported', evidence: ['panel2'] });
    rec.addStep({ action: 'Bag B step.', source: 'user_reported', evidence: ['panel3'] });
    rec.addPart({ partId: 'screws_A', name: 'A', quantity: 6, storage: 'Bag A', linkedStep: 2, source: 'user_reported', evidence: ['panel2'] });
    rec.addPart({ partId: 'screws_B', name: 'B', quantity: 4, storage: 'Bag B', linkedStep: 3, source: 'user_reported', evidence: ['panel3'] });
    if (confirmA != null) rec.confirmPartField('screws_A', 'quantity', confirmA, ['ui']);
    const extraction = { bags: [
      { id: 'A', step: 2, reports: [{ value: 6, evidence: ['panel2'] }, { value: 4, evidence: ['panel5'] }] },
      { id: 'B', step: 3, reports: [{ value: 4, evidence: ['panel3'] }] }
    ] };
    return buildReassemblyRefs(rec, extraction, { A: 2, B: 3 }, []);
  }

  it('keeps original note verbatim and shows confirmed + correction lines', () => {
    const refs = build(4);
    const step2 = refs.find(r => r.step.stepIndex === 1);
    assert.equal(step2.originalNote, NOTE);
    assert.deepEqual(step2.lines.map(l => l.text), ['Bag A: you confirmed 4 screws']);
    assert.deepEqual(step2.lines[0].corrections, ['Note recorded 6. Corrected to 4 by your confirmation.']);
  });

  it('no correction when the step evidence agrees with the confirmed value', () => {
    const refs = build(4);
    const step3 = refs.find(r => r.step.stepIndex === 2);
    assert.equal(step3.lines.length, 0); // B not user confirmed
    const rec = new PackBackRecord('t');
    rec.addStep({ action: 'x', source: 'user_reported', evidence: ['panel2'] });
    rec.addPart({ partId: 'screws_A', name: 'A', quantity: 4, storage: 'Bag A', linkedStep: 1, source: 'user_reported', evidence: ['panel2'] });
    rec.confirmPartField('screws_A', 'quantity', 4, ['ui']);
    const r = buildReassemblyRefs(rec, { bags: [{ id: 'A', reports: [{ value: 4, evidence: ['panel2'] }] }] }, { A: 1 }, []);
    assert.equal(r[0].lines[0].corrections.length, 0);
  });

  it('shows no lines for unconfirmed bags and does not use model proposals', () => {
    const refs = build(null);
    refs.forEach(r => assert.equal(r.lines.length, 0));
  });

  it('app.js renders via helper with esc() and no emoji/em dash', () => {
    const appSrc = readFileSync(join(PUBLIC, 'app.js'), 'utf8');
    assert.ok(appSrc.includes('buildReassemblyRefs(currentRecord'));
    assert.ok(appSrc.includes('esc(l.text)') && appSrc.includes('esc(c)') && appSrc.includes('esc(ref.originalNote)'));
    assert.ok(!/\u2014/.test(refsSrc));
    assert.ok(readFileSync(join(PUBLIC, 'index.html'), 'utf8').includes('reassembly-refs.js'));
  });
});
