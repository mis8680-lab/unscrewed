# Unscrewed design plan

Tagline: Take it apart. You're not screwed.

Mode: product UI (operate). A person is kneeling next to a taken-apart shelf or gadget, phone in one hand, and needs to record steps, check bag counts, and trust the result. Scanability and unmistakable state beat expression. The brand lives in a few precise details.

Audience: people taking furniture or gadgets apart at home to move, fix, or store them.
Primary job: record each step (photo plus one line), let Meta muse-wonder-1.0 draft a bag-by-bag record, make the person confirm every count, then show the steps in reverse for putting it back.
Use scene: bright garage or living room, phone or laptop on a workbench. So: light theme only, large touch targets, high contrast. The old dark-mode switch is removed.

## Color (6 named values)

| Name | Hex | Job |
|---|---|---|
| Manual paper | #F2F3EF | page ground, a cool grey-white like a printed assembly sheet |
| Pen ink | #1E2F3A | text, drawn outlines, header band |
| Masking tape | #E2CC94 | the one warm color: tape labels (wordmark, bag letters) and text selection |
| Ballpoint blue | #1D4E89 | primary actions, links, focus ring |
| Marker red | #B3261E | disagreeing counts, missing data, the safety notice |
| Check green | #2B6A42 | a bag the person has confirmed |

Supporting values derived from these: muted text #4A5962 (6.5:1 on paper), rule grey #C5CBCB, bag plastic #FAFBFA. Every pair used for text is at least 4.5:1.

## Type

- Atkinson Hyperlegible Next (OFL, self-hosted variable woff2, 400 to 800). Everything: body, controls, headings. Chosen for letterform clarity at arm's length (distinct 1, l, I, 0, O), which matters when the data is screw counts. Headings use 700 and a tighter line height, not a second face.
- Caveat Brush (OFL, self-hosted). Only the bag letters A, B, C on the tape labels and the wordmark, as if written with a marker. Nothing else uses it.
- Scale (1.25 ratio, rem): 0.8125 / 1 / 1.25 / 1.5625 / 2. Body 1rem, line height 1.5, measure capped at 62ch. Numbers in forms use tabular figures.
- No monospace anywhere, no all caps, no eyebrow labels.

## Layout concept

One working column per step on phones. On wide screens the step uses the width the way a workbench does: the photo stays pinned on the left while notes scroll on the right, and the three bags sit side by side like bags laid out on a table. Content is left-aligned, never centered. No stack of identical rounded cards: sections are separated by a rule and a heading, and only the things that are physical objects (bags, tape) get a drawn container.

Signature move: the bag. Each of A, B, C is drawn as a zip bag (zipper line along the top, rounded bottom corners, clear-plastic fill) with a masking-tape label carrying the letter in marker handwriting. The bag's border tells state without color alone: solid for reported, dashed red for missing, double red for disagreeing counts, solid green with a check for confirmed. The wordmark sits on the same tape. That is the single memorable element; everything else stays quiet.

### Input

```
+--------------------------------------------------------------+
| [Unscrewed tape]                  Using saved Meta responses  |
| 1 Add steps | 2 Check | 3 Confirm | 4 Put back | 5 Activity   |
+--------------------------------------------------------------+
| Take it apart, write one line per step, bag the screws.      |
| Unscrewed asks Meta to draft what is in each bag. You confirm |
| the counts, then get the steps in reverse.                   |
|                                                              |
| Try a sample:  (Normal) ( Missing bag ) ( Conflicting counts)|
|                                                              |
| +----------------------+  Notes for each step                |
| | [test photo, 5 steps]|  Step 1 [ Fully assembled.       ]  |
| | AI-generated test    |  Step 2 [ Removed back panel...  ]  |
| | photo.               |  Step 3 [ ...                    ]  |
| | [Choose a photo]     |  Step 4 [ ...                    ]  |
| +----------------------+  Step 5 [ ...                    ]  |
|                           [ Build bag record ] [ Live Meta ] |
+--------------------------------------------------------------+
```

### Review

```
| This is a saved Meta response, not a live call. Meta only    |
| suggests. Nothing counts until you confirm it.               |
|                                                              |
|  .----A----.   .----B----.   .----C----.                     |
|  |tape A   |   |tape B   |   |tape C   |                     |
|  |Reported |   |Reported |   |Disagree |                     |
|  |step 2:4 |   |step 3:4 |   |2: 6/5: 4|                     |
|  '---------'   '---------'   '---------'                     |
| Meta's questions        What Meta can't see in the photo     |
| Disagreements: Bag A, step 2 says 6, step 5 says 4.          |
| [Back to add steps]                  [Continue to confirm]   |
| > Paste a Meta response (folded)                             |
```

### Confirm

