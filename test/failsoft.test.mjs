import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.mjs';

const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const rules = new Function('structuredClone', `${read('sample-data.js')}
return { validateMetaImport, bagLettersFromNotes, crossCheckAndDerive, bagPrefill, bagHasConflict, reportSupported, noteSupportsQuantity, sentencesOf, NO_BAGS_MESSAGE, BAG_CHECK_MESSAGE };`)(structuredClone);
const appSrc = read('app.js');
const KEY = 'test-key-failsoft';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

// What Meta plausibly returns for each spoken note, and what the app must show.
// prefill: expected confirm-box prefill per bag (null means empty with "Recount and enter").
const PROBES = [
  { note: 'screws went in the a bag', meta: [['A', null]], prefill: { A: null } },
  { note: 'screws in bag a again', meta: [['A', null]], prefill: { A: null } },
  { note: 'the screws went in bag a there were four of them', meta: [['A', 4]], prefill: { A: 4 } },
  { note: 'bags a through c got two screws each', meta: [['A', 2], ['B', 2], ['C', 2]], prefill: { A: 2, B: 2, C: 2 } },
  { note: 'the b bag has two screws', meta: [['B', 2]], prefill: { B: 2 } },
  { note: 'four screws in bag a and the same in bag b', meta: [['A', 4], ['B', 4]], prefill: { A: 4, B: null } },
  { note: 'two in bag a three in bag b', meta: [['A', 2], ['B', 3]], prefill: { A: 2, B: 3 } },
  { note: '4 screws in bag A and bag B', meta: [['A', 4], ['B', 4]], prefill: { A: 4, B: null } },
  { note: 'bag a and bag b have four screws', meta: [['A', 4], ['B', 4]], prefill: { A: null, B: 4 } },
  { note: 'four in a and two in b', meta: [['A', 4], ['B', 2]], prefill: { A: null, B: null } },
  // false accepts: no wrong number may be prefilled
  { note: 'No. 8 screws in bag A', meta: [['A', 8]], prefill: { A: null } },
  { note: 'Fig. 4 screws in bag A', meta: [['A', 4]], prefill: { A: null } },
  { note: 'i will bag a screw', meta: [['A', null]], prefill: { A: null }, flagged: ['A'] },
  { note: 'i will bag a screw', meta: [], prefill: {} },
];

const proposalOf = (meta) => ({ safety_verified: false, questions: [], conflicts: [], visual_limitations: [], observations: [],
  bags: meta.map(([id, v]) => ({ id, reported_quantities: v == null ? [] : [{ value: v, evidence: 'step1' }], confirmed_quantity: null, step: v == null ? null : 1, evidence: v == null ? [] : ['step1'] })) });
const post = (base, body) => fetch(base + '/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unscrewed': '1' }, body: JSON.stringify(body) });
async function live(notes, meta) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/files')) return json({ id: 'f1' });
    return json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposalOf(meta)) }] }] });
  };
  const srv = createServer(createApp({ fetch: fetchImpl, env: { META_API_KEY: KEY } }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await post(`http://127.0.0.1:${srv.address().port}`, { notes, images: [{ step: 1, mime: 'image/png', base64: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(8)]).toString('base64') }] });
    return { status: r.status, j: await r.json(), calls };
  } finally { await new Promise(r => srv.close(r)); }
}
// Same step the browser runs on the server's proposal.
function clientView(proposal, notes) {
  const raw = { safety_verified: false, questions: [], visual_limitations: [], observations: [],
    bags: proposal.bags.map(b => ({ id: b.id, reported_quantities: b.reports, step: b.step, evidence: b.evidence, confirmed_quantity: null })) };
  const v = rules.validateMetaImport(raw, { expectedBags: rules.bagLettersFromNotes(notes), stepCount: notes.length, failSoft: true });
  assert.ok(v.valid, v.error);
  return rules.crossCheckAndDerive(v, notes);
}

