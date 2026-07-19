# Model selection — Gemini Nano, Gemma 3n E2B, and what actually ships

The prototype was asked to run **Gemini Nano, or Gemma E2B q4_0**, via
LiteRT. Here is what each of those means in practice and why the default
landed where it did. Facts below were verified against Hugging Face and npm
on 2026-07-18.

## Gemini Nano: not obtainable as weights

Gemini Nano is **not distributable**. There is no public checkpoint, no
`.task`/`.litertlm` bundle, no license under which an extension may ship or
download it. It is only reachable through platform APIs that keep the weights
inside the platform:

- **Chrome's Prompt API** (`LanguageModel`, Chrome 138+) — this is already
  Dr. No's Chrome backend. That backend *is* "the AI arbiter leveraging
  Gemini Nano"; it just rides Chrome's copy instead of ours.
- **Android AICore / ML Kit GenAI** — reachable from Android *apps*, not from
  web content or extensions. A GeckoView-level integration could in theory
  bridge it, but that's a Firefox-platform feature request, not an extension
  patch.

So on any surface where we must bring our own model, Gemini Nano is off the
table by policy, not by engineering. The open-weights Gemma family is
Google's own designated substitute for exactly this situation.

## Gemma 3n E2B (q4_0 ≈ int4): obtainable, but gated and heavy

Gemma 3n E2B is the closest open model to "Nano-class" — it's the same
architecture family Google ships on-device (MatFormer with per-layer
embeddings; "E2B" = *effective* 2B parameters, ~5B raw with ~2B resident
per token).

Practical findings:

- **The LiteRT bundles are license-gated.** Both
  `litert-community/gemma-3n-E2B-it` and the `google/gemma-3n-E2B-it-litert-*`
  repos answer anonymous requests with **HTTP 401**: you must accept the
  Gemma license on Hugging Face and use an access token to download. That
  breaks the extension's one-click model download for anyone who hasn't done
  the HF dance, and hardcoding a token is obviously out.
- **Size.** The int4 (q4_0-equivalent) E2B bundle is roughly **3GB** —
  4× our default, in RAM as well as on disk, on devices where the whole
  browser gets a couple of GB before Android kills it.
- **Naming note.** "q4_0" is llama.cpp/GGUF vocabulary; the LiteRT world
  labels the same idea `int4`. The `litert-community` repos even publish
  files with `q4_0` in the name for some models, which is what we use below.

**Verdict:** right model *class*, wrong first prototype target. Supported as
a manual swap (below), not as the default.

## Default: Gemma 3 1B IT, q4_0, web bundle

The prototype defaults to
[`litert-community/Gemma3-1B-IT`](https://huggingface.co/litert-community/Gemma3-1B-IT):

```
gemma3-1b-it-q4_0-web.task    776 MB   ← default (q4_0, web-optimized)
gemma3-1b-it-int4-web.task    700 MB   (alternative int4 web build)
gemma3-1b-it-int8-web.task   1.01 GB   (if q4 quality disappoints)
```

Why it wins for a prototype:

- **Least-gated.** ~~Ungated~~ — **correction (2026-07-18, found during
  emulator testing):** the repo's file *listing* is public, but `/resolve/`
  downloads answer **HTTP 401** anonymously. The whole `litert-community`
  org (and `google/*-litert-*`) is license-gated; Gemma3-1B-IT is merely
  auto-gated (instant click-through with any HF account) where E2B needs the
  full Gemma license flow. The extension's one-click download therefore
  fails out of the box with a clean, retryable error — by design it cannot
  embed anyone's HF token. To supply the model: accept the license on
  huggingface.co, download the `.task` file yourself, and use the
  `litertModelUrl` override in `src/arbiter-litert.js` (serve the file
  locally, e.g. `python -m http.server` + `http://10.0.2.2:8765/…` from an
  emulator).
  Do **not** grab it from unofficial HF mirrors: the one existing mirror of
  this file was checked and its LFS sha256 does not match the official
  bytes at identical size — treat that as disqualifying.
- **Web-targeted.** The `-web.task` builds are packaged for exactly the WASM
  runtime we vendor (`@mediapipe/tasks-genai`), which is the LiteRT engine
  compiled for the browser.
- **Sized for phones.** ~776MB on disk / in memory is plausible on a 6-8GB
  Android device; ~3GB is not.
- **Task-adequate.** The arbiter needs a binary YES/NO with six few-shot
  examples, not open-ended generation. 1B-at-q4 handles the gray-zone twins
  in informal spot checks of similar setups; [testing.md](testing.md) defines
  the real acceptance gate (the `test/detect.test.html` twin pairs).

## Switching models

Everything model-specific is one constant in `src/arbiter-litert.js`:

```js
const MODEL = {
  id:   'gemma3-1b-it-q4_0-web',
  file: 'gemma3-1b-it-q4_0-web.task',
  url:  'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-q4_0-web.task',
  approxBytes: 776 * 1024 * 1024,
};
```

To try **Gemma 3n E2B** once you've accepted the license: download the int4
web bundle out-of-band (browser login, or `curl -H "Authorization: Bearer
$HF_TOKEN"`), then either point `url` at a location you control, or add a
dev-only "import from file" path (an `<input type=file>` on the options page
writing into OPFS — ~20 lines, deliberately left out of the prototype).
Update `file`/`approxBytes` to match; the prompt format is unchanged (all
Gemma IT models share the `<start_of_turn>` markup).

Things to re-check after any swap:

1. The bundle is a **web** build (`-web` / `-Web` in the name). Non-web
   `.task`/`.litertlm` files may assume native delegates.
2. RAM headroom on the target device (~model size + engine overhead).
3. The twin-pair spot checks in [testing.md](testing.md) still pass.
4. Latency still fits the 3.5s content-script budget when warm.

## Rejected alternatives

- **`transformers.js` + NLI zero-shot (like the `trial.ml` path but
  self-hosted)** — would be far smaller (~70MB), but the brief was LiteRT,
  and a generative Gemma shares the prompt/few-shot contract with the Chrome
  backend instead of maintaining a second classification scheme.
- **WebLLM / llama.cpp-WASM** — capable runtimes, but outside the LiteRT
  ecosystem this prototype is meant to exercise.
- **Server-side arbiter** — violates the product's core promise: nothing
  leaves the device.
