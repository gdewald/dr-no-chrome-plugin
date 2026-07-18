# LiteRT + Firefox Mobile Prototype

**Status: prototype.** Wired end-to-end, syntax-checked, desktop-load-tested;
**not yet run against a real model on a real Android device.** Read
[testing.md](testing.md) before trusting any of it.

This branch teaches Dr. No's on-device AI arbiter a third backend — a Gemma
LLM executed by the [LiteRT](https://github.com/google-ai-edge/litert) stack
compiled to WASM — and makes the Firefox build a first-class citizen on
**Firefox for Android**, the only mobile browser that can run the extension
at all.

## Why

The arbiter decides gray-zone queries ("side effects of old fuel on engine" —
allow; "birth control side effects" — block) that the static keyword tiers
can't call. Before this branch it had two backends, both desktop-bound:

| Backend | Where it works | Where it doesn't |
| --- | --- | --- |
| Chrome Prompt API (Gemini Nano) | Chrome desktop 138+ | All mobile Chrome (no extensions at all) |
| Firefox `browser.trial.ml` | Firefox desktop 134+ (Nightly prefs) | Firefox for Android — `trial.ml` not shipped |

Firefox for Android runs the whole extension *except* the arbiter, which
silently degrades to static fallbacks. The LiteRT backend closes that gap:
the extension carries its own inference runtime, so the arbiter no longer
depends on the browser exposing one.

## What's in the box

| Piece | File | Notes |
| --- | --- | --- |
| LiteRT backend | `src/arbiter-litert.js` | Runtime loading, OPFS model store, Gemma prompt, YES/NO classify |
| Backend chain | `src/background.js` | Chrome → `trial.ml` → LiteRT, with fallthrough on per-call failure |
| Options UI | `src/options.js` / `.html` | `litert-*` states, streaming model download with progress, delete |
| Android manifest | `manifest.firefox.json` | `gecko_android`, `wasm-unsafe-eval` CSP, background script order |
| Responsive popup | `src/popup.html` | Full-width + bigger tap targets on coarse-pointer devices |
| Runtime vendoring | `tools/fetch-litert-runtime.sh` | Pulls the WASM runtime into gitignored `src/vendor/litert/` |

## Detailed notes

- [architecture.md](architecture.md) — how the backend plugs in: lifecycle,
  storage, prompt format, CSP, why Chrome can't host this backend yet.
- [model-selection.md](model-selection.md) — Gemini Nano vs Gemma 3n E2B q4_0
  vs Gemma 3 1B q4_0: what's actually obtainable, sizes, licensing gates, and
  how to switch models.
- [firefox-android.md](firefox-android.md) — the mobile support story:
  platform constraints, manifest keys, WebGPU status, memory realities,
  install-on-device recipes.
- [testing.md](testing.md) — what has and hasn't been verified, the manual
  test matrix, expected latencies, known risks.

## Quick start (desktop Firefox, fastest loop)

```sh
# 1. Vendor the LiteRT web runtime (~55MB, gitignored)
sh tools/fetch-litert-runtime.sh

# 2. Swap in the Firefox manifest
cp manifest.firefox.json manifest.json

# 3. Load: about:debugging → This Firefox → Load Temporary Add-on → manifest.json

# 4. Options page → "Download model (~776 MB)" → wait → "Test the arbiter"
```

Restore the Chrome manifest afterwards with `git checkout manifest.json`.

## Non-goals of this prototype

- **No Chrome LiteRT backend.** Chrome's classic MV3 service worker can't
  `import()` the runtime; it would need an offscreen document. Chrome desktop
  already has Gemini Nano natively, and mobile Chrome has no extensions, so
  there is nothing to win today. ([architecture.md](architecture.md#why-not-chrome))
- **No model auto-download.** Hundreds of MB never move without an explicit
  user gesture on the options page.
- **No AMO submission.** `strict_min_version` and the experimental CSP need a
  review pass first; this branch is for sideloading and evaluation.
