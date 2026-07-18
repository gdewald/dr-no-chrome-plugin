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

Word lists can't call everything. Three query shapes are suspicious but unprovable:

- an ambiguous body part with a question framing — "why does my back keep clicking"
  vs "why does my back button not work"
- a sensation with no body part — "itchy all over" vs "lump sum tax"
- a medical-leaning phrase with a non-medical life (`AMBIGUOUS_KEYWORDS`, e.g.
  "side effects") — "birth control side effects" vs "side effects of old fuel
  on engine"

Such queries are escalated to **Chrome's built-in on-device model (Gemini Nano, via
the Prompt API)**, which answers medical-or-not per query. YES blocks, NO loads the
page. Each shape also carries a **no-AI fallback** that preserves the static
behavior from before the arbiter existed: the two suspicion shapes fall back to
*allow* (the tiers always let them through), while `AMBIGUOUS_KEYWORDS` fall back to
*block* (they used to be tier 1 — the model can rescue "side effects of old fuel on
engine", but without a model it blocks exactly as it always did).

Properties:

- **Fully on-device and offline.** The model ships with Chrome's built-in AI; the
  extension makes zero network requests. Nothing about your searches leaves the machine.
- **No AI, no change.** Unsupported Chrome, model not installed, slow answer
  (>3.5s), dead service worker, or the arbiter toggled off — every path resolves
  to each shape's fallback, which is exactly the pre-AI static behavior.
- **Cached.** Verdicts are cached per normalized query (`chrome.storage.session`),
  so a repeated search never waits on the model twice.
- **Warmed up.** The worker loads the model at browser startup and when the options
  page sees it become available, so the first real query doesn't pay the cold-start
  cost (a cold first prompt can exceed the 3.5s budget and fall back).
- **Testable.** The options page has a "Test the arbiter" box that runs any query
  through the exact same path a real search uses and reports the verdict, the
  latency, whether it was cached, and any error — use it when a search didn't do
  what you expected.
- **Requirements:** Chrome 138+, and the built-in model available on the device
  (Chrome gates it on hardware — roughly a few GB of free disk and a capable
  GPU/CPU). The options page shows live model status, a download button if the
  model isn't installed yet, and a progress bar while it downloads (the download
  is Chrome-managed and continues even if the page is closed; the page polls
  every 2s, so status updates without a reload). The arbiter can be turned off
  there too.

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

## Firefox (experimental scaffold — untested)

Firefox has no Prompt API; the closest analog is the **Firefox AI Runtime**
(`browser.trial.ml`, Firefox ~134+, experimental). The worker picks its backend at
runtime, so the same code runs in both browsers: on Firefox the arbiter uses
zero-shot NLI classification (`Xenova/nli-deberta-v3-xsmall`, ~70MB, downloaded by
Firefox on first use) instead of a generative model — same message contract, same
cache, same fallbacks.

To try it:

1. In `about:config`, make sure `browser.ml.enable` **and** `extensions.ml.enabled`
   are `true` (both default on in Nightly; Beta/Release need them flipped).
2. Swap in the Firefox manifest (Firefox needs `background.scripts` + a gecko id
   and the optional `trialML` permission Chrome doesn't know, hence two manifests):
   `cp manifest.firefox.json manifest.json` — restore with `git checkout manifest.json`.
3. `about:debugging` → This Firefox → **Load Temporary Add-on** → pick `manifest.json`.
4. Grant host access (Firefox MV3 host permissions are opt-in), then open the
   options page and click **Enable on-device AI** — `trialML` is a *trial*
   permission, which can only be granted at runtime, so until this button is
   clicked `browser.trial.ml` doesn't exist and the arbiter reports itself
   unavailable.
5. Use **Test the arbiter** — the first ask triggers the model download.

Or let [web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
handle the manifest-swapped checkout for you:

```
npx web-ext run --firefox <path-to-nightly> \
  --pref browser.ml.enable=true --pref extensions.ml.enabled=true
```

Caveats: the `trial.ml` path has not been exercised against a live Firefox AI
Runtime; the zero-shot labels and the 0.5 threshold in `src/background.js` need
validating against the gray-zone twins before trusting verdicts. Chrome behavior is
untouched by any of this.

### Firefox for Android + LiteRT (prototype)

This branch adds a third arbiter backend — a Gemma model run by the
[LiteRT](https://github.com/google-ai-edge/litert) WASM runtime, vendored into the
extension — so the arbiter can work on **Firefox for Android**, where `trial.ml`
doesn't exist. Vendor the runtime with `sh tools/fetch-litert-runtime.sh`, then
download the model from the options page. Detailed notes, install recipes, and the
test matrix live in [docs/litert-mobile-prototype/](docs/litert-mobile-prototype/README.md).

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
manifest.json          MV3 manifest (Chrome)
manifest.firefox.json  MV3 manifest (Firefox — optional trialML permission, event page, gecko id)
src/data.js            keyword list, domain list, search engines, ASCII characters
src/detect.js          pure detection helpers (site / query / keyword / gray matching)
src/block.js           content script — detect + escalate gray queries + render overlay
src/background.js      background worker — AI arbiter (Chrome: Prompt API / Gemini Nano;
                       Firefox: trial.ml zero-shot, experimental)
src/arbiter-litert.js  LiteRT arbiter backend (prototype — Gemma via vendored WASM
                       runtime; the Firefox-for-Android path)
tools/fetch-litert-runtime.sh  vendors the LiteRT web runtime into src/vendor/ (gitignored)
docs/litert-mobile-prototype/  detailed prototype notes (architecture, models, Android, testing)
src/block.css          overlay styling
src/options.html/js    options page (incl. AI arbiter status + model download)
src/popup.html/js      toolbar popup (on/off)
icons/                 toolbar icons (16/48/128)
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
7. **No-AI fallback** — on a Chrome without the model (or with the arbiter toggled
   off), `why does my back keep clicking` loads normally after at most ~3.5s, and
   `side effects of old fuel on engine` shows the overlay — identical to the
   pre-AI static behavior in both directions.

## Known limitations

- The underlying page still loads in the background (the overlay covers it). Fine for a
  nudge tool; could be hardened later with `declarativeNetRequest`.
- Blocking is evaluated at page load. Search engines that update results via in-page
  navigation without a full reload won't be re-checked until the next load.
- The AI arbiter cannot veto a `MEDICAL_KEYWORDS` / tier 2 / tier 3 match: a wrong
  "not medical" from a small model would silently punch a hole in the hard block,
  and the static tiers are already tuned to near-zero false positives. The one
  place it may clear a query is `AMBIGUOUS_KEYWORDS` — terms demoted out of tier 1
  precisely so the model can rescue their non-medical uses, and which block
  exactly as before whenever the model is absent.
- Gemini Nano availability is Chrome's call (version + hardware gates). Everything
  degrades to pure static matching when it's absent.
