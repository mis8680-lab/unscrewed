# Unscrewed - Take it apart. You're not screwed.

Unscrewed is a disassembly record assistant. Take furniture or a gadget apart, photograph each step, write a line about it, and let Meta draft what went into each labeled bag. You confirm every count, then get your own steps back in reverse.

**What is different from manual logging apps:** most disassembly loggers only store what you type. Unscrewed uses Meta models to do real work: it transcribes spoken notes (Muse Voice Transcribe), reads every step photo (Muse Wonder) to note which part came off and what is attached to what, and cross-checks your notes for bags that disagree. Meta only suggests. Nothing counts until you confirm it, and screws are never counted from photos.

## Problem

When you take furniture or a gadget apart for a move or a repair, you put screws in labeled bags and snap photos. Weeks later you put it back together, staring at loose parts and mystery bags. Which bag goes where? Did you count right? Unscrewed turns your step photos, spoken or typed notes into a draft record with Meta models, then makes you confirm every count before it shows your steps in reverse.

## Built during the hackathon (Oct 27 - Nov 4, 2026)

Everything in this repository was created during the hackathon build period (Oct 27 - Nov 4, 2026):

- **Record safeguard system** (`lib/record.mjs`, browser build in `public/record-browser.js`): deterministic per-field provenance tracking. Visual estimates never overwrite user-reported values. Same-rank conflicts are registered, never silently resolved. Every field change keeps its full history.
- **5-screen UI flow**: Add steps (2 to 12 steps, one photo, one note and an optional voice note per step), Check (model output with evidence and photo observations), Confirm (explicit per-bag quantity confirmation, step mapping, conflict resolution), Put back (reverse-order reference, gated behind full confirmation), Activity (audit trail).
- **Validation pipeline** (`public/sample-data.js`, `lib/validate-output.mjs`): structural validation of Meta JSON. Bags are the letters A to H that the notes mention, and the model's bag set must equal that set. Quantities must be positive integers, evidence ids are `stepN` (legacy `panelN` is still accepted), evidence must be non-blank, and conflicts are derived from reports (imported conflict status is ignored).
- **Three sample scenarios**: Normal (all data present), Missing (bag B has no quantity or step), Conflict (bag A reported as 6 and as 4). The five steps of a sample share one contact-sheet photo. Each is backed by a saved Meta Playground response in `fixtures/meta/`.
- **Live Meta pipeline** (`lib/live-meta.mjs`): server-side calls to the Meta Model API with request checks (same-origin plus `X-Unscrewed` header, rate limit, image and WAV header checks, body deadline), notes passed as fenced untrusted data, and a deterministic cross-check that every reported quantity actually appears in the cited note (digits or number words).
- **Test suite**: 208 tests covering safeguard invariants, validation rules, the live pipeline and voice endpoint (with a mocked Meta API), fixture integrity, and UI contract checks.

## Meta model usage

Meta does three jobs here. In every one of them Meta only suggests; the person confirms.

1. **Photos (Muse Wonder, `muse-wonder-1.0`)**: every step photo is uploaded to `POST /v1/files` and all of them go into one `POST /v1/responses` call, in step order and labeled by step. Meta returns the bag record and, per step, up to three `observations` of what it sees: which part came off and from where, side and orientation cues, visible labels, what is attached to what. They appear as "Seen in your photo (check it)" on Check and Put back, visibly apart from your own notes. The server strips any observation that has a digit or number word next to screw, bolt, nut, washer or fastener, anything over 140 characters, and anything beyond three per step. Screws are never counted from photos.
2. **Notes (Muse Wonder)**: the model reads the notes for bag letters, quantities and step mapping, returns a proposal with evidence citations, and the server cross-checks each quantity against the cited note. Conflicting reports stay unresolved until you recount.
3. **Voice (Muse Voice Transcribe, `muse-voice-transcribe-1.0`)**: each step has a Record note button. The browser records, resamples to 24 kHz mono and encodes a 16-bit WAV (60 second cap). `POST /api/transcribe` forwards it to `POST https://api.meta.ai/v1/asr/transcribe` in PUSH_TO_TALK mode with English language bias and keywords for bag letters and hardware terms. The transcript fills the note box with a "Transcribed by Meta. Check it." hint until you edit it. Without a key the mic is disabled with an explanation.

