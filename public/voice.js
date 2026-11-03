/**
 * Unscrewed: voice note helpers. Records with MediaRecorder, decodes with AudioContext,
 * resamples to 24 kHz mono with OfflineAudioContext, and writes a 16-bit PCM WAV in plain JS.
 * Loads as a browser global or via CommonJS-style module.exports (for tests).
 */
(function (root) {
  const TARGET_RATE = 24000;
  const MAX_SECONDS = 60;

  /** Float32 samples in [-1, 1] -> 16-bit PCM mono WAV bytes. */
  function encodeWav16(samples, rate) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
    }
    return new Uint8Array(buf);
  }

  async function blobToWav(blob) {
    const AC = root.AudioContext || root.webkitAudioContext;
    const ctx = new AC();
    let decoded;
    try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close(); }
    if (decoded.duration > MAX_SECONDS + 0.5) throw new Error('Voice notes are limited to ' + MAX_SECONDS + ' seconds.');
    const off = new root.OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * TARGET_RATE)), TARGET_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav16(rendered.getChannelData(0), TARGET_RATE);
  }

  /** One recorder at a time. start() resolves when the mic is live; stop() resolves with the WAV bytes. */
  function createRecorder(onAutoStop) {
    let rec = null, stream = null, chunks = [], timer = null, done = null;
    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      done = new Promise((resolve, reject) => {
        rec.onstop = async () => {
          clearTimeout(timer);
          stream.getTracks().forEach(t => t.stop());
          try { resolve(await blobToWav(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))); } catch (e) { reject(e); }
        };
        rec.onerror = () => reject(new Error('Recording failed.'));
      });
      rec.start();
      timer = setTimeout(() => { if (rec && rec.state === 'recording') { rec.stop(); if (onAutoStop) onAutoStop(); } }, MAX_SECONDS * 1000);
    }
    function stop() { if (rec && rec.state === 'recording') rec.stop(); return done; }
    return { start, stop };
  }

  const api = { encodeWav16, blobToWav, createRecorder, TARGET_RATE, MAX_SECONDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.UnscrewedVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
