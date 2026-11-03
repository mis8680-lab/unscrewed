import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createApp } from '../server.mjs';
import { parseWav, ASR_KEYWORDS, MAX_AUDIO } from '../lib/live-meta.mjs';

const require = createRequire(import.meta.url);
const { encodeWav16 } = require('../public/voice.js');

const KEY = 'test-key-voice';
const wavOf = (seconds, rate = 24000) => Buffer.from(encodeWav16(new Float32Array(Math.round(seconds * rate)).fill(0.1), rate));

async function withServer(opts, fn) {
  const srv = createServer(createApp(opts));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { await new Promise(r => srv.close(r)); }
}
const postAudio = (base, body, hdrs) => fetch(base + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Unscrewed': '1', ...(hdrs || {}) }, body });

function mockAsr(transcript = 'Removed the back panel. Put four screws in bag A.') {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ sessionId: 'x', transcript, audioDurationMs: 3000, turns: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

describe('Voice: WAV encoder and header checks', () => {
  it('browser encoder output passes the server WAV check', () => {
    const info = parseWav(wavOf(2));
    assert.equal(info.sampleRate, 24000);
    assert.ok(Math.abs(info.seconds - 2) < 0.01);
  });
  it('rejects non-WAV, stereo, 8-bit, odd sample rate, truncated and over-long audio', () => {
    assert.throws(() => parseWav(Buffer.from('not a wav file at all, definitely not a wav file ....')), /RIFF/);
    const mod = (fn) => { const b = Buffer.from(wavOf(1)); fn(b); return b; };
    assert.throws(() => parseWav(mod(b => b.writeUInt16LE(2, 22))), /mono/);
    assert.throws(() => parseWav(mod(b => b.writeUInt16LE(8, 34))), /16-bit/);
    assert.throws(() => parseWav(mod(b => b.writeUInt32LE(44100, 24))), /sample rate/);
    assert.throws(() => parseWav(wavOf(1).subarray(0, 1000)), /truncated/);
    assert.throws(() => parseWav(wavOf(61)), /60 seconds/);
    assert.ok(parseWav(wavOf(60)));
  });
  it('encoder clamps samples', () => {
    const w = encodeWav16(new Float32Array([2, -2, 0]), 24000);
    const dv = new DataView(w.buffer);
    assert.equal(dv.getInt16(44, true), 32767);
    assert.equal(dv.getInt16(46, true), -32768);
  });
});

describe('Voice: POST /api/transcribe', () => {
  it('sends multipart request + audio with bearer, keywords and PUSH_TO_TALK, returns the transcript only', async () => {
    const { calls, fetchImpl } = mockAsr();
    await withServer({ fetch: fetchImpl, env: { META_API_KEY: KEY } }, async (base) => {
      const r = await postAudio(base, wavOf(1));
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.transcript, 'Removed the back panel. Put four screws in bag A.');
      assert.equal(j.model, 'muse-voice-transcribe-1.0');
      assert.ok(!JSON.stringify(j).includes(KEY));
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /^https:\/\/api\.meta\.ai\/v1\/asr\/transcribe\?sessionId=/);
      assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
      const form = calls[0].init.body;
      const reqPart = JSON.parse(await form.get('request').text());
      assert.equal(reqPart.mode, 'PUSH_TO_TALK');
      assert.equal(reqPart.model, 'muse-voice-transcribe-1.0');
      assert.equal(reqPart.audioEncoding, 'WAV');
      assert.deepEqual(reqPart.languageBias, ['English']);
      assert.deepEqual(reqPart.keywords, ASR_KEYWORDS);
      assert.equal(form.get('audio').size, wavOf(1).length);
    });
  });
  it('CSRF: missing header, wrong content type, cross-site and foreign origin are 403 and call nothing', async () => {
    const { calls, fetchImpl } = mockAsr();
    await withServer({ fetch: fetchImpl, env: { META_API_KEY: KEY } }, async (base) => {
      const w = wavOf(1);
      for (const hdrs of [{ 'X-Unscrewed': '' }, { 'Content-Type': 'application/json' }, { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://evil.example' }]) {
        const r = await fetch(base + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Unscrewed': '1', ...hdrs }, body: w });
        if (hdrs['X-Unscrewed'] === '') { assert.equal(r.status, 403); continue; }
        assert.equal(r.status, 403, JSON.stringify(hdrs));
      }
      assert.equal(calls.length, 0);
    });
  });
  it('bad WAV -> 415 bad_audio, nothing uploaded', async () => {
    const { calls, fetchImpl } = mockAsr();
    await withServer({ fetch: fetchImpl, env: { META_API_KEY: KEY } }, async (base) => {
      const r = await postAudio(base, Buffer.from('RIFFxxxxWAVEnothing-useful-here-at-all-0000000000000000'));
      assert.equal(r.status, 415);
      assert.equal((await r.json()).error.code, 'bad_audio');
      assert.equal(calls.length, 0);
    });
  });
  it('over 5 MB -> 413', async () => {
    const { calls, fetchImpl } = mockAsr();
    await withServer({ fetch: fetchImpl, env: { META_API_KEY: KEY } }, async (base) => {
      const r = await postAudio(base, Buffer.alloc(MAX_AUDIO + 10));
      assert.equal(r.status, 413);
      assert.equal(calls.length, 0);
    });
  });
  it('no key -> 503 and status reports voice off', async () => {
    await withServer({ env: {} }, async (base) => {
      assert.equal((await postAudio(base, wavOf(1))).status, 503);
      const st = await (await fetch(base + '/api/status')).json();
      assert.equal(st.voice, false);
    });
    await withServer({ env: { META_API_KEY: KEY } }, async (base) => {
      const st = await (await fetch(base + '/api/status')).json();
      assert.equal(st.voice, true);
      assert.equal(st.maxVoiceSeconds, 60);
    });
  });
  it('upstream failure and missing transcript are typed errors without leaking the key', async () => {
    const f401 = async () => new Response('nope', { status: 401 });
    const fbad = async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 });
    await withServer({ fetch: f401, env: { META_API_KEY: KEY } }, async (base) => {
      const r = await postAudio(base, wavOf(1));
      assert.equal(r.status, 502);
      assert.ok(!(await r.text()).includes(KEY));
    });
    await withServer({ fetch: fbad, env: { META_API_KEY: KEY } }, async (base) => {
      const r = await postAudio(base, wavOf(1));
      assert.equal((await r.json()).error.code, 'invalid_json');
    });
  });
  it('rate limits to 20 per minute', async () => {
    const { fetchImpl } = mockAsr();
    await withServer({ fetch: fetchImpl, env: { META_API_KEY: KEY } }, async (base) => {
      const w = wavOf(0.2);
      for (let i = 0; i < 20; i++) assert.equal((await postAudio(base, w)).status, 200);
      assert.equal((await postAudio(base, w)).status, 429);
    });
  });
  it('transcript is trimmed and capped at 500 characters', async () => {
    const { fetchImpl } = mockAsr('  ' + 'a '.repeat(600) + ' ');
    await withServer({ fetch: fetchImpl, env: { META_API_KEY: KEY } }, async (base) => {
      const j = await (await postAudio(base, wavOf(1))).json();
      assert.ok(j.transcript.length <= 500);
      assert.equal(j.transcript, j.transcript.trim());
    });
  });
});

describe('Voice: UI contract', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  it('hint text, disabled-with-reason, and untrusted-edit rule are present', () => {
    assert.ok(app.includes('Transcribed by Meta. Check it.'));
    assert.ok(app.includes('Voice notes need a Meta API key on the server.'));
    assert.ok(app.includes('e.isTrusted'));
    assert.ok(html.includes('voice.js'));
  });
  it('transcripts never confirm anything: no confirm call in the voice path', () => {
    const block = app.slice(app.indexOf('async function finishRecording'), app.indexOf('function invalidateExtraction'));
    assert.ok(!/confirmPartField|resolveConflict|user_confirmed/.test(block));
  });
  it('voice.js has no emoji or em dash', () => {
    const v = readFileSync(new URL('../public/voice.js', import.meta.url), 'utf8');
    assert.ok(!/\p{Extended_Pictographic}|\u2014/u.test(v));
  });
});
