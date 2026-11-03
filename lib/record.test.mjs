/**
 * PackBack v2 - Deterministic Record Safeguard Tests
 * Uses node:test + node:assert, zero external dependencies.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PackBackRecord,
  makeField,
  updateField,
  SOURCE_RANK,
} from './record.mjs';

// ═══════════════════════════════════════════════════════════════════
// Helper: build a typical shelf record from the gate-1 test cases
// ═══════════════════════════════════════════════════════════════════
function buildShelfRecord() {
  const rec = new PackBackRecord('test-shelf');
  rec.addStep({ action: 'assembled_baseline', source: 'user_reported', evidence: ['panel1'] });
  rec.addStep({ action: 'removed_back_panel', source: 'user_reported', evidence: ['panel2'] });
  rec.addStep({ action: 'removed_upper_shelf', source: 'user_reported', evidence: ['panel3'] });
  rec.addStep({ action: 'removed_lower_shelf', source: 'user_reported', evidence: ['panel4'] });

  rec.addPart({ partId: 'screws_A', name: 'back panel screws', quantity: 4, storage: 'Bag A', linkedStep: 1, source: 'user_reported', evidence: ['panel2', 'note_2'] });
  rec.addPart({ partId: 'screws_B', name: 'upper shelf screws', quantity: 4, storage: 'Bag B', linkedStep: 2, source: 'user_reported', evidence: ['panel3', 'note_3'] });
  rec.addPart({ partId: 'screws_C', name: 'lower shelf screws', quantity: 4, storage: 'Bag C', linkedStep: 3, source: 'user_reported', evidence: ['panel4', 'note_4'] });
  return rec;
}

// ═══════════════════════════════════════════════════════════════════
// 1. Core invariant: visual_estimate NEVER overwrites user quantity
// ═══════════════════════════════════════════════════════════════════
describe('visual estimate cannot overwrite user values', () => {
  it('blocks visual_estimate over user_reported quantity', () => {
    const rec = buildShelfRecord();
    const res = rec.updatePartField('screws_A', 'quantity', 5, 'visual_estimate', ['panel2_image']);
    assert.equal(res.updated, false);
    assert.equal(res.blocked, true);
    assert.match(res.reason, /visual_estimate cannot overwrite user_reported/);
    // Value unchanged
    assert.equal(rec.getPart('screws_A').quantity.value, 4);
  });

  it('blocks visual_estimate over user_confirmed quantity', () => {
    const rec = buildShelfRecord();
    rec.confirmPartField('screws_A', 'quantity', 4, ['user_chat']);
    const res = rec.updatePartField('screws_A', 'quantity', 5, 'visual_estimate', ['panel2_image']);
    assert.equal(res.updated, false);
    assert.equal(res.blocked, true);
    assert.equal(rec.getPart('screws_A').quantity.value, 4);
  });

  it('visual_estimate allowed on a field that was only inferred', () => {
    const rec = new PackBackRecord('vis-ok');
    rec.addPart({ partId: 'p1', name: 'thing', quantity: null, storage: null, source: 'inferred', evidence: [] });
    const res = rec.updatePartField('p1', 'quantity', 3, 'visual_estimate', ['img1']);
    assert.equal(res.updated, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Visual observations stay uncertain after user confirms other fields
// ═══════════════════════════════════════════════════════════════════
describe('visual observations remain provisional', () => {
  it('confirming quantity does not promote a visual_estimate on another field', () => {
    const rec = new PackBackRecord('vis-prov');
    rec.addPart({ partId: 'p1', name: 'screws', quantity: null, storage: null, linkedStep: null, source: 'inferred', evidence: [] });
    // Set storage via visual estimate
    rec.updatePartField('p1', 'storage', 'Bag X', 'visual_estimate', ['img']);
    // Confirm quantity via user
    rec.confirmPartField('p1', 'quantity', 4, ['chat']);
    // Storage should still be visual_estimate, not promoted
    assert.equal(rec.getPart('p1').storage.source, 'visual_estimate');
    assert.equal(rec.getPart('p1').quantity.source, 'user_confirmed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Conflict tracking - unresolved until explicit correction
// ═══════════════════════════════════════════════════════════════════
describe('conflict management', () => {
  it('registers a conflict between user reports', () => {
    const rec = buildShelfRecord();
    // User said 6 in panel2 note but 4 in panel5 summary
    const c = rec.addConflict({
      conflictId: 'screws_A_count',
      fieldPath: 'parts.screws_A.quantity',
      reports: [
        { value: 6, source: 'user_reported', evidence: ['note_2'] },
        { value: 4, source: 'user_reported', evidence: ['note_5'] },
      ],
    });
    assert.equal(c.status, 'unresolved');
    assert.equal(rec.getUnresolvedConflicts().length, 1);
  });

  it('resolving a conflict updates part field with user_confirmed', () => {
    const rec = buildShelfRecord();
    // Same-rank different-value now auto-registers a conflict instead of overwriting
    const upd = rec.updatePartField('screws_A', 'quantity', 6, 'user_reported', ['note_2'], 'initial report');
    assert.equal(upd.conflict, true, 'should auto-register conflict');
    // Field stays at 4; auto-conflict created
    assert.equal(rec.getPart('screws_A').quantity.value, 4);

    // Also add a manual conflict for this test
    rec.addConflict({
      conflictId: 'screws_A_count',
      fieldPath: 'parts.screws_A.quantity',
      reports: [
        { value: 4, source: 'user_reported', evidence: ['panel2', 'note_2'] },
        { value: 6, source: 'user_reported', evidence: ['note_2'] },
      ],
    });
    // Resolve the manual conflict
    rec.resolveConflict('screws_A_count', {
      resolvedValue: 4,
      reason: 'User explicitly corrected: A봉투는 4개입니다',
      evidence: ['user_correction_chat'],
    });

    const part = rec.getPart('screws_A');
    assert.equal(part.quantity.value, 4);
    assert.equal(part.quantity.source, 'user_confirmed');
    // History preserved: should contain the old user_reported value
    assert.ok(part.quantity.history.some(h => h.previousValue === 4 && h.previousSource === 'user_reported'));
  });

  it('conflicting user reports stay unresolved - no auto-pick', () => {
    const rec = buildShelfRecord();
    rec.addConflict({
      conflictId: 'c1',
      fieldPath: 'parts.screws_A.quantity',
      reports: [
        { value: 6, source: 'user_reported', evidence: ['note_2'] },
        { value: 4, source: 'user_reported', evidence: ['note_5'] },
      ],
    });
    // Without explicit resolution, conflict stays
    assert.equal(rec.getUnresolvedConflicts().length, 1);
    const summary = rec.toReassemblySummary();
    const partSummary = summary.parts.find(p => p.partId === 'screws_A');
    assert.equal(partSummary.hasUnresolvedConflict, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. History preservation on every update (including previousEvidence)
// ═══════════════════════════════════════════════════════════════════
describe('history preservation', () => {
  it('confirmed overwrite preserves previousValue, previousSource, AND previousEvidence', () => {
    const rec = buildShelfRecord();
    // screws_A was created with evidence ['panel2', 'note_2']
    rec.confirmPartField('screws_A', 'quantity', 4, ['user_chat']);
    const hist = rec.getPart('screws_A').quantity.history;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].previousValue, 4);
    assert.equal(hist[0].previousSource, 'user_reported');
    assert.deepEqual(hist[0].previousEvidence, ['panel2', 'note_2']);
    assert.ok(hist[0].timestamp);
  });

  it('multiple updates build a complete audit trail with evidence', () => {
    const rec = new PackBackRecord('hist-multi');
    rec.addPart({ partId: 'x', name: 'x', quantity: 1, storage: 'A', source: 'inferred', evidence: ['e0'] });
    // inferred → visual_estimate
    rec.updatePartField('x', 'quantity', 2, 'visual_estimate', ['e1'], 'saw it');
    // visual_estimate → user_confirmed
    rec.updatePartField('x', 'quantity', 3, 'user_confirmed', ['e2'], 'user said');
    const hist = rec.getPart('x').quantity.history;
    assert.equal(hist.length, 2);
    assert.deepEqual(hist[0].previousEvidence, ['e0']);
    assert.deepEqual(hist[1].previousEvidence, ['e1']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Missing data is null, not zero or inferred
// ═══════════════════════════════════════════════════════════════════
describe('missing data handling', () => {
  it('missing-info case: unspecified bag and quantity are null', () => {
    const rec = new PackBackRecord('missing-test');
    rec.addStep({ action: 'removed_upper_shelf', source: 'user_reported', evidence: ['panel3'] });
    rec.addPart({ partId: 'screws_B', name: 'upper shelf screws', quantity: null, storage: null, linkedStep: 2, source: 'user_reported', evidence: ['panel3'] });
    const missing = rec.getMissingFields();
    assert.ok(missing.some(m => m.partId === 'screws_B' && m.field === 'quantity'));
    assert.ok(missing.some(m => m.partId === 'screws_B' && m.field === 'storage'));
    assert.equal(rec.getPart('screws_B').quantity.value, null);
    assert.equal(rec.getPart('screws_B').storage.value, null);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Reassembly summary - safe is always false
// ═══════════════════════════════════════════════════════════════════
describe('reassembly summary', () => {
  it('safe is always false', () => {
    const rec = buildShelfRecord();
    // Confirm every part
    rec.confirmPartField('screws_A', 'quantity', 4, ['chat']);
    rec.confirmPartField('screws_B', 'quantity', 4, ['chat']);
    rec.confirmPartField('screws_C', 'quantity', 4, ['chat']);
    const summary = rec.toReassemblySummary();
    assert.equal(summary.safe, false);
  });

  it('marks non-confirmed quantities', () => {
    const rec = buildShelfRecord();
    const summary = rec.toReassemblySummary();
    // All are user_reported, not user_confirmed
    for (const p of summary.parts) {
      assert.equal(p.quantityIsConfirmed, false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Ambiguous confirmation - requires explicit field target
// ═══════════════════════════════════════════════════════════════════
describe('ambiguous confirmation rejected', () => {
  it('throws when partId is missing', () => {
    const rec = buildShelfRecord();
    assert.throws(
      () => rec.confirmPartField(null, 'quantity', 4, ['chat']),
      /requires explicit partId and fieldName/
    );
  });

  it('throws when fieldName is missing', () => {
    const rec = buildShelfRecord();
    assert.throws(
      () => rec.confirmPartField('screws_A', null, 4, ['chat']),
      /requires explicit partId and fieldName/
    );
  });

  it('throws when both are missing', () => {
    const rec = buildShelfRecord();
    assert.throws(
      () => rec.confirmPartField(null, null, 4, ['chat']),
      /requires explicit partId and fieldName/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Tentative statement stays user_reported, not confirmed
// ═══════════════════════════════════════════════════════════════════
describe('tentative statements', () => {
  it('"4개일 거예요" stays user_reported with tentative flag', () => {
    const rec = buildShelfRecord();
    const res = rec.confirmPartField('screws_A', 'quantity', 4, ['chat'], { tentative: true });
    assert.equal(res.updated, true);
    assert.equal(rec.getPart('screws_A').quantity.source, 'user_reported');
    assert.notEqual(rec.getPart('screws_A').quantity.source, 'user_confirmed');
  });

  it('tentative followed by explicit confirmation upgrades to confirmed', () => {
    const rec = buildShelfRecord();
    rec.confirmPartField('screws_A', 'quantity', 4, ['chat'], { tentative: true });
    assert.equal(rec.getPart('screws_A').quantity.source, 'user_reported');
    rec.confirmPartField('screws_A', 'quantity', 4, ['chat2'], { tentative: false });
    assert.equal(rec.getPart('screws_A').quantity.source, 'user_confirmed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Bag movement must not swap other mappings
// ═══════════════════════════════════════════════════════════════════
describe('bag movement isolation', () => {
  it('moving one part to new bag does not affect other parts', () => {
    const rec = buildShelfRecord();
    const beforeB = rec.getPart('screws_B').storage.value;
    const beforeC = rec.getPart('screws_C').storage.value;

    const { result, touchedPartIds } = rec.movePartStorage('screws_A', 'Bag D', ['user_chat'], 'relabelled');
    assert.equal(result.updated, true);
    assert.deepEqual(touchedPartIds, ['screws_A']);
    assert.equal(rec.getPart('screws_A').storage.value, 'Bag D');
    // Other parts unchanged
    assert.equal(rec.getPart('screws_B').storage.value, beforeB);
    assert.equal(rec.getPart('screws_C').storage.value, beforeC);
  });

  it('history records the old bag after move', () => {
    const rec = buildShelfRecord();
    rec.movePartStorage('screws_A', 'Bag D', ['user_chat'], 'relabelled');
    const hist = rec.getPart('screws_A').storage.history;
    assert.equal(hist.length, 1);
    assert.equal(hist[0].previousValue, 'Bag A');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Source rank enforcement
// ═══════════════════════════════════════════════════════════════════
describe('source rank enforcement', () => {
  it('inferred cannot overwrite user_reported', () => {
    const rec = buildShelfRecord();
    const res = rec.updatePartField('screws_A', 'quantity', 99, 'inferred', ['guess']);
    assert.equal(res.updated, false);
    assert.equal(res.blocked, true);
  });

  it('user_confirmed can overwrite user_reported', () => {
    const rec = buildShelfRecord();
    const res = rec.updatePartField('screws_A', 'quantity', 5, 'user_confirmed', ['chat']);
    assert.equal(res.updated, true);
    assert.equal(rec.getPart('screws_A').quantity.value, 5);
    assert.equal(rec.getPart('screws_A').quantity.source, 'user_confirmed');
  });

  it('same-value same-source same-rank is idempotent (no conflict)', () => {
    const rec = buildShelfRecord(); // screws_A qty=4, user_reported
    const res = rec.updatePartField('screws_A', 'quantity', 4, 'user_reported', ['note_5']);
    // Same value → proceeds as re-confirmation, not conflict
    assert.equal(res.updated, true);
    assert.equal(res.conflict, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Serialisation roundtrip
// ═══════════════════════════════════════════════════════════════════
describe('JSON serialisation', () => {
  it('roundtrips without data loss', () => {
    const rec = buildShelfRecord();
    rec.confirmPartField('screws_A', 'quantity', 4, ['chat']);
    rec.addConflict({
      conflictId: 'c1',
      fieldPath: 'parts.screws_B.quantity',
      reports: [
        { value: 4, source: 'user_reported', evidence: ['note_3'] },
        { value: 3, source: 'visual_estimate', evidence: ['img'] },
      ],
    });
    const json = rec.toJSON();
    const rec2 = PackBackRecord.fromJSON(json);
    const json2 = rec2.toJSON();
    assert.deepEqual(json, json2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. Duplicate guard
// ═══════════════════════════════════════════════════════════════════
describe('duplicate guards', () => {
  it('rejects duplicate partId', () => {
    const rec = buildShelfRecord();
    assert.throws(
      () => rec.addPart({ partId: 'screws_A', name: 'dup', quantity: 1, storage: 'X', source: 'user_reported', evidence: [] }),
      /Duplicate partId/
    );
  });

  it('rejects duplicate conflictId', () => {
    const rec = buildShelfRecord();
    rec.addConflict({ conflictId: 'c1', fieldPath: 'parts.screws_A.quantity', reports: [
      { value: 4, source: 'user_reported', evidence: [] },
      { value: 5, source: 'visual_estimate', evidence: [] },
    ]});
    assert.throws(
      () => rec.addConflict({ conflictId: 'c1', fieldPath: 'parts.screws_A.quantity', reports: [
        { value: 4, source: 'user_reported', evidence: [] },
        { value: 6, source: 'visual_estimate', evidence: [] },
      ]}),
      /Duplicate conflictId/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. Invalid source rejected
// ═══════════════════════════════════════════════════════════════════
describe('invalid source rejected', () => {
  it('throws on unknown source string', () => {
    const rec = buildShelfRecord();
    assert.throws(
      () => rec.updatePartField('screws_A', 'quantity', 4, 'magic', ['x']),
      /Invalid source/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 14. Full scenario: gate-1 "conflict" → correction flow
// ═══════════════════════════════════════════════════════════════════
describe('gate-1 conflict → correction scenario', () => {
  it('plays through the full conflict/correction cycle', () => {
    const rec = new PackBackRecord('gate1-conflict');

    // Steps
    rec.addStep({ action: 'assembled_baseline', source: 'user_reported', evidence: ['panel1'] });
    rec.addStep({ action: 'removed_back_panel', source: 'user_reported', evidence: ['panel2'] });
    rec.addStep({ action: 'removed_upper_shelf', source: 'user_reported', evidence: ['panel3'] });
    rec.addStep({ action: 'removed_lower_shelf', source: 'user_reported', evidence: ['panel4'] });

    // Panel 2 note says 6 screws in A
    rec.addPart({ partId: 'screws_A', name: 'back panel screws', quantity: 6, storage: 'Bag A', linkedStep: 1, source: 'user_reported', evidence: ['note_2'] });
    // Panel 5 summary says A=4 each → conflict
    rec.addConflict({
      conflictId: 'A_count_conflict',
      fieldPath: 'parts.screws_A.quantity',
      reports: [
        { value: 6, source: 'user_reported', evidence: ['note_2'] },
        { value: 4, source: 'user_reported', evidence: ['note_5'] },
      ],
    });

    // Unresolved at this point
    assert.equal(rec.getUnresolvedConflicts().length, 1);
    const sum1 = rec.toReassemblySummary();
    assert.equal(sum1.safe, false);
    assert.equal(sum1.parts.find(p => p.partId === 'screws_A').hasUnresolvedConflict, true);

    // User correction: "A봉투는 6개가 아니라 4개입니다"
    rec.resolveConflict('A_count_conflict', {
      resolvedValue: 4,
      reason: 'User explicitly corrected: A봉투는 4개입니다',
      evidence: ['user_correction'],
    });

    const part = rec.getPart('screws_A');
    assert.equal(part.quantity.value, 4);
    assert.equal(part.quantity.source, 'user_confirmed');
    // History has the original 6 WITH its evidence preserved
    const h6 = part.quantity.history.find(h => h.previousValue === 6);
    assert.ok(h6);
    assert.deepEqual(h6.previousEvidence, ['note_2']);
    assert.equal(rec.getUnresolvedConflicts().length, 0);

    // Still not safe
    const sum2 = rec.toReassemblySummary();
    assert.equal(sum2.safe, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 15. REGRESSION: same-rank user_reported with different value → auto-conflict
// ═══════════════════════════════════════════════════════════════════
describe('same-rank user_reported auto-conflict (regression)', () => {
  it('different value at same rank blocks and auto-registers conflict', () => {
    const rec = buildShelfRecord(); // screws_A qty=4, user_reported
    const res = rec.updatePartField('screws_A', 'quantity', 6, 'user_reported', ['note_5']);
    assert.equal(res.updated, false);
    assert.equal(res.blocked, true);
    assert.equal(res.conflict, true);
    assert.ok(res.autoConflictId, 'should have autoConflictId');
    // Field unchanged
    assert.equal(rec.getPart('screws_A').quantity.value, 4);
    // Conflict auto-registered
    const conflicts = rec.getUnresolvedConflicts();
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].conflictId, res.autoConflictId);
    assert.equal(conflicts[0].reports[0].value, 4);
    assert.equal(conflicts[0].reports[1].value, 6);
  });

  it('auto-conflict preserves evidence from both sides', () => {
    const rec = buildShelfRecord();
    const res = rec.updatePartField('screws_A', 'quantity', 6, 'user_reported', ['note_5']);
    const conflict = rec.getUnresolvedConflicts()[0];
    assert.deepEqual(conflict.reports[0].evidence, ['panel2', 'note_2']); // existing
    assert.deepEqual(conflict.reports[1].evidence, ['note_5']); // incoming
  });

  it('visual_estimate vs visual_estimate also triggers auto-conflict', () => {
    const rec = new PackBackRecord('vis-vs-vis');
    rec.addPart({ partId: 'p1', name: 'x', quantity: null, storage: null, source: 'inferred', evidence: [] });
    rec.updatePartField('p1', 'quantity', 3, 'visual_estimate', ['img1']);
    const res = rec.updatePartField('p1', 'quantity', 5, 'visual_estimate', ['img2']);
    assert.equal(res.conflict, true);
    assert.equal(rec.getPart('p1').quantity.value, 3); // unchanged
  });

  it('user_confirmed resolves auto-conflict via resolveConflict', () => {
    const rec = buildShelfRecord();
    const res = rec.updatePartField('screws_A', 'quantity', 6, 'user_reported', ['note_5']);
    rec.resolveConflict(res.autoConflictId, {
      resolvedValue: 4,
      reason: 'user counted again',
      evidence: ['chat'],
    });
    assert.equal(rec.getPart('screws_A').quantity.value, 4);
    assert.equal(rec.getPart('screws_A').quantity.source, 'user_confirmed');
    assert.equal(rec.getUnresolvedConflicts().length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 16. REGRESSION: resolveConflict rejects unsupported fieldPath
// ═══════════════════════════════════════════════════════════════════
describe('resolveConflict fieldPath validation (regression)', () => {
  it('rejects fieldPath with wrong prefix', () => {
    const rec = buildShelfRecord();
    rec.addConflict({
      conflictId: 'bad1',
      fieldPath: 'steps.0.action',
      reports: [
        { value: 'a', source: 'user_reported', evidence: [] },
        { value: 'b', source: 'user_reported', evidence: [] },
      ],
    });
    assert.throws(
      () => rec.resolveConflict('bad1', { resolvedValue: 'a', reason: 'fix', evidence: [] }),
      /Unsupported fieldPath/
    );
  });

  it('rejects fieldPath with too many segments', () => {
    const rec = buildShelfRecord();
    rec.addConflict({
      conflictId: 'bad2',
      fieldPath: 'parts.screws_A.quantity.value',
      reports: [
        { value: 4, source: 'user_reported', evidence: [] },
        { value: 5, source: 'user_reported', evidence: [] },
      ],
    });
    assert.throws(
      () => rec.resolveConflict('bad2', { resolvedValue: 4, reason: 'fix', evidence: [] }),
      /Unsupported fieldPath/
    );
  });

  it('rejects fieldPath pointing to non-existent part', () => {
    const rec = buildShelfRecord();
    rec.addConflict({
      conflictId: 'bad3',
      fieldPath: 'parts.nonexistent.quantity',
      reports: [
        { value: 4, source: 'user_reported', evidence: [] },
        { value: 5, source: 'user_reported', evidence: [] },
      ],
    });
    assert.throws(
      () => rec.resolveConflict('bad3', { resolvedValue: 4, reason: 'fix', evidence: [] }),
      /not found in record/
    );
  });

  it('rejects fieldPath pointing to non-existent field on part', () => {
    const rec = buildShelfRecord();
    rec.addConflict({
      conflictId: 'bad4',
      fieldPath: 'parts.screws_A.color',
      reports: [
        { value: 'red', source: 'user_reported', evidence: [] },
        { value: 'blue', source: 'user_reported', evidence: [] },
      ],
    });
    assert.throws(
      () => rec.resolveConflict('bad4', { resolvedValue: 'red', reason: 'fix', evidence: [] }),
      /not found on part/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 17. REGRESSION: fromJSON trust limitations
// ═══════════════════════════════════════════════════════════════════
describe('fromJSON trust limitations', () => {
  it('loads arbitrary JSON without runtime validation (documented risk)', () => {
    // This test documents the limitation: fromJSON does NOT reject bad data.
    const bad = {
      version: 'packback-record-v2',
      sessionId: 'bad',
      metadata: { createdAt: 'x', updatedAt: 'x' },
      steps: [],
      parts: [{
        partId: 'p1',
        name: { value: 'screws', source: 'INVALID_SOURCE', evidence: 'not-an-array', history: [] },
        quantity: { value: 4, source: 'user_reported', evidence: [], history: [] },
        storage: { value: null, source: 'inferred', evidence: [], history: [] },
        linkedStep: { value: null, source: 'inferred', evidence: [], history: [] },
      }],
      conflicts: [],
    };
    // fromJSON accepts it (documented: no runtime validation)
    const rec = PackBackRecord.fromJSON(bad);
    assert.equal(rec.getPart('p1').name.source, 'INVALID_SOURCE');
    // But updatePartField would catch the bad source on next write
    assert.throws(
      () => rec.updatePartField('p1', 'name', 'bolts', 'INVALID_SOURCE', []),
      /Invalid source/
    );
  });
});