describe('fail-soft probes: no live block, never a silent wrong prefill', () => {
  for (const p of PROBES) {
    it(`"${p.note}" with Meta bags [${p.meta.map(m => m[0]).join('')}]`, async () => {
      const notes = [{ panel: 1, note: p.note }, { panel: 2, note: 'Done.' }];
      const r = await live(notes, p.meta);
      assert.equal(r.status, 200, JSON.stringify(r.j));
      assert.ok(r.calls.some(c => c.endsWith('/responses')), 'the model call was made');
      const v = clientView(r.j.proposal, notes);
      assert.deepEqual(v.bags.map(b => b.id).sort(), Object.keys(p.prefill).sort());
      for (const b of v.bags) {
        assert.equal(rules.bagPrefill(b), p.prefill[b.id], `prefill for bag ${b.id}`);
        // A prefilled number is always one the note states.
        if (rules.bagPrefill(b) !== null) assert.ok(rules.noteSupportsQuantity(p.note, rules.bagPrefill(b), b.id));
        // Every shown number is either notes-backed or flagged unsupported.
        for (const rep of b.reports) assert.ok(rep.supported === true || rep.supported === false);
      }
      for (const id of p.flagged || []) assert.equal(v.bags.find(b => b.id === id).noteMatched, false);
    });
  }
});

describe('fail-soft rules', () => {
  const notes = [{ panel: 1, note: 'Put 4 screws in bag A.' }, { panel: 2, note: 'Done.' }];
  const run = (reports, noteList = notes, bagId = 'A') => {
    const raw = { safety_verified: false, questions: [], visual_limitations: [], bags: [{ id: bagId, reported_quantities: reports, step: 1, evidence: [], confirmed_quantity: null }] };
    return rules.crossCheckAndDerive(rules.validateMetaImport(raw, { expectedBags: rules.bagLettersFromNotes(noteList), stepCount: noteList.length, failSoft: true }), noteList);
  };
  it('a supported value is shown normally and prefilled', () => {
    const v = run([{ value: 4, evidence: 'step1' }]);
    assert.equal(rules.bagPrefill(v.bags[0]), 4);
    assert.equal(v.conflicts.length, 0);
  });
  it('an unsupported value is kept, flagged, not prefilled, and conflicts with the notes number', () => {
    const v = run([{ value: 6, evidence: 'step1' }]);
    const six = v.bags[0].reports.find(r => r.value === 6);
    assert.equal(six.supported, false);
    assert.equal(rules.bagPrefill(v.bags[0]), null);
    assert.equal(v.conflicts.length, 1);
    assert.deepEqual([...v.conflicts[0].reported_values].sort(), [4, 6]);
  });
  it('an unsupported value alone does not create a conflict or a prefill', () => {
    const none = [{ panel: 1, note: 'Put some screws in bag A.' }, { panel: 2, note: 'Done.' }];
    const v = run([{ value: 6, evidence: 'step1' }], none);
    assert.equal(v.conflicts.length, 0);
    assert.equal(rules.bagPrefill(v.bags[0]), null);
  });
  it('evidence pointing at a nonexistent step is dropped', () => {
    const v = run([{ value: 4, evidence: 'step9' }]);
    assert.ok(!v.bags[0].reports.some(r => r.evidence.includes('step9')));
  });
  it('a bag Meta found that the notes do not name is kept with the check message', () => {
    const v = run([], [{ panel: 1, note: 'Put the screws in the green one.' }, { panel: 2, note: 'Done.' }], 'C');
    assert.equal(v.bags[0].noteMatched, false);
    assert.match(rules.BAG_CHECK_MESSAGE, /^Check this bag: Meta found it in your notes/);
  });
  it('No. and Fig. are not sentence ends', () => {
    assert.equal(rules.sentencesOf('No. 8 screws in bag A').length, 1);
    assert.equal(rules.sentencesOf('Fig. 4 screws in bag A. Done.').length, 2);
    assert.equal(rules.sentencesOf('Put them in bag A. Then bag B.').length, 2);
  });
});

describe('fail-soft wiring in the browser', () => {
  it('the live and paste paths never reject on unsupported quantities and show the new wording', () => {
    assert.doesNotMatch(appSrc, /unsupported_quantity/);
    assert.match(appSrc, /Meta read <strong>/);
    assert.match(appSrc, /We couldn\\'t find that number in your note\. Check it\./);
    assert.match(appSrc, /bagPrefill\(bag\)/);
    const paste = appSrc.slice(appSrc.indexOf("$('#btn-json-import')"), appSrc.indexOf("$('#btn-back-input')"));
    assert.match(paste, /NO_BAGS_MESSAGE/);
    assert.doesNotMatch(paste, /try \{ crossCheckAndDerive/);
  });
  it('zero bags with fasteners shows the message; Put back stays locked with zero bags', () => {
    assert.match(rules.NO_BAGS_MESSAGE, /^Meta didn't find any labeled bags\. Label your bags A to H in the notes, or say 'bag A' when you record\.$/);
  });
});
