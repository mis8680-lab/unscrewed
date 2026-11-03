import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.mjs';
import { crossCheckAndDerive, deriveNoteQuantities } from '../lib/live-meta.mjs';

const require = createRequire(import.meta.url);
const { encodeWav16 } = require('../public/voice.js');
const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const rules = new Function('structuredClone', `${read('sample-data.js')}
return { bagLettersFromNotes, validateMetaImport, observationHasFastenerCount, sanitizeObservations, notesMentionFasteners, crossCheckAndDerive, deriveNoteQuantities, noteSupportsQuantity, quantitiesInNote, numberFromToken, UNLABELED_BAGS_MESSAGE };`)(structuredClone);
const persist = new Function(`${read('persist.js')}\nreturn { persistState, isRestorableResult, PHOTOS_TOO_LARGE_MESSAGE };`)();
const notesOf = (arr) => arr.map((note, i) => ({ panel: i + 1, note }));
const appSrc = read('app.js');

const KEY = 'test-key-bugfix';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
async function withServer(opts, fn) {
  const srv = createServer(createApp(opts));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base, srv.address().port); } finally { await new Promise(r => srv.close(r)); }
}
const wavOf = (seconds, rate = 24000) => Buffer.from(encodeWav16(new Float32Array(Math.round(seconds * rate)).fill(0.1), rate));
const postAudio = (base, body) => fetch(base + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Unscrewed': '1' }, body });
const asr = () => { const calls = []; return { calls, fetchImpl: async (u, i) => { calls.push(u); return json({ transcript: 'ok' }); } }; };

// Minimal validated import shape for one or more bags.
const imp = (bags) => ({ safety_verified: false, bags: bags.map(([id, value, ev]) => ({ id, reported_quantities: value == null ? [] : [{ value, evidence: ev }], step: null, evidence: [], confirmed_quantity: null })), questions: [], visual_limitations: [] });
const check = (raw, notes) => { const v = rules.validateMetaImport(raw, { expectedBags: rules.bagLettersFromNotes(notes), stepCount: notes.length }); assert.ok(v.valid, v.error); return rules.crossCheckAndDerive(v, notes); };

describe('P1: Add step keeps the list and the numbering aligned', () => {
  it('adding a step re-renders, then focuses and scrolls to the new step note', () => {
    const add = appSrc.slice(appSrc.indexOf("$('#btn-add-step').addEventListener"), appSrc.indexOf('function removeStep'));
    assert.match(add, /state\.customSteps\.push\(\{ note: '', image: null \}\)/);
    assert.match(add, /renderInput\(\);\s*focusStepNote\(state\.customSteps\.length\)/);
    assert.match(appSrc, /function focusStepNote[\s\S]*?scrollIntoView/);
    assert.doesNotMatch(add, /goToStep/);
  });
  it('syncNotesToState keeps notes and photos by position, so a middle removal stays aligned', () => {
    const sync = appSrc.slice(appSrc.indexOf('function syncNotesToState'), appSrc.indexOf('function imageSignature'));
    assert.match(sync, /image: \(state\.customSteps\[i\] \|\| \{\}\)\.image \|\| null/);
    const rm = appSrc.slice(appSrc.indexOf('function removeStep'), appSrc.indexOf('// Downscale big photos'));
    assert.ok(rm.indexOf('syncNotesToState()') < rm.indexOf('splice(n - 1, 1)'));
    assert.match(rm, /focusStepNote\(/);
  });
});

describe('P2: mic state follows /api/status', () => {
  it('the off text is cleared when voice is on and never shown before status is known', () => {
    assert.match(appSrc, /voiceChecked && !voiceAvailable \? esc\(VOICE_OFF_TEXT\) : ''/);
    const fn = appSrc.slice(appSrc.indexOf('function syncVoiceUi'), appSrc.indexOf('function setVoiceStatus'));
    assert.match(fn, /el\.textContent === VOICE_OFF_TEXT\) el\.textContent = ''/);
    assert.match(fn, /b\.disabled = !voiceAvailable/);
    const init = appSrc.slice(appSrc.indexOf('async function initLiveStatus'), appSrc.indexOf('function toImportShape'));
    assert.match(init, /voiceChecked = true;[\s\S]*syncVoiceUi\(\)/);
    assert.doesNotMatch(init, /el\.textContent = VOICE_OFF_TEXT/);
  });
});

describe('G1: zero bags and bag letter spellings', () => {
  it('put-back gates all require at least one bag', () => {
    assert.equal((appSrc.match(/hasBags/g) || []).length >= 12, true);
    assert.match(appSrc, /btn\.disabled = !\(hasBags && allQtyConfirmed/);
    assert.match(appSrc, /const allConfirmed = hasBags && summary\.parts\.every/);
    assert.match(appSrc, /if \(!hasBags\) \{ toast\(/);
    assert.doesNotMatch(appSrc, /Your notes mention no bags, so there is nothing to count/);
  });
  it('bag letters are found case-insensitively in every spelling', () => {
    const f = (t) => rules.bagLettersFromNotes(notesOf([t]));
    assert.deepEqual(f('BAG A'), ['A']);
    assert.deepEqual(f('bagA'), ['A']);
    assert.deepEqual(f('bag-A'), ['A']);
    assert.deepEqual(f('bag #A'), ['A']);
    assert.deepEqual(f('Bag #B'), ['B']);
    assert.deepEqual(f('bags A/B/C'), ['A', 'B', 'C']);
    assert.deepEqual(f('BAGS A, B and C'), ['A', 'B', 'C']);
    assert.deepEqual(f('a bag a day'), []);
    assert.deepEqual(f('bag Apple'), []);
    assert.deepEqual(f('bag I'), []);
  });
  it('fasteners without a bag letter are detected', () => {
    assert.equal(rules.notesMentionFasteners(notesOf(['Put 4 screws away.'])), true);
    assert.equal(rules.notesMentionFasteners(notesOf(['Removed the fasteners'])), true);
    assert.equal(rules.notesMentionFasteners(notesOf(['Removed the shelf.'])), false);
  });
  it('live extraction is blocked, with no model call, when screws are mentioned but no bag is labeled', async () => {
    const calls = [];
    await withServer({ fetch: async (u) => { calls.push(String(u)); return json({}); }, env: { META_API_KEY: KEY } }, async (base) => {
      const r = await fetch(base + '/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unscrewed': '1' }, body: JSON.stringify({ notes: notesOf(['Took off the lid. Put 4 screws in a bag.', 'Removed the shelf.']) }) });
      assert.equal(r.status, 400);
      const j = await r.json();
      assert.equal(j.error.code, 'bags_unlabeled');
      assert.match(j.error.message, /letters A to H/);
    });
    assert.deepEqual(calls, []);
    assert.match(appSrc, /notesMentionFasteners\(notes\)\) \{ setLiveStatus\(UNLABELED_BAGS_MESSAGE, true\)/);
  });
});

describe('G2: pasted JSON gets the same cross-check', () => {
  const notes = notesOf(['Removed the back panel. Put 4 screws in bag A.', 'Removed the shelf.']);
  it('the paste handler runs crossCheckAndDerive', () => {
    const paste = appSrc.slice(appSrc.indexOf("$('#btn-json-import')"), appSrc.indexOf("$('#btn-back-input')"));
    assert.match(paste, /crossCheckAndDerive\(validated, pasteNotes\)/);
    assert.ok(paste.indexOf('crossCheckAndDerive') < paste.indexOf('state.extractionResult = validated'));
  });
  it('rejects evidence step99', () => {
    assert.throws(() => check(imp([['A', 4, 'step99']]), notes), /not supported/);
  });
  it('rejects 40 when the cited note says 4', () => {
    assert.throws(() => check(imp([['A', 40, 'step1']]), notes), /not supported/);
  });
  it('accepts a supported quantity and normalizes panelN to stepN', () => {
    const v = check(imp([['A', 4, 'panel1']]), notes);
    assert.deepEqual(v.bags[0].reports[0].evidence, ['step1']);
  });
  it('the server and the browser use one implementation', () => {
    assert.equal(deriveNoteQuantities(notes).A.get(4)[0], 1);
    assert.throws(() => crossCheckAndDerive(check(imp([['A', 4, 'step1']]), notes) && { bags: [{ id: 'A', reports: [{ value: 9, evidence: ['step1'] }], evidence: [] }] }, notes), (e) => e.status === 502 && e.detail === 'unsupported_quantity');
  });
});

describe('G3: quantity support needs a fastener or bag quantifier', () => {
  const q = (t) => [...rules.quantitiesInNote(t)].sort((a, b) => a - b);
  it('size tokens and step, shelf, panel, part numbers never support a quantity', () => {
    assert.deepEqual(q('Used M4 screws from bag A'), []);
    assert.deepEqual(q('M3.5 screws in bag A'), []);
    assert.deepEqual(q('#8 screws in bag A'), []);
    assert.deepEqual(q('4mm screws, 30 mm long, bag A'), []);
    assert.deepEqual(q('step 4: removed screws into bag A'), []);
    assert.deepEqual(q('Removed shelf 4 and panel 4, part 4. Screws in bag A.'), []);
    assert.equal(rules.noteSupportsQuantity('Removed shelf 4. Screws in bag A.', 4), false);
  });
  it('real quantities are found, with digits and with words', () => {
    assert.deepEqual(q('Put 4 screws in bag A.'), [4]);
    assert.deepEqual(q('Put four small screws in bag A.'), [4]);
    assert.deepEqual(q('Bag A holds 6.'), [6]);
    assert.deepEqual(q('Put 5 in bag A.'), [5]);
    assert.deepEqual(q('bag A: 7'), [7]);
    assert.deepEqual(q('Put 4 M4 screws in bag A.'), [4]);
    assert.deepEqual(q('Shelf 4 and 6 screws in bag A.'), [6]);
  });
  it('compound number words work up to ninety-nine', () => {
    assert.deepEqual(q('Put twenty-four screws in bag A.'), [24]);
    assert.deepEqual(q('Put twenty four screws in bag A.'), [24]);
    assert.deepEqual(q('Put ninety-nine screws in bag A.'), [99]);
    assert.deepEqual(q('Put thirty screws in bag A.'), [30]);
    assert.deepEqual(q('Put forty screws in bag A.'), [40]);
    assert.equal(rules.numberFromToken('Seventy-Three'), 73);
    assert.ok(Number.isNaN(rules.numberFromToken('twenty-twenty')));
  });
  it('deriveNoteQuantities applies the same rules', () => {
    const d = deriveNoteQuantities(notesOf(['Bag A: shelf 4 removed. Put twenty-four screws in bag A.', 'Shelf 9. M5 screws in bag B.']));
    assert.deepEqual([...d.A.keys()], [24]);
    assert.equal(d.B, undefined);
  });
  it('a claim backed only by a shelf number is rejected by the cross-check', () => {
    const notes = notesOf(['Removed shelf 4. Screws in bag A.', 'Done.']);
    assert.throws(() => check(imp([['A', 4, 'step1']]), notes), /not supported/);
  });
});

describe('G4: vague and alternate fastener counts are filtered', () => {
  const bad = (t) => assert.equal(rules.observationHasFastenerCount(t), true, t);
  const ok = (t) => assert.equal(rules.observationHasFastenerCount(t), false, t);
  it('blocks vague quantities next to fastener words', () => {
    ['A few screws sit in the tray.', 'Several bolts are visible.', 'Many screws on the floor.', 'A handful of screws in a bag.', 'Lots of screws on the left.', 'Numerous washers lie nearby.', 'Some screws are out of the bag.'].forEach(bad);
  });
  it('blocks fullwidth digits and roman numerals', () => {
    bad('\uff14 screws are on the shelf.');
    bad('The tray holds \uff16 bolts.');
    bad('There are iv screws near the lid.');
    bad('Screws: xii in the bag.');
  });
  it('still allows plain descriptions and step references', () => {
    ok('The upper shelf is lifted out.');
    ok('In step 3 the screws are out of frame.');
    ok('A label reading A is on the zip bag.');
  });
  it('questions and visual_limitations pass through the same filter', () => {
    const raw = { ...imp([['A', 4, 'step1']]), questions: ['Is it true that 4 screws are in bag A?', 'Several screws look loose, are they counted?', 'Which bag holds the washers?'], visual_limitations: ['Many screws overlap in the photo.', 'The photo is dark.'] };
    const v = rules.validateMetaImport(raw, { stepCount: 2 });
    assert.deepEqual(v.questions, ['Which bag holds the washers?']);
    assert.deepEqual(v.visual_limitations, ['The photo is dark.']);
  });
  it('"how many" in a question is not a count, and saved samples keep their text', () => {
    const v = rules.validateMetaImport({ ...imp([['A', 4, 'step1']]), questions: ['How many screws were put in bag B?'] }, { stepCount: 2 });
    assert.equal(v.questions.length, 1);
    const t = rules.validateMetaImport({ ...imp([['A', 4, 'step1']]), questions: ['Confirm 4 screws in bag A?'] }, { stepCount: 2, trustedSample: true });
    assert.equal(t.questions.length, 1);
  });
});

describe('G5: quota failure keeps the result and drops only photos', () => {
  const full = () => ({ mode: 'custom', customSteps: [{ note: 'n1', image: 'data:image/png;base64,AAAA' }, { note: 'n2', image: null }], extractionResult: { valid: true, bags: [{ id: 'A' }] }, extractionMeta: { mode: 'live', model: 'm' }, extractionInputHash: 'h', actionLog: [{ a: 1 }] });
  const store = (failWhen) => { const writes = []; return { writes, setItem(k, v) { if (failWhen(v, writes.length)) throw new Error('QuotaExceededError'); writes.push(JSON.parse(v)); } }; };
  it('first write ok: nothing dropped, no message', () => {
    const s = store(() => false);
    const r = persist.persistState(s, 'k', full());
    assert.equal(r.saved, 'full'); assert.equal(r.message, null);
  });
  it('quota on photos: result, meta, hash and log survive; photos are dropped; message is set', () => {
    const s = store((v) => v.includes('data:image'));
    const r = persist.persistState(s, 'k', full());
    assert.equal(r.saved, 'without_photos');
    assert.equal(r.message, 'Photos are too large to keep after a reload. Your notes and record are saved.');
    const w = s.writes[0];
    assert.deepEqual(w.extractionResult, { valid: true, bags: [{ id: 'A' }] });
    assert.equal(w.extractionMeta.model, 'm'); assert.equal(w.extractionInputHash, 'h'); assert.equal(w.actionLog.length, 1);
    assert.deepEqual(w.customSteps.map(x => x.image), [null, null]);
    assert.deepEqual(w.customSteps.map(x => x.note), ['n1', 'n2']);
  });
  it('second write also fails: the same message is still surfaced, nothing throws', () => {
    const r = persist.persistState(store(() => true), 'k', full());
    assert.equal(r.saved, 'none'); assert.equal(r.message, persist.PHOTOS_TOO_LARGE_MESSAGE);
  });
  it('the app shows the message without blocking and clears it after a good save', () => {
    assert.match(appSrc, /showStorageNote\(outcome\.message\)/);
    assert.match(appSrc, /if \(!outcome\.message\) \{ storageWarned = false; hideStorageNote\(\); \}/);
    assert.match(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /id="storage-note" role="status" hidden/);
  });
});

describe('Hardening', () => {
  it('invalid WAV does not spend a voice rate-limit slot', async () => {
    const m = asr();
    await withServer({ fetch: m.fetchImpl, env: { META_API_KEY: KEY } }, async (base) => {
      for (let i = 0; i < 25; i++) assert.equal((await postAudio(base, Buffer.from('not audio at all '.repeat(10)))).status, 415);
      for (let i = 0; i < 20; i++) assert.equal((await postAudio(base, wavOf(0.2))).status, 200);
      assert.equal((await postAudio(base, wavOf(0.2))).status, 429);
    });
  });
  it('/api/transcribe answers 403 before reading the body', async () => {
    await withServer({ fetch: asr().fetchImpl, env: { META_API_KEY: KEY }, bodyDeadlineMs: 5000 }, async (base, port) => {
      const t0 = Date.now();
      const status = await new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, path: '/api/transcribe', method: 'POST', headers: { 'Content-Type': 'audio/wav', 'Content-Length': '100000' } }, (res) => { res.resume(); resolve(res.statusCode); req.destroy(); });
        req.on('error', reject);
        req.write(Buffer.alloc(10)); // headers and a sliver of body; the rest never arrives
      });
      assert.equal(status, 403);
      assert.ok(Date.now() - t0 < 2000);
    });
  });
  it('restored result bag ids are re-validated in every mode', () => {
    assert.equal(persist.isRestorableResult({ valid: true, bags: [{ id: 'A' }, { id: 'H' }] }), true);
    assert.equal(persist.isRestorableResult({ valid: true, bags: [{ id: 'I' }] }), false);
    assert.equal(persist.isRestorableResult({ valid: true, bags: [{ id: '<img src=x>' }] }), false);
    assert.equal(persist.isRestorableResult({ valid: true, bags: [{ id: 'a' }] }), false);
    assert.equal(persist.isRestorableResult({ valid: false, bags: [] }), false);
    assert.match(appSrc, /if \(!isRestorableResult\(parsed\.extractionResult\)\) parsed\.extractionResult = null/);
    assert.match(read('index.html'), /persist\.js/);
  });
  it('doConfirm enforces 1 to 999', () => {
    assert.match(appSrc, /const MAX_CONFIRM_QTY = 999/);
    assert.match(appSrc, /val < 1 \|\| val > MAX_CONFIRM_QTY/);
  });
  it('new copy has no emoji, em dash or Hangul', () => {
    for (const f of ['persist.js', 'app.js', 'sample-data.js']) assert.doesNotMatch(read(f), /[\u2014\uAC00-\uD7AF\u{1F300}-\u{1FAFF}]/u, f);
  });
});