- **Safety boundary**: the model never sets `confirmed_quantity` or `safety_verified` to true. The app strips any such attempt and requires the user to confirm each quantity with an explicit click. Reassembly stays locked until every bag is confirmed and mapped to a step. A transcript or an observation never confirms anything.
- **Saved responses**: sample mode runs on real `muse-wonder-1.0` responses captured in the Playground and stored in `fixtures/meta/` (`normal.json`, `missing.json`, `conflict.json`). The prompt is `fixtures/meta/prompt.txt` and the matching notes are `fixtures/meta/inputs.json`. `fixtures/meta/live-conflict-sample.json` is one validated live response for the conflict notes on the contact sheet, and `fixtures/meta/live-steps-sample.json` is one validated live response with five separate step photos, including the photo observations.
- **Live mode**: works with your own Meta Model API key. Run `cp .env.example .env`, put your key in `META_API_KEY`, then start with `node --env-file=.env server.mjs`. The key stays on the server and is never sent to the browser. `GET /api/status` reports whether live mode and voice are available. `POST /api/extract` accepts 2 to 12 notes of up to 500 characters, optional `images` (one PNG, JPEG or WebP per step, at most 12) or one shared `imageBase64`, a 25MB body limit and a 60s timeout. `POST /api/transcribe` accepts one `audio/wav` body (mono, 16-bit PCM, 16 or 24 kHz, 60 seconds, 5MB). Typed errors include `no_key`, `forbidden`, `rate_limited`, `bad_mime`, `bad_audio`, `too_large`, `body_timeout`, `upstream_http`, `invalid_json`, `schema_invalid` (including `unsupported_quantity` when a number is not in the cited note, and missing or extra bags), and `timeout`. The response returned to the browser is the sanitized proposal, never raw model JSON.
- **Sample mode** works without a key: the header shows "Using saved Meta responses", the live button and the mic are disabled with an explanation.

## Synthetic test image

`fixtures/synthetic-shelf.png` is an AI-generated synthetic test fixture (a 5-panel contact sheet of a bookshelf being disassembled, used as one shared photo for the five sample steps). It is not a photo of a real disassembly. The app uses it only as a labeled sample photo.

## How to run

Requires Node.js 20 or newer. No dependencies to install.

```bash
node server.mjs
# http://127.0.0.1:4173
# Change port: PORT=3000 node server.mjs
# Live mode: node --env-file=.env server.mjs
```

Run tests from the repo root:

```bash
node --test
```

## Limitations

| Area | Status |
|------|--------|
| Live Meta API integration | Works with your own key in `.env`. Without a key, saved Playground responses only. |
| Image analysis | In live mode every step photo is sent to Meta with the notes. Meta describes what it sees as suggestions to check. Screws are never counted from photos; quantities come from notes and user confirmation. |
| Multi-user support | Single browser, localStorage only. |
| Synthetic image | AI-generated test fixture, not a real disassembly. |
| Physical safety | Never guaranteed. `safe: false` is hardcoded. Torque, load, and structural safety are out of scope. |
| Server-side storage | None. |
| Authentication | None. |
| Furniture types | Any project with 2 to 12 steps and bags A to H. Bag letters are read from the notes, so name each bag as "bag A" in a note. |

## File structure

```
server.mjs                   # Node HTTP server (zero deps)
lib/record.mjs               # Record safeguards (Node module)
lib/record.test.mjs          # Tests for the record module
lib/validate-output.mjs      # Proposal validator
lib/live-meta.mjs            # Live Meta Model API pipeline, voice transcription, request checks
public/                      # Static front end (index.html, app.js, voice.js, style.css, ...)
test/app.test.mjs            # App, validation, and UI contract tests
test/live.test.mjs           # Live pipeline tests (mocked Meta API)
test/voice.test.mjs          # Voice endpoint, WAV encoder and header checks
test/flexible.test.mjs       # 2 to 12 steps, per-step photos, dynamic bags
test/observations.test.mjs   # Photo observation rules
fixtures/meta/               # Saved muse-wonder-1.0 responses, prompt, inputs
fixtures/synthetic-shelf.png # AI-generated test image
```

## License

MIT, see `LICENSE`.