```
| Confirm each bag                                             |
| Count the screws yourself. A bag counts only when you press  |
| its Confirm button.                                          |
|  .---A---.            .---B---.            .---C---.         |
|  |Screws in bag A     |...                 |...              |
|  |[ 4 ]               |                    |                 |
|  |Put in at step [2 v]|                    |                 |
|  |[Confirm bag A]     |                    |                 |
| Put-back reference stays locked until:                       |
|   - every bag is confirmed  - disagreements are settled      |
|   - every bag has a step                                     |
| [Back to check]                     [Continue to put back]   |
```

### Reassembly (put back)

```
| Put it back: your steps in reverse                           |
| +----------------------------------------------------------+ |
| | Not assembly instructions. This replays what you wrote    | |
| | down. It does not show the furniture is safe to use.      | |
| +----------------------------------------------------------+ |
| Bags you confirmed:  [A 4 screws, step 2] [B ...] [C ...]    |
| ------------------------------------------------------------ |
|  5   Laid out the wood parts and bags.        put back 1 of 5|
|      (tape A) Bag A: you confirmed 4 screws                  |
| ------------------------------------------------------------ |
|  4   ...                                                     |
```

## Principles

1. State is readable without color: shape, border style, and words say confirmed, disagreeing, missing.
2. The model suggests, the person confirms. Every suggestion is labeled as Meta's; every confirmation is labeled as yours.
3. One signature element (the labeled bag), one warm color (tape), everything else paper and ink.
4. Copy is the person's: bags, screws, steps, photos. No field names, no status codes.
5. Quiet motion only in answer to an action: a confirmed bag draws its check once.

## Review against the AI-tell list

Plan v1 and what was revised:

| Tell | In plan v1 | Revision and why |
|---|---|---|
| Cream plus terracotta | Tape tan on a warm off-white ground | Ground changed to a cool grey-white (#F2F3EF) and tan restricted to tape objects and selection. No terracotta. Warm color now means "a physical label", not mood. |
| Black plus acid accent | Ink header with a bright accent | Header ink is blue-black and the only accent is a conventional ballpoint blue for actions. No acid green or vermilion. Red is reserved for real problems. |
| SaaS card kit, same radius, soft shadows | Cards for each section | Removed cards. No box shadows at all. Sections are ruled. Radii differ by object: 3px controls, 6px/14px bag shape, 0 for notices. |
| Gradient washes | Sample and live banners were purple and green gradients | Gradients deleted. Source notice is a plain ruled block with a text label. |
| All-caps eyebrow labels | Small caps label over each section | Not used. Headings stand alone. |
| Middle-dot meta strings | "Step 5 / Evidence: panel5", "Meta model - 4.2s, tokens" | Replaced with short sentences ("From step 5"). |
| Arrow suffix on buttons | "Continue ->" | Not used. Buttons are verb phrases. |
| Mono data labels | Mono for quantities | No monospace face. Quantities use tabular figures in the body face. |
| One-word color accent in headings | Colored word in titles | Not used. |
| Identical numbered markers | Numbers on every section | Numbers only on the step tabs and the reverse list, which are real sequences. |
| Colored left border on alerts | The old UI used 3 to 4px colored left borders | Removed. Alerts use full outlines plus a text label. |
| Emoji and glyph icons | "[SAMPLE]", "[LIVE]", "[!]" text badges | Removed. One drawn SVG check mark. |
| Dark mode switch | Kept from the old UI | Dropped: the use scene is a lit workbench, and two themes doubles the contrast checks. |

Impeccable anti-patterns checked: no nested cards, no gradient text, no glass, no hard offset shadows, no hero-metric block, no modal for a non-blocking task (the paste-a-response form is a disclosure, not a dialog), icons are drawn in one stroke weight, copy names the action and the recovery.

## Meta features in the interface (added late)

These keep the workbench and labeled-bag look. No new colors, no new fonts.

- **Steps are rows on the workbench.** Each step is a row: step number, an optional photo slot (own-record mode), the note box, a small outline "Record note" button and, in own-record mode, a quiet "Remove step N" text button. "Add step" sits under the list as an outline button. Two to twelve steps. Sample mode keeps the single contact-sheet photo for its five steps.
- **Voice** is a plain outline button that turns marker red while recording ("Stop recording"). After a transcript lands, "Transcribed by Meta. Check it." sits under the note in bold ink until the person edits the text. Without a key the button is disabled and the reason is written next to it.
- **Seen in your photo (check it)** is the only italic text in the product, in a white box with a thin dashed rule. Italic text means "Meta's guess, not your record". It appears under each step on Check and under the step's note on Put back. It never uses the green of a confirmed bag and never sits inside a bag.
- **Bags are variable.** The bag row shows one zip bag per letter the notes mention, A to H, using the same label and border states.
