/**
 * Unscrewed MVP -- App Controller v2
 *
 * Flow: Input -> Review -> Confirm (qty + step mapping) -> Reassembly (+ History)
 *
 * localStorage persistence rules:
 *  - Persisted: scenario, mode, customSteps (notes and downscaled photos), editedNotes (if modified),
 *    extractionResult (proposal only), actionLog
 *  - NEVER persisted as confirmed: record, confirmations, stepMappings
 *  - On reload: proposals restored, confirmations require fresh UI events
 *  - record is rebuilt from extraction each time, never fromJSON from storage
 *
 * Confirmation source: UI button events only.
 * No external API calls. No fromJSON on untrusted model data.
 */
(function () {
  'use strict';

  // -- Constants -------------------------------------------------------
  const STORAGE_KEY = 'unscrewed_mvp_state';
  const MIN_STEPS_UI = 2;
  const MAX_STEPS_UI = 12;
  const IMG_DATA_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+\/=]+)$/;

  // -- State -----------------------------------------------------------
  let state = loadState();

  function defaultState() {
    return {
      currentStep: 'input',
      scenario: 'normal',
      mode: 'sample',
      customSteps: null,
      editedNotes: null,
      extractionResult: null,
      extractionInputHash: null,
      extractionMeta: null,
      actionLog: [],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return defaultState();
        delete parsed.record;
        delete parsed.confirmations;
        delete parsed.stepMappings;
        if (!['normal', 'missing', 'conflict'].includes(parsed.scenario)) {
          parsed.scenario = 'normal';
        }
        if (!['input', 'review'].includes(parsed.currentStep)) {
          parsed.currentStep = parsed.extractionResult ? 'review' : 'input';
        }
        if (parsed.mode !== 'custom') parsed.mode = 'sample';
        delete parsed.customImage;
        if (parsed.mode === 'custom') {
          const cs = parsed.customSteps;
          const ok = Array.isArray(cs) && cs.length >= 2 && cs.length <= 12 &&
            cs.every(x => x && typeof x.note === 'string' && x.note.length <= 500 && (x.image === null || (typeof x.image === 'string' && IMG_DATA_RE.test(x.image))));
          if (!ok) { parsed.mode = 'sample'; parsed.customSteps = null; }
        } else {
          parsed.customSteps = null;
        }
        if (parsed.editedNotes !== null && parsed.editedNotes !== undefined) {
          if (!Array.isArray(parsed.editedNotes) ||
              !parsed.editedNotes.every(n => typeof n === 'object' && typeof n.panel === 'number' && typeof n.note === 'string')) {
            parsed.editedNotes = null;
          }
        }
        if (parsed.extractionResult) {
          if (!parsed.extractionResult.valid || !Array.isArray(parsed.extractionResult.bags) ||
              (parsed.mode === 'custom' && !parsed.extractionResult.bags.every(b => b && typeof b.id === 'string' && /^[A-H]$/.test(b.id)))) {
            parsed.extractionResult = null;
          }
        }
        if (!parsed.extractionResult || !parsed.extractionMeta || parsed.extractionMeta.mode !== 'live' ||
            typeof parsed.extractionMeta.model !== 'string') {
          parsed.extractionMeta = null;
        }
        if (!Array.isArray(parsed.actionLog)) parsed.actionLog = [];
        return { ...defaultState(), ...parsed };
      }
    } catch { /* corrupted */ }
    return defaultState();
  }

  function saveState() {
    const persist = {
      currentStep: state.currentStep,
      scenario: state.scenario,
      mode: state.mode,
      customSteps: state.customSteps,
      editedNotes: state.editedNotes,
      extractionResult: state.extractionResult,
      extractionInputHash: state.extractionInputHash,
      extractionMeta: state.extractionMeta,
      actionLog: state.actionLog,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
    } catch {
      // Photos can exceed the browser storage quota. Keep notes and results, drop the photos.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...persist, customSteps: persist.customSteps ? persist.customSteps.map(x => ({ note: x.note, image: null })) : null, extractionResult: null, extractionMeta: null, extractionInputHash: null }));
      } catch { /* storage unavailable */ }
    }
  }

  let currentRecord = null;
  let confirmations = {};
  let stepMappings = {};

  function logAction(action, detail) {
    state.actionLog.push({ ts: new Date().toISOString(), action, detail: String(detail || '') });
    if (state.actionLog.length > 200) state.actionLog = state.actionLog.slice(-200);
    saveState();
  }

  // -- DOM refs --------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const stepsNav = $('#steps-nav');
  const sections = {
    input: $('#section-input'),
    review: $('#section-review'),
    confirm: $('#section-confirm'),
    reassembly: $('#section-reassembly'),
    history: $('#section-history'),
  };

  const _escDiv = document.createElement('div');
  function esc(str) {
    _escDiv.textContent = String(str ?? '');
    return _escDiv.innerHTML;
  }

  // Evidence ids like "panel2" are the step numbers of the photo sheet. People see "step 2".
  function evLabel(e) {
    const m = /^(?:panel|step)(\d+)$/i.exec(String(e).trim());
    return m ? 'step ' + m[1] : String(e);
  }
  function evList(arr) { return (arr || []).map(evLabel).join(', '); }
  function plainSteps(t) { return String(t).replace(/\bpanel ?(\d)\b/gi, 'step $1'); }
  function cap(t) { t = String(t); return t.charAt(0).toUpperCase() + t.slice(1); }
  const CHECK_SVG = '<svg class="check-draw" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SCENARIO_LABELS = { normal: 'Normal', missing: 'Missing bag', conflict: 'Conflicting counts' };
  const EXTRACT_LABEL = 'Build bag record from saved response';
  const LIVE_LABEL = 'Build bag record with a live Meta call';
  let lastConfirmedBag = null;

  // -- Navigation ------------------------------------------------------
  function goToStep(step) {
    state.currentStep = step;
    saveState();
    $$('.steps-nav button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.step === step);
      if (btn.dataset.step === step) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
    });
    Object.entries(sections).forEach(([key, el]) => {
      el.classList.toggle('active', key === step);
    });
    const order = ['input', 'review', 'confirm', 'reassembly', 'history'];
    const idx = order.indexOf(step);
    $$('.steps-nav button').forEach(btn => {
      const btnIdx = order.indexOf(btn.dataset.step);
      btn.disabled = btnIdx > idx + 1;
    });
    if (state.actionLog.length > 0) {
      $('[data-step="history"]').disabled = false;
    }
    if (step === 'input') renderInput();
    if (step === 'review') renderReview();
    if (step === 'confirm') renderConfirm();
    if (step === 'reassembly') renderReassembly();
    if (step === 'history') renderHistory();
  }

  stepsNav.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    goToStep(btn.dataset.step);
  });

  // -- Toast -----------------------------------------------------------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // -- Error state rendering -------------------------------------------
  function renderError(container, title, detail) {
    container.innerHTML = `
      <div class="error-state">
        <div class="error-title">${esc(title)}</div>
        <div class="error-detail">${esc(detail)}</div>
      </div>`;
  }

  // -- Step 1: Input ---------------------------------------------------
  const isCustom = () => state.mode === 'custom' && Array.isArray(state.customSteps);
  const stepThumbAlt = (n) => 'Your photo for step ' + n;

  function currentNotesModel() {
    if (isCustom()) return state.customSteps.map((st, i) => ({ panel: i + 1, note: st.note }));
    return state.editedNotes || SAMPLE_INPUTS[state.scenario || 'normal']?.notes || [];
  }

  function renderInput() {
    const scenario = state.scenario || 'normal';
    const custom = isCustom();
    const notes = currentNotesModel();
    const container = $('#notes-container');
    container.innerHTML = '';

    $('#photo-block').hidden = custom;
    $('#own-record-bar').hidden = custom;
    $('#step-edit-bar').hidden = !custom;
    $('#btn-add-step').disabled = !custom || notes.length >= MAX_STEPS_UI;
    $('#notes-hint').textContent = custom
      ? 'Two to twelve steps. Give each step one photo and one line. Say which bag the screws went in and how many.'
      : 'One line per photo. Say which bag the screws went in and how many.';
    $('#btn-extract').textContent = custom ? 'Skip to pasting a Meta response' : EXTRACT_LABEL;

    notes.forEach((n, idx) => {
      const div = document.createElement('div');
      div.className = 'panel-note' + (custom ? ' with-photo' : '');
      const img = custom ? state.customSteps[idx].image : null;
      div.innerHTML = `
        <label for="note-${esc(n.panel)}">Step ${esc(n.panel)}</label>
        <div class="step-body">
          ${custom ? `<div class="step-photo">
            ${img ? '<img class="step-thumb" src="' + esc(img) + '" alt="' + esc(stepThumbAlt(n.panel)) + '">' : '<span class="step-nophoto">No photo yet</span>'}
            <button type="button" class="btn btn-outline btn-sm" data-photo="${esc(n.panel)}">${img ? 'Change photo' : 'Add photo'}</button>
            <input type="file" accept="image/*" hidden data-photo-input="${esc(n.panel)}" aria-label="Choose a photo for step ${esc(n.panel)}">
          </div>` : ''}
          <textarea id="note-${esc(n.panel)}" data-panel="${esc(n.panel)}" rows="2" aria-describedby="voice-hint-${esc(n.panel)}">${esc(n.note)}</textarea>
          <div class="voice-row">
            <button type="button" class="btn btn-outline btn-sm mic-btn" data-mic="${esc(n.panel)}" aria-pressed="false"${voiceAvailable ? '' : ' disabled'}>Record note</button>
            ${custom ? '<button type="button" class="btn btn-quiet btn-sm" data-remove-step="' + esc(n.panel) + '"' + (notes.length <= MIN_STEPS_UI ? ' disabled' : '') + '>Remove step ' + esc(n.panel) + '</button>' : ''}
            <span class="voice-status" id="voice-status-${esc(n.panel)}" role="status" aria-live="polite">${voiceAvailable ? '' : esc(VOICE_OFF_TEXT)}</span>
          </div>
          <p class="hint voice-hint" id="voice-hint-${esc(n.panel)}"${voiceUnedited.has(n.panel) ? '' : ' hidden'}>Transcribed by Meta. Check it.</p>
        </div>
      `;
      container.appendChild(div);
    });

    container.querySelectorAll('textarea').forEach(ta => {
      ta.addEventListener('input', (e) => {
        if (e.isTrusted) {
          const p = parseInt(ta.dataset.panel, 10);
          voiceUnedited.delete(p);
          const h = document.getElementById('voice-hint-' + p);
          if (h) h.hidden = true;
        }
        syncNotesToState();
        if (state.extractionResult) {
          const currentHash = hashNotes(getCurrentNotes());
          if (currentHash !== state.extractionInputHash) {
            invalidateExtraction('You edited the notes, so the earlier result was cleared. Build the bag record again.');
          }
        }
        saveState();
      });
    });

    $$('.scenario-bar button').forEach(btn => {
      const on = !custom && btn.dataset.scenario === scenario;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Copy what is in the note boxes into state (sample edits or custom steps).
  function syncNotesToState() {
    const notes = getCurrentNotes();
    if (isCustom()) {
      state.customSteps = notes.map((n, i) => ({ note: n.note, image: (state.customSteps[i] || {}).image || null }));
    } else {
      state.editedNotes = notes;
    }
  }

  function imageSignature() {
    return isCustom() ? state.customSteps.map(x => (x.image ? x.image.length + ':' + x.image.slice(-24) : 0)) : [];
  }

  function invalidateExtraction(reason) {
    state.extractionResult = null;
    state.extractionMeta = null;
    state.extractionInputHash = null;
    currentRecord = null;
    confirmations = {};
    stepMappings = {};
    saveState();
    if (reason) toast(reason);
  }

  $('#scenario-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (isCustom() && !confirm('Go back to the sample and discard your own steps and photos?')) return;
    state.mode = 'sample';
    state.customSteps = null;
    state.scenario = btn.dataset.scenario;
    state.editedNotes = null;
    voiceUnedited.clear();
    invalidateExtraction(null);
    saveState();
    renderInput();
    logAction('scenario_changed', state.scenario);
    toast('Sample loaded: ' + btn.textContent);
  });

  function requireIdleMic() {
    if (activeMic) { toast('Stop the recording first.'); return false; }
    return true;
  }

  $('#btn-own-record').addEventListener('click', () => {
    if (!requireIdleMic()) return;
    state.mode = 'custom';
    state.customSteps = [{ note: '', image: null }, { note: '', image: null }];
    state.editedNotes = null;
    voiceUnedited.clear();
    invalidateExtraction(null);
    saveState();
    renderInput();
    logAction('own_record_started', '2 steps');
    toast('Your own record: add a photo and a line for each step.');
  });

  $('#btn-add-step').addEventListener('click', () => {
    if (!isCustom() || !requireIdleMic()) return;
    if (state.customSteps.length >= MAX_STEPS_UI) { toast('A record holds up to ' + MAX_STEPS_UI + ' steps.'); return; }
    syncNotesToState();
    state.customSteps.push({ note: '', image: null });
    voiceUnedited.clear();
    invalidateExtraction(null);
    saveState();
    renderInput();
    logAction('step_added', 'now ' + state.customSteps.length);
  });

  function removeStep(n) {
    if (!isCustom() || !requireIdleMic()) return;
    if (state.customSteps.length <= MIN_STEPS_UI) { toast('A record needs at least ' + MIN_STEPS_UI + ' steps.'); return; }
    syncNotesToState();
    state.customSteps.splice(n - 1, 1);
    voiceUnedited.clear();
    invalidateExtraction('Step removed, so the earlier result was cleared. Build the bag record again.');
    saveState();
    renderInput();
    logAction('step_removed', 'step ' + n);
  }

  // Downscale big photos so up to 12 fit in one request and in browser storage.
  function readStepImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const raw = String(reader.result);
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not an image this browser can open. Use a PNG, JPEG or WebP photo.'));
        img.onload = () => {
          const max = 1600;
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          if (scale === 1 && IMG_DATA_RE.test(raw) && raw.length < 900000) { resolve(raw); return; }
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = raw;
      };
      reader.readAsDataURL(file);
    });
  }

  const notesContainer = $('#notes-container');
  notesContainer.addEventListener('click', (e) => {
    const pb = e.target.closest('[data-photo]');
    if (pb) { const inp = notesContainer.querySelector('[data-photo-input="' + pb.dataset.photo + '"]'); if (inp) inp.click(); return; }
    const rb = e.target.closest('[data-remove-step]');
    if (rb && !rb.disabled) removeStep(parseInt(rb.dataset.removeStep, 10));
  });
  notesContainer.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-photo-input]');
    if (!inp || !isCustom()) return;
    const n = parseInt(inp.dataset.photoInput, 10);
    const file = inp.files && inp.files[0];
    if (!file) return;
    try {
      const dataUrl = await readStepImage(file);
      syncNotesToState();
      state.customSteps[n - 1].image = dataUrl;
      invalidateExtraction('You changed a photo, so the earlier result was cleared.');
      saveState();
      renderInput();
      logAction('image_uploaded', 'step ' + n);
      toast('Photo added to step ' + n + '. It stays in this browser unless you make a live Meta call.');
    } catch (err) {
      toast(err && err.message ? err.message : 'Could not use that photo.');
    }
  });

  // -- Voice notes (Meta Muse Voice Transcribe) ---------------------------
  const VOICE_OFF_TEXT = 'Voice notes need a Meta API key on the server.';
  let voiceAvailable = false;
  const voiceUnedited = new Set();
  let activeMic = null; // { panel, recorder }

  function setVoiceStatus(panel, msg) {
    const el = document.getElementById('voice-status-' + panel);
    if (el) el.textContent = msg || '';
  }
  function resetMicButton(panel) {
    const b = document.querySelector('[data-mic="' + panel + '"]');
    if (b) { b.textContent = 'Record note'; b.setAttribute('aria-pressed', 'false'); }
  }

  async function finishRecording(panel, wavPromise) {
    setVoiceStatus(panel, 'Sending to Meta to transcribe...');
    try {
      const wav = await wavPromise;
      const r = await fetch('api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Unscrewed': '1' }, body: wav });
      let j; try { j = await r.json(); } catch { j = null; }
      if (!r.ok || !j || j.error || typeof j.transcript !== 'string') {
        setVoiceStatus(panel, 'Transcription failed: ' + ((j && j.error && j.error.message) || 'no reason was given') + '. Type the note instead.');
        logAction('voice_failed', (j && j.error && j.error.code) || r.status);
        return;
      }
      const ta = document.getElementById('note-' + panel);
      if (!ta || !j.transcript.trim()) { setVoiceStatus(panel, 'Meta heard no speech. Try again closer to the mic.'); return; }
      ta.value = j.transcript.slice(0, 500);
      ta.dispatchEvent(new Event('input'));
      voiceUnedited.add(panel);
      const h = document.getElementById('voice-hint-' + panel);
      if (h) h.hidden = false;
      setVoiceStatus(panel, '');
      logAction('voice_transcribed', 'step ' + panel);
    } catch (e) {
      setVoiceStatus(panel, 'Could not use that recording: ' + (e && e.message ? e.message : 'unknown error') + ' Type the note instead.');
    }
  }

  $('#notes-container').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mic]');
    if (!btn || btn.disabled) return;
    const panel = parseInt(btn.dataset.mic, 10);
    if (activeMic && activeMic.panel === panel) {
      const wavPromise = activeMic.recorder.stop();
      activeMic = null;
      resetMicButton(panel);
      finishRecording(panel, wavPromise);
      return;
    }
    if (activeMic) { setVoiceStatus(panel, 'Stop the other recording first.'); return; }
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { setVoiceStatus(panel, 'This browser cannot record audio. Type the note instead.'); return; }
    const recorder = UnscrewedVoice.createRecorder(() => {
      if (activeMic && activeMic.panel === panel) {
        const p = activeMic.panel; activeMic = null; resetMicButton(p);
        setVoiceStatus(p, 'Reached 60 seconds, stopped.');
        finishRecording(p, recorder.stop());
      }
    });
    try { await recorder.start(); }
    catch { setVoiceStatus(panel, 'Microphone access was blocked. Allow it in the browser, or type the note.'); return; }
    activeMic = { panel, recorder };
    btn.textContent = 'Stop recording';
    btn.setAttribute('aria-pressed', 'true');
    setVoiceStatus(panel, 'Recording, up to 60 seconds.');
  });

  $('#btn-extract').addEventListener('click', () => {
    const notes = getCurrentNotes();
    const match = matchSeededInput(notes, isCustom());

    if (match.matched) {
      const validated = validateMetaImport(match.metaOutput, { stepCount: notes.length });
      if (!validated.valid) {
        toast('The saved response did not pass Unscrewed\'s checks (' + validated.error + '). Reload the page and try again.');
        return;
      }
      state.extractionResult = validated;
      state.extractionMeta = null;
      state.extractionInputHash = hashNotes(notes);
      currentRecord = null;
      confirmations = {};
      stepMappings = {};
      saveState();
      logAction('extraction_seeded', match.scenarioId);
      goToStep('review');
    } else {
      state.extractionResult = null;
      state.extractionMeta = null;
      saveState();
      if (isCustom()) {
        toast('Saved responses only match the test photo. Paste a Meta response on the next screen, or use a live call.');
      } else {
        toast('These notes do not match a saved response. Paste a Meta response on the next screen, or pick a sample again.');
      }
      goToStep('review');
    }
  });

  // -- Live mode ---------------------------------------------------------
  let liveAvailable = false;
  let liveModel = 'muse-wonder-1.0';
  const liveBtn = $('#btn-live');
  const liveStatus = $('#live-status');

  function setLiveStatus(msg, isError) {
    liveStatus.textContent = msg || '';
    liveStatus.className = 'live-status' + (isError ? ' live-error' : '');
  }

  async function initLiveStatus() {
    try {
      const r = await fetch('api/status');
      const j = await r.json();
      liveAvailable = j.live === true;
      voiceAvailable = j.voice === true;
      if (typeof j.model === 'string') liveModel = j.model;
    } catch { liveAvailable = false; }
    $('#mode-badge').textContent = liveAvailable ? 'Live Meta calls on (' + liveModel + ')' : 'Using saved Meta responses';
    liveBtn.disabled = !liveAvailable;
    document.querySelectorAll('[data-mic]').forEach(b => { b.disabled = !voiceAvailable; });
    document.querySelectorAll('.voice-status').forEach(el => { if (!voiceAvailable) el.textContent = VOICE_OFF_TEXT; });
    if (!liveAvailable) setLiveStatus('Live Meta calls are off because the server has no Meta API key. The saved response works without one.', false);
  }

  // The server returns the already-sanitized shape (bags[].reports). Convert it back to the import shape
  // and run the app validator again so the browser never trusts the server blindly either.
  function toImportShape(p) {
    if (!p || !Array.isArray(p.bags)) return null;
    return {
      safety_verified: false,
      bags: p.bags.map(b => ({
        id: b && b.id,
        reported_quantities: Array.isArray(b && b.reports) ? b.reports : [],
        step: b ? b.step : null,
        evidence: b ? b.evidence : [],
        confirmed_quantity: null
      })),
      questions: p.questions,
      visual_limitations: p.visual_limitations
    };
  }

  liveBtn.addEventListener('click', async () => {
    if (!liveAvailable || liveBtn.disabled) return;
    const notes = getCurrentNotes();
    const body = { notes };
    if (isCustom()) {
      const images = [];
      for (let i = 0; i < state.customSteps.length; i++) {
        const m = state.customSteps[i].image && IMG_DATA_RE.exec(state.customSteps[i].image);
        if (!m) { setLiveStatus('Step ' + (i + 1) + ' needs a PNG, JPEG or WebP photo before Meta can read your steps. Add one, or paste a Meta response instead.', true); return; }
        images.push({ step: i + 1, mime: m[1], base64: m[2] });
      }
      body.images = images;
    }
    liveBtn.disabled = true;
    $('#btn-extract').disabled = true;
    liveBtn.textContent = 'Asking Meta (up to 60 seconds)';
    setLiveStatus(isCustom() ? 'Sending your ' + notes.length + ' step photos and notes to Meta. This can take up to a minute.' : 'Sending your photo and notes to Meta. This can take up to a minute.', false);
    try {
      const r = await fetch('api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unscrewed': '1' }, body: JSON.stringify(body) });
      let j;
      try { j = await r.json(); } catch { j = null; }
      if (!r.ok || !j || j.error) {
        const e = (j && j.error) || {};
        setLiveStatus('The live Meta call failed: ' + (e.message || 'no reason was given') + '. Try again, or use the saved response.', true);
        logAction('live_failed', e.code || r.status);
        return;
      }
      const validated = validateMetaImport(toImportShape(j.proposal), importOpts(notes));
      if (!validated.valid) {
        setLiveStatus('Unscrewed rejected Meta\'s answer: ' + validated.error + '. Try the live call again.', true);
        logAction('live_rejected', validated.error);
        return;
      }
      state.extractionResult = validated;
      state.extractionMeta = { mode: 'live', model: String(j.model), latencyMs: Number(j.latencyMs) || 0, usage: j.usage && typeof j.usage === 'object' ? j.usage : null };
      state.extractionInputHash = hashNotes(notes);
      currentRecord = null;
      confirmations = {};
      stepMappings = {};
      saveState();
      logAction('extraction_live', j.model);
      setLiveStatus('', false);
      goToStep('review');
    } catch {
      setLiveStatus('Could not reach the Unscrewed server. Check that it is still running, then try again.', true);
    } finally {
      liveBtn.textContent = LIVE_LABEL;
      liveBtn.disabled = !liveAvailable;
      $('#btn-extract').disabled = false;
    }
  });

  // -- Step 2: Review --------------------------------------------------
  function renderReview() {
    const result = state.extractionResult;
    const bannerC = $('#sample-banner-container');
    const invalidC = $('#invalidation-container');
    const bagsC = $('#bags-container');
    const questionsC = $('#questions-container');
    const conflictsC = $('#conflicts-container');
    const limitationsC = $('#limitations-container');
    const importDetails = $('#import-details');

    bannerC.innerHTML = '';
    invalidC.innerHTML = '';
    bagsC.innerHTML = '';
    questionsC.innerHTML = '';
    conflictsC.innerHTML = '';
    limitationsC.innerHTML = '';

    if (!result) {
      importDetails.open = true;
      renderError(invalidC,
        'Nothing to review yet',
        isCustom()
          ? 'Saved responses only match the test photo. Paste a Meta response below, or go back and use a live call.'
          : 'The notes changed, so no saved response matches them. Go back and build the bag record again, or paste a Meta response below.'
      );
      $('#questions-card').style.display = 'none';
      $('#conflicts-card').style.display = 'none';
      $('#limitations-card').style.display = 'none';
      $('#btn-to-confirm').disabled = true;
      return;
    }

    importDetails.open = false;
    $('#btn-to-confirm').disabled = false;

    const meta = state.extractionMeta;
    if (meta && meta.mode === 'live') {
      const tok = meta.usage && typeof meta.usage === 'object'
        ? ['input_tokens', 'output_tokens', 'total_tokens'].filter(k => Number.isFinite(meta.usage[k])).map(k => k.replace('_tokens', '') + ' ' + meta.usage[k]).join(', ')
        : '';
      bannerC.innerHTML = `
      <div class="notice live">
        <strong>Live answer from Meta ${esc(meta.model)}</strong>
        It took ${esc(Math.round(meta.latencyMs / 100) / 10)} seconds${tok ? ' and used these tokens: ' + esc(tok) : ''}. Meta only suggests. Nothing counts until you confirm it on the next screen.
      </div>`;
    } else {
      bannerC.innerHTML = `
      <div class="notice">
        <strong>Saved Meta response, not a live call</strong>
        This answer was recorded earlier from Meta muse-wonder-1.0. Meta only suggests. Nothing counts until you confirm it on the next screen.
      </div>`;
    }

    result.bags.forEach(bag => {
      const hasReports = bag.reports && bag.reports.length > 0;
      const reportValues = hasReports ? [...new Set(bag.reports.map(r => r.value))] : [];
      const hasConflict = reportValues.length > 1;
      const isMissing = !hasReports;
      let statusClass = 'reported';
      let statusText = 'Reported in notes';
      if (hasConflict) { statusClass = 'conflict'; statusText = 'Counts disagree'; }
      if (isMissing) { statusClass = 'missing-status'; statusText = 'No count found'; }

      let reportsHtml = '';
      if (hasReports) {
        reportsHtml = '<div class="bag-reports">' +
          bag.reports.map(r =>
            '<div class="report-row">' +
            '<span>Notes say <strong>' + esc(r.value) + '</strong></span>' +
            '<span>from ' + esc(evList(r.evidence)) + '</span>' +
            '</div>'
          ).join('') +
          '</div>';
      } else {
        reportsHtml = '<div class="no-count">Your notes give no count for this bag. You will enter it yourself.</div>';
      }

      bagsC.innerHTML +=
        '<div class="bag-card ' + (hasConflict ? 'conflict' : isMissing ? 'missing' : '') + '">' +
          '<div class="bag-header">' +
            '<span class="bag-id"><span class="visually-hidden">Bag </span>' + esc(bag.id) + '</span>' +
            '<span class="bag-status ' + statusClass + '">' + esc(statusText) + '</span>' +
          '</div>' +
          '<div class="bag-detail">' + (bag.step !== null ? 'Meta suggests step <strong>' + esc(bag.step) + '</strong>' : 'Meta found no step for this bag') + '</div>' +
          (bag.model_confirmation_proposal !== null && bag.model_confirmation_proposal !== undefined
            ? '<div class="bag-detail">Meta proposed confirming <strong>' + esc(bag.model_confirmation_proposal) + '</strong>. That does not count. Only you can confirm.</div>'
            : '') +
          reportsHtml +
          '<div class="bag-detail">Not confirmed yet. You confirm on the next screen.</div>' +
        '</div>';
    });

    if (result.questions && result.questions.length > 0) {
      $('#questions-card').style.display = 'block';
      result.questions.forEach(q => {
        questionsC.innerHTML += '<div class="question-item">' + esc(plainSteps(q)) + '</div>';
      });
    } else {
      $('#questions-card').style.display = 'none';
    }

    if (result.conflicts && result.conflicts.length > 0) {
      $('#conflicts-card').style.display = 'block';
      result.conflicts.forEach(c => {
        const bag = result.bags.find(b => b.id === c.bag);
        const says = bag && bag.reports && bag.reports.length
          ? bag.reports.map((r, i) => (i === 0 ? cap(evList(r.evidence)) : evList(r.evidence)) + ' says ' + r.value).join(', ')
          : (c.reported_values || []).join(' and ');
        conflictsC.innerHTML +=
          '<div class="question-item problem">' +
          'Bag ' + esc(c.bag) + ': ' + esc(says) + '. Recount the bag. You settle this on the next screen.' +
          '</div>';
      });
    } else {
      $('#conflicts-card').style.display = 'none';
    }

    if (result.visual_limitations && result.visual_limitations.length > 0) {
      $('#limitations-card').style.display = 'block';
      result.visual_limitations.forEach(l => {
        limitationsC.innerHTML += '<div class="limitation-item">' + esc(plainSteps(l)) + '</div>';
      });
    } else {
      $('#limitations-card').style.display = 'none';
    }
  }

  $('#btn-json-import').addEventListener('click', () => {
    const raw = $('#json-import-input').value.trim();
    if (!raw) { toast('Paste the JSON from Meta first.'); return; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { toast('That text is not valid JSON. Copy the whole response from Meta and paste it again.'); return; }
    const validated = validateMetaImport(parsed, importOpts(getCurrentNotes()));
    if (!validated.valid) { toast('Unscrewed could not use that response: ' + validated.error + '. Fix it and try again.'); return; }
    state.extractionResult = validated;
    state.extractionMeta = null;
    state.extractionInputHash = hashNotes(getCurrentNotes());
    currentRecord = null;
    confirmations = {};
    stepMappings = {};
    saveState();
    logAction('json_imported', 'user paste');
    toast('Meta response accepted.');
    renderReview();
  });

  $('#btn-back-input').addEventListener('click', () => goToStep('input'));
  $('#btn-to-confirm').addEventListener('click', () => {
    if (!state.extractionResult) { toast('There is no bag record yet. Go back and build one.'); return; }
    buildRecordFromExtraction();
    goToStep('confirm');
  });

  // -- Build record from validated extraction --------------------------
  function buildRecordFromExtraction() {
    const ext = state.extractionResult;
    if (!ext) return;

    const rec = new UnscrewedRecord('mvp-' + Date.now());

    const notes = getCurrentNotes();
    notes.forEach((n) => {
      rec.addStep({
        action: n.note,
        source: 'user_reported',
        evidence: ['step' + n.panel]
      });
    });

    ext.bags.forEach(bag => {
      const firstReport = bag.reports[0];
      const qty = firstReport ? firstReport.value : null;
      const ev = firstReport ? firstReport.evidence : [];

      rec.addPart({
        partId: 'screws_' + bag.id,
        name: 'Bag ' + bag.id + ' screws',
        quantity: qty,
        storage: 'Bag ' + bag.id,
        linkedStep: null,
        source: 'user_reported',
        evidence: ev
      });

      if (bag.reports.length > 1) {
        const values = bag.reports.map(r => r.value);
        const unique = [...new Set(values)];
        if (unique.length > 1) {
          rec.addConflict({
            conflictId: 'extract_' + bag.id + '_qty_' + Date.now(),
            fieldPath: 'parts.screws_' + bag.id + '.quantity',
            reports: bag.reports.map(r => ({
              value: r.value,
              source: 'user_reported',
              evidence: r.evidence
            }))
          });
        }
      }
    });

    currentRecord = rec;
    confirmations = {};
    stepMappings = {};

    // Model steps are suggestions only; stepMappings stays empty until the user confirms each bag.

    logAction('record_built', ext.bags.length + ' bags');
  }

  // -- Step 3: Confirm -------------------------------------------------
  function renderConfirm() {
    const ext = state.extractionResult;
    const container = $('#confirm-bags-container');
    const conflictC = $('#confirm-conflicts-container');
    const mappingC = $('#confirm-mappings-container');
    container.innerHTML = '';
    conflictC.innerHTML = '';
    mappingC.innerHTML = '';

    if (!ext || !currentRecord) {
      renderError(container, 'Nothing to confirm yet', 'Go back to Add steps and build the bag record first.');
      return;
    }
    if (ext.bags.length === 0) {
      container.innerHTML = '<p class="hint">Your notes do not mention any bag, so there is nothing to count.</p>';
    }

    const unresolvedConflicts = currentRecord.getUnresolvedConflicts();

    ext.bags.forEach(bag => {
      const partId = 'screws_' + bag.id;
      const part = currentRecord.getPart(partId);
      const isConfirmed = part && part.quantity.source === 'user_confirmed';
      const confirmedVal = confirmations[bag.id];
      const hasConflict = unresolvedConflicts.some(c => c.fieldPath === 'parts.' + partId + '.quantity');
      const defaultVal = bag.reports[0]?.value ?? '';
      const mappedStep = stepMappings[bag.id];
      const stepDefault = mappedStep != null ? mappedStep : bag.step;
      const stepSelect = '<select id="step-map-' + esc(bag.id) + '" data-map-bag="' + esc(bag.id) + '"' + (isConfirmed ? ' disabled' : '') + '>' +
        '<option value="">Choose a step</option>' +
        validSteps().map(st => '<option value="' + st + '"' + (stepDefault === st ? ' selected' : '') + '>Step ' + st + '</option>').join('') +
        '</select>';

      container.innerHTML +=
        '<div class="bag-card ' + (isConfirmed ? 'confirmed' : hasConflict ? 'conflict' : '') + (isConfirmed && lastConfirmedBag === bag.id ? ' just-confirmed' : '') + '" id="confirm-bag-' + esc(bag.id) + '">' +
          '<div class="bag-header">' +
            '<span class="bag-id"><span class="visually-hidden">Bag </span>' + esc(bag.id) + '</span>' +
            '<span class="bag-status ' + (isConfirmed ? 'confirmed' : hasConflict ? 'conflict' : 'reported') + '">' +
              (isConfirmed ? CHECK_SVG + 'Confirmed' : hasConflict ? 'Needs a recount' : 'Not confirmed yet') +
            '</span>' +
          '</div>' +
          (bag.reports.length > 0 ?
            '<div class="bag-reports">' +
              bag.reports.map(r =>
                '<div class="report-row"><span>Notes say <strong>' + esc(r.value) + '</strong></span><span>from ' + esc(evList(r.evidence)) + '</span></div>'
              ).join('') +
            '</div>'
          : '<div class="no-count">Your notes give no count for this bag. Count it and enter the number.</div>') +
          (!isConfirmed && hasConflict ? '<div class="bag-detail">The notes disagree, so the box starts empty. Count the bag and enter what you find.</div>' : '') +
          '<div class="confirm-section">' +
            '<div class="field">' +
              '<label for="qty-' + esc(bag.id) + '">Screws in bag ' + esc(bag.id) + '</label>' +
              '<input type="number" inputmode="numeric" id="qty-' + esc(bag.id) + '" min="1" max="999" ' + (hasConflict && !isConfirmed ? 'value="" placeholder="Recount and enter"' : 'value="' + esc(isConfirmed ? confirmedVal : defaultVal) + '"') + ' data-bag="' + esc(bag.id) + '"' + (isConfirmed ? ' disabled' : '') + ' aria-describedby="msg-' + esc(bag.id) + '">' +
            '</div>' +
            '<div class="field">' +
              '<label for="step-map-' + esc(bag.id) + '">Put in at step</label>' +
              stepSelect +
            '</div>' +
            '<div class="field-msg" id="msg-' + esc(bag.id) + '" role="alert"></div>' +
            '<div class="confirm-buttons">' +
              '<button type="button" class="btn btn-primary" data-confirm-bag="' + esc(bag.id) + '"' + (isConfirmed ? ' disabled' : '') + '>' +
                (isConfirmed ? 'Confirmed' : 'Confirm bag ' + esc(bag.id)) +
              '</button>' +
              (isConfirmed ? '<button type="button" class="btn btn-outline" data-revoke-bag="' + esc(bag.id) + '">Change bag ' + esc(bag.id) + '</button>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
    });
    lastConfirmedBag = null;

    if (unresolvedConflicts.length > 0) {
      conflictC.innerHTML =
        '<div class="block">' +
          '<h3>Counts that disagree</h3>' +
          '<p class="hint">Confirming the count for one of these bags settles the disagreement.</p>' +
          unresolvedConflicts.map(c => {
            const m = /screws_([A-Za-z0-9]+)\./.exec(c.fieldPath);
            return '<div class="question-item problem">' +
              'Bag ' + esc(m ? m[1] : '?') + ': ' + c.reports.map((r, i) => (i === 0 ? cap(evList(r.evidence)) : evList(r.evidence)) + ' says ' + esc(r.value)).join(', ') +
              '</div>';
          }).join('') +
        '</div>';
    }

    updateReassemblyButton();
  }

  $('#confirm-bags-container').addEventListener('click', (e) => {
    const confirmBtn = e.target.closest('[data-confirm-bag]');
    const revokeBtn = e.target.closest('[data-revoke-bag]');
    if (confirmBtn && !confirmBtn.disabled) doConfirm(confirmBtn.dataset.confirmBag);
    if (revokeBtn) doRevoke(revokeBtn.dataset.revokeBag);
  });

  function doConfirm(bagId) {
    if (!currentRecord) { toast('There is no bag record yet. Go back and build one.'); return; }
    const input = $('#qty-' + bagId);
    if (!input) return;
    const val = parseInt(input.value, 10);
    const msg = $('#msg-' + bagId);
    if (msg) msg.textContent = '';

    if (!Number.isSafeInteger(val) || val < 1) {
      if (msg) msg.textContent = 'Enter how many screws are in bag ' + bagId + ', as a whole number of 1 or more.';
      input.focus();
      return;
    }
    const stepSel = $('#step-map-' + bagId);
    const stepVal = stepSel ? parseInt(stepSel.value, 10) : NaN;
    if (!validSteps().includes(stepVal)) {
      if (msg) msg.textContent = 'Choose the step you put bag ' + bagId + ' in, then confirm again.';
      if (stepSel) stepSel.focus();
      return;
    }

    const partId = 'screws_' + bagId;
    const conflicts = currentRecord.getUnresolvedConflicts().filter(c => c.fieldPath === 'parts.' + partId + '.quantity');
    conflicts.forEach(c => {
      currentRecord.resolveConflict(c.conflictId, {
        resolvedValue: val,
        reason: 'User confirmed: ' + val,
        evidence: ['user_ui_confirm']
      });
    });

    if (conflicts.length === 0) {
      currentRecord.confirmPartField(partId, 'quantity', val, ['user_ui_confirm']);
    }

    stepMappings[bagId] = stepVal;
    currentRecord.updatePartField(partId, 'linkedStep', stepVal, 'user_confirmed', ['user_ui_mapping'], 'User step mapping');
    confirmations[bagId] = val;
    logAction('step_mapped', bagId + '=' + stepVal);
    logAction('quantity_confirmed', bagId + '=' + val);
    lastConfirmedBag = bagId;
    toast('Bag ' + bagId + ' confirmed: ' + val + ' screws, step ' + stepVal + '.');
    renderConfirm();
  }

  function doRevoke(bagId) {
    if (!currentRecord) return;
    const prevConfirmations = { ...confirmations };
    const prevMappings = { ...stepMappings };
    delete prevConfirmations[bagId];
    delete prevMappings[bagId];

    buildRecordFromExtraction();

    for (const [id, val] of Object.entries(prevConfirmations)) {
      if (id !== bagId) {
        const partId = 'screws_' + id;
        const conflicts = currentRecord.getUnresolvedConflicts().filter(c => c.fieldPath === 'parts.' + partId + '.quantity');
        conflicts.forEach(c => {
          currentRecord.resolveConflict(c.conflictId, {
            resolvedValue: val,
            reason: 'User confirmed: ' + val,
            evidence: ['user_ui_confirm']
          });
        });
        if (conflicts.length === 0) {
          currentRecord.confirmPartField(partId, 'quantity', val, ['user_ui_confirm']);
        }
        confirmations[id] = val;
        if (prevMappings[id] != null) {
          currentRecord.updatePartField(partId, 'linkedStep', prevMappings[id], 'user_confirmed', ['user_ui_mapping'], 'User step mapping');
        }
      }
    }

    stepMappings = prevMappings;
    logAction('quantity_revoked', bagId);
    toast('Bag ' + bagId + ' is open again. Confirm it when you have recounted.');
    renderConfirm();
  }

  function updateReassemblyButton() {
    const btn = $('#btn-to-reassembly');
    if (!currentRecord) { btn.disabled = true; return; }

    const allQtyConfirmed = bagIds().every(id => {
      const part = currentRecord.getPart('screws_' + id);
      return part && part.quantity.source === 'user_confirmed' && Number.isSafeInteger(part.quantity.value) && part.quantity.value >= 1;
    });
    const noConflicts = currentRecord.getUnresolvedConflicts().length === 0;
    const allMapped = bagIds().every(id => stepMappings[id] != null && validSteps().includes(stepMappings[id]));

    btn.disabled = !(allQtyConfirmed && noConflicts && allMapped);

    const gateStatus = $('#gate-status');
    if (gateStatus) {
      const gates = [];
      if (!allQtyConfirmed) gates.push('You confirm a count for every bag.');
      if (!noConflicts) gates.push('You settle every count that disagrees.');
      if (!allMapped) gates.push('You choose a step for every bag.');
      gateStatus.innerHTML = gates.length > 0
        ? '<div class="gate-blocked"><strong>The put-back reference stays locked until:</strong><ul>' + gates.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul></div>'
        : '<div class="gate-clear"><strong>' + (bagIds().length === 0 ? 'Your notes mention no bags, so there is nothing to count.' : bagIds().length === 1 ? 'The bag is confirmed.' : 'All ' + bagIds().length + ' bags are confirmed.') + '</strong>You can continue to the put-back reference.</div>';
    }
  }

  $('#btn-back-review').addEventListener('click', () => goToStep('review'));
  $('#btn-to-reassembly').addEventListener('click', () => {
    if (!currentRecord) return;
    const allQtyConfirmed = bagIds().every(id => {
      const part = currentRecord.getPart('screws_' + id);
      return part && part.quantity.source === 'user_confirmed' && Number.isSafeInteger(part.quantity.value) && part.quantity.value >= 1;
    });
    const noConflicts = currentRecord.getUnresolvedConflicts().length === 0;
    const allMapped = bagIds().every(id => stepMappings[id] != null);
    if (!allQtyConfirmed || !noConflicts || !allMapped) {
      toast('Confirm every bag, settle any disagreeing counts, and choose a step for each bag first.');
      return;
    }
    goToStep('reassembly');
  });

  // -- Step 4: Reassembly ---------------------------------------------
  function renderReassembly() {
    const content = $('#reassembly-content');

    if (!currentRecord) {
      renderError(content, 'Nothing to put back yet', 'Go to Confirm and confirm every bag first.');
      return;
    }

    const summary = currentRecord.toReassemblySummary();
    const allConfirmed = summary.parts.every(p => p.quantityIsConfirmed);
    const hasConflicts = summary.parts.some(p => p.hasUnresolvedConflict);
    const allMapped = bagIds().every(id => stepMappings[id] != null);

    if (!allConfirmed || hasConflicts || !allMapped) {
      const reasons = [];
      if (!allConfirmed) reasons.push('Not every bag count is confirmed.');
      if (hasConflicts) reasons.push('Some counts still disagree.');
      if (!allMapped) reasons.push('Not every bag has a step.');
      content.innerHTML =
        '<div class="reassembly-blocked">' +
          '<div class="blocked-title">The put-back reference is locked</div>' +
          '<div class="reason">' + reasons.map(r => esc(r)).join(' ') + ' Finish confirming to unlock it.</div>' +
          '<button type="button" class="btn btn-primary" onclick="document.querySelector(\'[data-step=confirm]\').click()">Go to confirm</button>' +
        '</div>';
      return;
    }

    const steps = currentRecord._data.steps;
    const refs = buildReassemblyRefs(currentRecord, state.extractionResult, stepMappings, state.editedNotes);

    content.innerHTML =
      '<div class="notice safety">' +
        '<strong>This is not assembly instructions</strong>' +
        'It replays the steps you recorded, last step first. It does not show that the furniture is safe to use. Tightness, load and stability are for you to check.' +
      '</div>' +

      '<h3>Bags you confirmed</h3>' +
      '<div class="confirmed-bags">' +
        summary.parts.map(p =>
          '<div class="mini-bag">' +
            '<span class="bag-id"><span class="visually-hidden">Bag </span>' + esc(String(p.storage).replace(/^Bag /, '')) + '</span>' +
            '<span class="txt"><strong>' + esc(p.quantity) + ' screws</strong><br>put in at step ' + esc(p.linkedStep) + '</span>' +
          '</div>'
        ).join('') +
      '</div>' +

      '<h3>Steps, last one first</h3>' +
      '<ol class="reverse-list">' +
        refs.map((ref) =>
          '<li class="reassembly-step">' +
            '<span class="step-num"><span class="visually-hidden">Step </span>' + esc(ref.step.stepIndex + 1) + '</span>' +
            '<div>' +
              '<div class="order">Put back ' + esc(ref.refNumber) + ' of ' + esc(refs.length) + '</div>' +
              '<div class="note">' + esc(ref.originalNote) + '</div>' +
              ref.lines.map(l =>
                '<div class="ref-line ref-confirmed">' + esc(l.text) + '</div>' +
                l.corrections.map(c =>
                  '<div class="ref-correction">' + esc(c) + '</div>'
                ).join('')
              ).join('') +
            '</div>' +
          '</li>'
        ).join('') +
      '</ol>' +

      '<div class="notice safety" style="margin-top:20px">' +
        '<strong>A confirmed count is not a safety check</strong>' +
        'Confirming only shows that you counted the screws. It does not show the furniture is safe.' +
      '</div>';
  }

  $('#btn-back-confirm').addEventListener('click', () => goToStep('confirm'));

  // -- Step 5: History -------------------------------------------------
  const ACTION_TEXT = {
    scenario_changed: (d) => ['Chose a sample', SCENARIO_LABELS[d] || d],
    image_uploaded: (d) => ['Added a photo', d],
    own_record_started: (d) => ['Started your own record', d],
    step_added: (d) => ['Added a step', d],
    step_removed: (d) => ['Removed a step', d],
    extraction_seeded: (d) => ['Built the bag record from a saved Meta response', SCENARIO_LABELS[d] || d],
    extraction_live: (d) => ['Built the bag record from a live Meta call', d],
    live_failed: (d) => ['The live Meta call failed', d ? 'Reason: ' + d : ''],
    live_rejected: (d) => ['Unscrewed rejected Meta\'s answer', d],
    json_imported: () => ['Pasted a Meta response', ''],
    record_built: (d) => ['Started the confirmation list', d],
    step_mapped: (d) => { const m = /^(.+)=(\d+)$/.exec(d); return m ? ['Chose a step for bag ' + m[1], 'Step ' + m[2]] : ['Chose a step', d]; },
    quantity_confirmed: (d) => { const m = /^(.+)=(\d+)$/.exec(d); return m ? ['Confirmed bag ' + m[1], m[2] + ' screws'] : ['Confirmed a bag', d]; },
    voice_transcribed: (d) => ['Transcribed a voice note with Meta', d],
    voice_failed: (d) => ['A voice note could not be transcribed', d ? 'Reason: ' + d : ''],
    quantity_revoked: (d) => ['Reopened bag ' + d, ''],
  };
  function friendlyReason(r) {
    const t = String(r || '');
    let m = /^User confirmed: (.+)$/.exec(t);
    if (m) return 'You confirmed ' + m[1];
    if (/^User step mapping/.test(t)) return 'You chose the step';
    return /confirm/i.test(t) ? 'You confirmed it' : '';
  }

  function renderHistory() {
    const container = $('#history-container');
    let items = [];

    state.actionLog.forEach(entry => {
      const fn = ACTION_TEXT[entry.action];
      const [action, detail] = fn ? fn(entry.detail || '') : [cap(String(entry.action).replace(/_/g, ' ')), entry.detail || ''];
      items.push({ ts: entry.ts, action, detail });
    });

    if (currentRecord) {
      currentRecord._data.parts.forEach(part => {
        const bagId = String(part.partId).replace(/^screws_/, '');
        const fieldNames = { quantity: 'count', name: 'name', storage: 'bag', linkedStep: 'step' };
        ['quantity', 'name', 'storage', 'linkedStep'].forEach(field => {
          if (part[field] && part[field].history) {
            part[field].history.forEach(h => {
              const prev = h.previousValue;
              const was = (typeof prev === 'number' || typeof prev === 'string') && prev !== '' ? 'Was ' + prev : '';
              items.push({
                ts: h.timestamp,
                action: 'Bag ' + bagId + ': ' + fieldNames[field] + ' changed',
                detail: [was, friendlyReason(h.reason)].filter(Boolean).join('. ')
              });
            });
          }
        });
      });
      currentRecord._data.conflicts.forEach(c => {
        if (c.resolution) {
          const m = /screws_([A-Za-z0-9]+)\./.exec(c.fieldPath || '');
          items.push({
            ts: c.resolution.timestamp,
            action: (m ? 'Bag ' + m[1] + ': ' : '') + 'disagreement settled',
            detail: friendlyReason(c.resolution.reason)
          });
        }
      });
    }

    items.sort((a, b) => b.ts.localeCompare(a.ts));

    if (items.length === 0) {
      container.innerHTML = '<p class="empty">Nothing yet. Your actions show up here as you work.</p>';
      return;
    }

    container.innerHTML = items.map(item =>
      '<div class="history-item">' +
        '<div class="ts">' + esc(formatTime(item.ts)) + '</div>' +
        '<div class="action">' + esc(item.action) + '</div>' +
        (item.detail ? '<div class="detail">' + esc(item.detail) + '</div>' : '') +
      '</div>'
    ).join('');
  }

  $('#btn-back-from-history').addEventListener('click', () => {
    const step = currentRecord ? 'confirm' : 'input';
    goToStep(step);
  });

  // -- Reset -----------------------------------------------------------
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Clear everything Unscrewed saved in this browser and start over?')) return;
    state = defaultState();
    currentRecord = null;
    confirmations = {};
    stepMappings = {};
    saveState();
    renderInput();
    goToStep('input');
    toast('Saved data cleared.');
  });

  // -- Helpers ---------------------------------------------------------
  function bagIds() { return state.extractionResult ? state.extractionResult.bags.map(b => b.id) : []; }
  function stepCountNow() {
    const e = state.extractionResult;
    return (e && Number.isSafeInteger(e.stepCount) && e.stepCount > 0) ? e.stepCount : currentNotesModel().length;
  }
  function validSteps() { return Array.from({ length: stepCountNow() }, (_, i) => i + 1); }
  // The bags in any answer must match the bag letters the notes mention.
  function importOpts(notes) { return { expectedBags: bagLettersFromNotes(notes), stepCount: notes.length }; }

  function getCurrentNotes() {
    const textareas = $$('#notes-container textarea');
    if (textareas.length === 0) {
      return currentNotesModel();
    }
    return Array.from(textareas).map(ta => ({
      panel: parseInt(ta.dataset.panel, 10),
      note: ta.value
    }));
  }

  function hashNotes(notes) {
    return JSON.stringify([notes, imageSignature()]);
  }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return iso; }
  }

  // -- Init ------------------------------------------------------------
  renderInput();
  goToStep(state.currentStep || 'input');
  initLiveStatus();

})();
