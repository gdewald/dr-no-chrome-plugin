# LiteRT + Firefox Mobile Prototype

**Status: prototype, emulator-tested 2026-07-18.** Code complete and
exercised end-to-end on a real Fenix/GeckoView (Firefox Nightly 154, Android
16 emulator); inference itself is platform-blocked, and that blockage is the
headline result. Details in [testing.md](testing.md).

## The outcome, in one paragraph

This prototype set out to make Dr. No's **on-device AI arbiter** — the model
that decides gray-zone queries the keyword tiers can't call — run everywhere
by carrying its own inference stack ([LiteRT](https://github.com/google-ai-edge/litert)
via the MediaPipe LLM web runtime + Gemma) instead of borrowing whichever AI
runtime the browser happens to expose. The engineering worked: the runtime
vendors into the extension, loads inside Firefox for Android, and every
stage up to token generation runs and degrades cleanly. What stops actual
inference is a single, precise platform gap — **the browser-capability
matrix**:

|  | Extensions | WebGPU | On-device arbiter possible? |
| --- | --- | --- | --- |
| Chrome — Android | ❌ | ✅ (since 2024) | ❌ no extension runtime at all |
| **Firefox — Android** | ✅ | ❌ (behind a flag; Mozilla's Android work planned for 2026) | **❌ engine can't start — yet** |
| Chrome — desktop | ✅ | ✅ | ✅ (already shipping, via Gemini Nano / Prompt API) |
| Firefox — desktop | ✅ | ✅ (Win 141+, macOS ARM 145+) | ✅ this branch's LiteRT backend |

**Android is not the limitation — Firefox-on-Android is.** The hardware and
OS run these exact models natively (LiteRT-LM, AICore, ML Kit), and Chrome
proves Android WebGPU works; Chrome just doesn't load extensions. Firefox
loads extensions but hasn't shipped its WebGPU port to Android. The arbiter
needs both in one browser, and no mobile browser offers that combination
today. Verified concretely: MediaPipe's LLM task on web is **WebGPU-only —
no WASM/CPU fallback** — so on today's Fenix, engine creation fails in ~16ms
("Unable to request adapter from navigator.gpu") and the arbiter reports
itself unavailable.

**Why this is a result and not a failure:** the prototype's degradation
contract held under real fire. On Fenix today, Dr. No installs, blocks, and
behaves exactly like the pre-AI static extension — the LiteRT backend ships
dormant and requires **zero code changes** to light up the moment Mozilla
ships Android WebGPU. The bet this branch makes is that the arbiter's
bring-your-own-runtime design is ready before the platform is, rather than
after.

## What was proven on-device (Fenix, emulator)

- Core blocking, popup (touch layout), options page, and the Android-aware
  status logic all pass — see the matrix in [testing.md](testing.md).
- The vendored LiteRT runtime **imports and initializes inside Fenix**
  (MV3 CSP with `wasm-unsafe-eval`, dynamic import, `moz-extension://`
  origin — all fine).
- OPFS model store, streaming download with progress, and every error path
  (HTTP 401, quota exceeded, missing WebGPU) surface cleanly and fall back
  to static behavior. Nothing breaks browsing.

## Secondary findings (each cost real debugging; all documented)

1. **Gemini Nano is not obtainable as weights** — platform APIs only
   (Chrome Prompt API, Android AICore). Gemma is the sanctioned stand-in.
   ([model-selection.md](model-selection.md))
2. **Every official LiteRT LLM bundle on Hugging Face is license-gated** —
   anonymous downloads get HTTP 401, so the extension's one-click model
   download cannot work without the user's own HF click-through. Unofficial
   mirrors exist and failed verification; don't.
3. **Fenix OPFS quota (~10% of free disk) rejects a 776MB model on
   small-disk devices**, and `web-ext --pref` quota lifts are ignored on
   Android. ([firefox-android.md](firefox-android.md))
4. **MediaPipe LLM web has no CPU path.** Any pre-WebGPU Android ambition
   needs a different engine (e.g. llama.cpp-WASM) — noted as a follow-up,
   out of scope for a LiteRT prototype.

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
- [testing.md](testing.md) — emulator session results, what has and hasn't
  been verified, the manual test matrix, known risks.

## Quick start (desktop Firefox, fastest loop)

```sh
# 1. Vendor the LiteRT web runtime (~55MB, gitignored)
sh tools/fetch-litert-runtime.sh

# 2. Swap in the Firefox manifest
cp manifest.firefox.json manifest.json

# 3. Load: about:debugging → This Firefox → Load Temporary Add-on → manifest.json

# 4. Options page → "Download model (~776 MB)" → wait → "Test the arbiter"
```

Note: step 4's download needs an HF-licensed copy of the model (finding #2
above) — see the `litertModelUrl` override in `src/arbiter-litert.js`.
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
