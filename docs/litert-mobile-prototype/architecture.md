# Architecture — the LiteRT arbiter backend

## Where LiteRT actually enters the picture

"Use LiteRT in a browser extension" resolves to a specific stack, because the
[google-ai-edge/litert](https://github.com/google-ai-edge/litert) ecosystem
splits by platform:

- **LiteRT (core)** — the C++/mobile successor to TensorFlow Lite. Not
  directly loadable in a web page.
- **LiteRT.js** — LiteRT for the web (WASM + WebGPU), but aimed at classic
  tensor models; it has no LLM pipeline (no KV cache, tokenizer, or sampling
  loop).
- **LiteRT-LM** — the LLM runtime over LiteRT, C++ API, consumes
  `.litertlm`/`.task` bundles. No browser build published.
- **MediaPipe LLM Inference (`@mediapipe/tasks-genai`)** — Google's web
  packaging of the same engine: the LiteRT/XNNPACK runtime compiled to WASM
  plus the LLM plumbing, consuming the same `.task`/`.litertlm` bundles the
  native runtimes use.

The prototype therefore vendors `@mediapipe/tasks-genai` (0.10.29). It *is*
the LiteRT runtime for our purposes — same engine, same model format — just
shipped under the MediaPipe name. If LiteRT-LM grows a first-party WASM/JS
API, `src/arbiter-litert.js` is the only file that should have to change.

## Component map

```
content script (block.js)
    │  DR_NO_CLASSIFY message (unchanged)
    ▼
background event page (background.js)
    │  classify(): backend chain with fallthrough
    │    1. Chrome Prompt API   (chromePromptApi)
    │    2. Firefox trial.ml    (firefoxMlApi)
    │    3. LiteRT              (litertApi → DR_NO_LITERT)
    ▼
arbiter-litert.js  (also loaded by options.html)
    │  import(src/vendor/litert/genai_bundle.mjs)   ← vendored runtime
    │  FilesetResolver.forGenAiTasks(…/wasm)        ← WASM engine
    │  LlmInference.createFromOptions(...)
    ▼
OPFS: dr-no-models/gemma3-1b-it-q4_0-web.task      ← user-downloaded model
```

The message contract, verdict cache (`storage.session`, 500 entries), the
content script's 3.5s answer budget, and the per-shape static fallbacks are
all untouched — a missing/slow LiteRT backend behaves exactly like a missing
model always has.

### Backend chain semantics (changed)

`classify()` used to pick one backend by existence and let its failure
propagate. It now tries each *existing* backend in order and falls through on
call-time failure. The case that motivated this: on Firefox for Android with
the `trialML` permission granted, `browser.trial.ml` may exist as an API
surface while its engine can't actually run — previously that error ended
classification; now LiteRT gets its shot before the static fallback does.

## The runtime: vendored, never remote

MV3 forbids remotely hosted code, so `genai_bundle.mjs` + 4 WASM/JS engine
files (~55MB — both SIMD and no-SIMD engines) are fetched at dev time by `tools/fetch-litert-runtime.sh` into
`src/vendor/litert/` (gitignored). `arbiter-litert.js` discovers it with a
cached dynamic `import()`; if absent, `status()` reports `litert-no-runtime`
and `background.js` maps that to plain `unsupported` — the pre-prototype
behavior.

Two manifest consequences (`manifest.firefox.json`):

- `"content_security_policy": { "extension_pages": "script-src 'self'
  'wasm-unsafe-eval'; object-src 'self'" }` — MV3's default extension CSP
  blocks WASM compilation without `wasm-unsafe-eval`.
- `"background": { "scripts": ["src/arbiter-litert.js", "src/background.js"] }`
  — classic scripts share one global scope; the module publishes
  `globalThis.DR_NO_LITERT` before `background.js` looks for it.

## The model: OPFS, streamed, user-initiated

The model (~776MB) lives in the extension origin's **Origin Private File
System** under `dr-no-models/`. Both the options page and the background page
see the same OPFS because they share the `moz-extension://` origin.

- **Download** happens in the options page (needs a user gesture and a
  progress bar): `fetch` → `ReadableStream` reader → OPFS
  `createWritable()`, chunk by chunk. Peak JS memory is one network chunk,
  not 776MB. A failed download aborts the writable and removes the entry —
  OPFS staging semantics mean a partial file is never visible to readers.
- **Load** happens in the background page at first classify (or warmup):
  `URL.createObjectURL(opfsFile)` handed to `modelAssetPath`, so the WASM
  loader streams from disk instead of JS materializing the buffer.
- **Delete** is a button on the options page.

Trade-off noted: engine creation still ends with the whole model resident in
WASM memory — that's inherent to inference, not to the loading path. See
[firefox-android.md](firefox-android.md#memory) for what that means on a
phone.

## Prompt format

The Chrome backend's `SYSTEM_PROMPT` + `FEW_SHOT` pairs stay the single
source of truth for what "medical" means; `background.js` passes them into
`DR_NO_LITERT.classify(key, system, fewShot)`. The LiteRT backend rewraps
them in Gemma's instruction markup (Gemma has no system role, so the system
text is folded into the first user turn):

```
<start_of_turn>user
{system}

why does my back keep clicking<end_of_turn>
<start_of_turn>model
YES<end_of_turn>
…
<start_of_turn>user
{query}<end_of_turn>
<start_of_turn>model
```

Decoding is pinned deterministic (`topK: 1`, `temperature: 0`,
`randomSeed: 1`); output parsing is the same `/^\s*yes/i` the Chrome path
uses. `maxTokens: 512` covers prompt + few-shot (~200 tokens) with room to
spare — the answer itself is one word.

## Warmup policy

Engine creation loads ~776MB into RAM, so it must never happen behind the
user's back:

- `onStartup`/`onInstalled` warmup remains **Chrome-only**.
- LiteRT warms **only** when the options page's status poll observes
  `litert-ready` — i.e. the user is actively on the settings page with a
  downloaded model. First real-world query after a browser restart will
  otherwise pay the cold load and (deliberately) fall back statically if it
  blows the 3.5s budget; the cache remembers the verdict for next time.

This is the prototype's biggest UX weakness on mobile — see
[testing.md](testing.md#known-risks).

## Status surface

`aiStatus()` order: Chrome availability → `trial-ml` → LiteRT
(`litert-ready` / `litert-needs-model`; `litert-no-runtime` collapses to
`unsupported`). The options page adds one Android-specific wrinkle: on
desktop Firefox without the `trialML` grant it still suggests the grant first
(70MB model beats 776MB), but on Android — detected via UA — the grant button
is a dead end (`trial.ml` isn't shipped there), so the LiteRT states win.

## Why not Chrome?

Chrome's MV3 background is a **classic service worker**: dynamic `import()`
is unavailable there, and `@mediapipe/tasks-genai` also expects DOM-ish
globals a SW lacks. The clean Chrome route is an offscreen document hosting
the engine, with the SW proxying classify messages — real work, and zero
payoff today: desktop Chrome already has Gemini Nano via the Prompt API and
mobile Chrome cannot load extensions at all. `manifest.json` (Chrome) is
untouched on this branch.
