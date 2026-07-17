# Dr. No 🩺🚫 — Medical Search Blocker

A tiny Chrome extension that stops you from googling your symptoms or spiraling on
WebMD. When it catches a medical search or a known medical site, it hard-blocks the
page with a friendly little ASCII character and a "take me back to safety" button —
no bypass.

> Not medical advice, and not a substitute for one. If you're genuinely worried,
> call a real human doctor.

## What it blocks

- **Medical search queries** on Google, Bing, DuckDuckGo, Yahoo, Ecosia, Startpage,
  Brave, and Qwant — when the query contains medical terms (symptoms, conditions,
  drug/dosage words, or anxious phrases like "am I dying").
- **Known medical sites** — WebMD, Mayo Clinic, Healthline, Drugs.com, MedlinePlus,
  NIH, Cleveland Clinic, and more.

Both lists are extendable on the options page.

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
