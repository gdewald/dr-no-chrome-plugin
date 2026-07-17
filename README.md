# Dr. No 🩺🚫 — Medical Search Blocker

A tiny Chrome extension that stops you from googling your symptoms or spiraling on
WebMD. When it catches a medical search or a known medical site, it hard-blocks the
page with a friendly little ASCII character and a "take me back to safety" button —
no bypass.

> Not medical advice, and not a substitute for one. If you're genuinely worried,
> call a real human doctor.

## What it blocks

- **Medical search queries** on Google, Bing, DuckDuckGo, Yahoo, Ecosia, Startpage,
  Brave, and Qwant.
- **Known medical sites** — WebMD, Mayo Clinic, Healthline, Drugs.com, MedlinePlus,
  NIH, Cleveland Clinic, and more.

Both lists are extendable on the options page.

### How a query is judged

Vague phrasings like "do i have" are grammar, not medicine — matching them outright
blocks "do i have to pay taxes". So queries are judged in tiers (see `src/detect.js`):

| tier | rule | example |
| --- | --- | --- |
| 1 | an unambiguously medical term, alone | `diabetes`, `ibuprofen dosage` |
| 2 | a body part **and** a sensation | `knee hurts`, `back pain` |
| 3 | a body part **and** a question framing | `why does my knee click` |

Tiers 2 and 3 both require a body part, which is what keeps "why does my car shake"
out. Tier 3 additionally ignores body parts that double as everyday words
(`AMBIGUOUS_PARTS`), since a framing alone can't separate "why does my back hurt"
from "why does my back button not work" — only a sensation can.

Terms you add yourself on the options page are treated as tier 1 and block on their own.

### The gray zone: on-device AI arbiter

Word lists can't call everything. Two query shapes are suspicious but unprovable:

- an ambiguous body part with a question framing — "why does my back keep clicking"
  vs "why does my back button not work"
- a sensation with no body part — "itchy all over" vs "lump sum tax"

The static tiers deliberately allow all of these (false positives are worse than
misses for a hard-block tool). With the AI arbiter enabled, such queries are instead
escalated to **Chrome's built-in on-device model (Gemini Nano, via the Prompt API)**,
which answers medical-or-not per query. YES blocks; NO (or any failure) falls back to
the static verdict and the page loads.

Properties:

- **Fully on-device and offline.** The model ships with Chrome's built-in AI; the
  extension makes zero network requests. Nothing about your searches leaves the machine.
- **Fail-open.** No model, unsupported Chrome, slow answer (>3.5s), dead service
  worker — all fall back to exactly the old static behavior. The arbiter can only
  ever add blocks for gray queries, never remove static ones.
- **Cached.** Verdicts are cached per normalized query (`chrome.storage.session`),
  so a repeated search never waits on the model twice.
- **Requirements:** Chrome 138+, and the built-in model available on the device
  (Chrome gates it on hardware — roughly a few GB of free disk and a capable
  GPU/CPU). The options page shows model status and a download button if the model
  isn't installed yet. The arbiter can be turned off there too.

While the arbiter thinks, the page stays hidden (same no-flash trick as static
matches), then either the overlay renders or the page is revealed.

## Tests

Open `test/detect.test.html` in a browser. It exercises `src/detect.js` against a table
of queries that must block and must not, and prints a pass/fail summary. Worth a look
after editing any list in `src/data.js`.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).

The Dr. No icon appears in the toolbar.

## Configure

- **Popup** (click the toolbar icon): quick on/off switch.
- **Options** (right-click the icon → Options, or the "Settings & characters" link in
  the popup): enable/disable, add custom blocked terms, add custom blocked sites, and
  pick your ASCII character (waving cat, shrugging bear, robot doctor, wise owl).

Settings sync via `chrome.storage.sync`.

## How it works

A single content script (`src/block.js`) runs at `document_start` on every page. It
reads your settings, then checks the URL against the built-in + custom lists using the
pure helpers in `src/detect.js`. On a match it paints a full-screen overlay
(`src/block.css`) with the chosen character from `src/data.js`. Gray-zone queries are
sent to the background service worker (`src/background.js`), which prompts the
on-device model and returns a verdict. No build step, no dependencies.

```
manifest.json        MV3 manifest
src/data.js          keyword list, domain list, search engines, ASCII characters
src/detect.js        pure detection helpers (site / query / keyword / gray matching)
src/block.js         content script — detect + escalate gray queries + render overlay
src/background.js    service worker — on-device AI arbiter (Prompt API / Gemini Nano)
src/block.css        overlay styling
src/options.html/js  options page (incl. AI arbiter status + model download)
src/popup.html/js    toolbar popup (on/off)
icons/               toolbar icons (16/48/128)
```

## Manual test checklist

1. **Query block** — search Google for `headache symptoms` → overlay appears; "Take me
   back to safety" returns to the previous page.
2. **Non-medical** — search Google for `pizza near me` → page works normally.
3. **Site block** — visit `https://www.webmd.com` → overlay appears at load.
4. **Custom rules** — on the options page add a term (e.g. `sniffle`) and a site; Save;
   confirm both now block.
5. **Toggle off** — flip the popup switch; confirm a medical search no longer blocks.
6. **AI arbiter** (needs the model installed — check the options page) — search Google
   for `why does my back keep clicking` → brief pause, then overlay with "confirmed
   on-device"; search `lump sum tax` → brief pause on first run, then loads normally,
   and instantly on a repeat (cached verdict).
7. **AI fail-open** — on a Chrome without the model, both searches above load normally
   after at most ~3.5s.

## Known limitations

- The underlying page still loads in the background (the overlay covers it). Fine for a
  nudge tool; could be hardened later with `declarativeNetRequest`.
- Blocking is evaluated at page load. Search engines that update results via in-page
  navigation without a full reload won't be re-checked until the next load.
- The AI arbiter only ever escalates (gray → block). It deliberately cannot veto a
  static match: a wrong "not medical" from a small model would silently punch a hole
  in the hard block, and the static tiers are already tuned to near-zero false
  positives. Loosen a list instead if a static rule annoys you.
- Gemini Nano availability is Chrome's call (version + hardware gates). Everything
  degrades to pure static matching when it's absent.
