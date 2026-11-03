# PackBack - Disassembly Record Assistant

## Problem

When you disassemble furniture for a move, you put screws in labeled bags and snap photos. Weeks later you reassemble, staring at unlabeled wood and mystery bags. Which bag goes where? Did you count right? PackBack extracts structured data from your disassembly notes and photo using a Meta model, then walks you through an explicit confirmation flow before producing a reassembly reference.

## Built during the hackathon (Oct 27 - Nov 4, 2026)

Everything in this repository was created during the hackathon build period (Oct 27 - Nov 4, 2026):

- **Record safeguard system** (`lib/record.mjs`, browser build in `public/record-browser.js`): deterministic per-field provenance tracking. Visual estimates never overwrite user-reported values. Same-rank conflicts are registered, never silently resolved. Every field change keeps its full history.
- **5-step UI flow**: Input (scenario, notes, photo), Review (model output with evidence), Confirm (explicit per-bag quantity confirmation, step mapping, conflict resolution), Reassembly (reverse-order reference, gated behind full confirmation), History (complete audit trail).
- **Validation pipeline** (`public/sample-data.js`, `lib/validate-output.mjs`): structural validation of Meta JSON. Exactly bags A/B/C are required, quantities must be positive integers, evidence must be non-blank, and conflicts are derived from reports (imported conflict status is ignored).
- **Three test scenarios**: Normal (all data present), Missing (bag B has no quantity or step), Conflict (bag A reported as 6 and as 4). Each is backed by a saved Meta Playground response in `fixtures/meta/`.
- **Test suite**: 96 tests covering safeguard invariants, validation rules, fixture integrity, and UI contract checks.

## Meta model usage

- **Model**: `muse-wonder-1.0`, used through the Meta Model API / Meta Playground.
- **Task**: record extraction from a photo plus the user's panel-by-panel disassembly notes. The model returns a JSON proposal for each bag (A, B, C) with reported quantities, a step mapping, and evidence citations.
  - Conflict detection: when two panels report different counts for one bag, both values are returned.
  - Missing data: when notes do not give a quantity or step, those fields stay null and a follow-up question is asked.
  - Safety boundary: the model never sets `confirmed_quantity` or `safety_verified` to true. The app strips any such attempt and requires the user to confirm each quantity with an explicit click.
- **Saved responses**: the app currently runs on real `muse-wonder-1.0` responses captured in the Playground and stored in `fixtures/meta/` (`normal.json`, `missing.json`, `conflict.json`). The prompt used is `fixtures/meta/prompt.txt` and the matching notes are `fixtures/meta/inputs.json`.
- **Live mode (planned, not implemented)**: a server-side call using `META_API_KEY` (see `.env.example`) is planned. It does not work yet. There is no live API call anywhere in this repo today, and the key is never sent to the browser.

## Synthetic test image

`fixtures/synthetic-shelf.png` is an AI-generated synthetic test fixture (a 5-panel contact sheet of a bookshelf being disassembled). It is not a photo of a real disassembly. The app uses it only as a labeled sample photo.

## How to run

Requires Node.js 20 or newer. No dependencies to install.

```bash
node server.mjs
# http://127.0.0.1:4173
# Change port: PORT=3000 node server.mjs
```

Run tests from the repo root:

```bash
node --test
```

## Limitations

| Area | Status |
|------|--------|
| Live Meta API integration | Not implemented. Saved Playground responses only. |
| Image analysis | Local upload for preview only. No visual counting. |
| Multi-user support | Single browser, localStorage only. |
| Synthetic image | AI-generated test fixture, not a real disassembly. |
| Physical safety | Never guaranteed. `safe: false` is hardcoded. Torque, load, and structural safety are out of scope. |
| Server-side storage | None. |
| Authentication | None. |
| Furniture types | Fixed to one 3-bag bookshelf scenario. |

## File structure

```
server.mjs                   # Node HTTP server (zero deps)
lib/record.mjs               # Record safeguards (Node module)
lib/record.test.mjs          # Tests for the record module
lib/validate-output.mjs      # Proposal validator
public/                      # Static front end (index.html, app.js, style.css, ...)
test/app.test.mjs            # App, validation, and UI contract tests
fixtures/meta/               # Saved muse-wonder-1.0 responses, prompt, inputs
fixtures/synthetic-shelf.png # AI-generated test image
```

## License

MIT, see `LICENSE`.
