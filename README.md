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
(`src/block.css`) with the chosen character from `src/data.js`. No build step, no
dependencies.

```
manifest.json        MV3 manifest
src/data.js          keyword list, domain list, search engines, ASCII characters
src/detect.js        pure detection helpers (site / query / keyword matching)
src/block.js         content script — detect + render the block overlay
src/block.css        overlay styling
src/options.html/js  options page
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

## Known limitations

- The underlying page still loads in the background (the overlay covers it). Fine for a
  nudge tool; could be hardened later with `declarativeNetRequest`.
- Blocking is evaluated at page load. Search engines that update results via in-page
  navigation without a full reload won't be re-checked until the next load.
