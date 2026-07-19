// arbiter-litert.js — PROTOTYPE third arbiter backend: an LLM run locally by
// the LiteRT stack (https://github.com/google-ai-edge/litert), for browsers
// where neither Chrome's Prompt API nor Firefox's trial.ml exists — in
// practice, Firefox for Android, where trial.ml is absent and the arbiter
// otherwise degrades to static rules.
//
// "LiteRT in a browser extension" concretely means MediaPipe's LLM Inference
// task (@mediapipe/tasks-genai): its WASM engine is the LiteRT/XNNPACK
// runtime compiled for the web, and it consumes the same .task/.litertlm
// bundles LiteRT-LM uses on-device. Gemini Nano itself is not distributable —
// its weights are only reachable through platform APIs (Chrome's Prompt API,
// Android AICore) — so the runnable open-weights stand-in is Gemma
// (see MODEL below, and docs/litert-mobile-prototype/model-selection.md).
//
// Two big assets, neither committed to git:
//   - the runtime (~55MB JS+WASM): vendored into src/vendor/litert/ by
//     tools/fetch-litert-runtime.sh at dev time. MV3 forbids remote code, so
//     it must ship inside the extension.
//   - the model (hundreds of MB): downloaded by the user from the options
//     page (user gesture, progress bar) and stored in OPFS, the extension
//     origin's private file system. Never fetched implicitly.
//
// Loaded both as a background script (before background.js, which drives
// classification through it) and by the options page (which drives model
// download/delete through it). All state is per-context; OPFS is shared
// because both pages live on the same moz-extension:// origin.

(function () {
  'use strict';

  // Default model: Gemma 3 1B instruction-tuned, q4_0, web-optimized .task.
  // Chosen over the requested Gemma 3n E2B because its int4 bundle is ~3GB.
  //
  // GATING (verified on an emulator, 2026-07-18): every LiteRT LLM bundle on
  // Hugging Face — this one included — sits behind a Gemma/model license
  // click-through, so the anonymous fetch below fails with HTTP 401. The
  // options page surfaces that error and offers a retry; to actually get the
  // model, accept the license with an HF account, download the file
  // out-of-band, and serve it via the litertModelUrl override below. See
  // docs/litert-mobile-prototype/model-selection.md.
  const MODEL = {
    id: 'gemma3-1b-it-q4_0-web',
    file: 'gemma3-1b-it-q4_0-web.task',
    url: 'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-q4_0-web.task',
    approxBytes: 776 * 1024 * 1024,
  };

  const VENDOR_BUNDLE = 'src/vendor/litert/genai_bundle.mjs';
  const VENDOR_WASM_DIR = 'src/vendor/litert/wasm';
  const OPFS_DIR = 'dr-no-models';

  // ------------------------------------------------------------- runtime ----

  // The vendor bundle either imports once or never will; cache the attempt so
  // the options page's 2s status poll doesn't re-fetch a ~1MB module forever.
  let runtimePromise = null;

  function loadRuntime() {
    if (!runtimePromise) {
      runtimePromise = import(chrome.runtime.getURL(VENDOR_BUNDLE)).catch((err) => {
        runtimePromise = null; // a transient failure shouldn't wedge the backend
        throw new Error(
          'LiteRT runtime not bundled (run tools/fetch-litert-runtime.sh): ' + err.message
        );
      });
    }
    return runtimePromise;
  }

  async function hasRuntime() {
    try {
      await loadRuntime();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------- OPFS ----

  async function modelDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIR, { create: true });
  }

  async function hasModel() {
    try {
      const dir = await modelDir();
      const handle = await dir.getFileHandle(MODEL.file);
      const file = await handle.getFile();
      return file.size > 0;
    } catch (e) {
      return false; // NotFoundError, or OPFS itself unavailable
    }
  }

  // Stream the model straight from the network into OPFS — never the whole
  // file in memory. onProgress(loadedBytes, totalBytes|null) fires per chunk.
  // Partial downloads are written under a .part name and only renamed (well,
  // rewritten under the real name is not needed — OPFS has no rename, so we
  // download to the final handle and delete it on failure).
  async function downloadModel(onProgress) {
    // Dev override for the gated default URL: point at a file you obtained
    // yourself (e.g. `http://10.0.2.2:8765/model.task` served from the host
    // machine when testing in an emulator). Set from any extension context:
    //   chrome.storage.local.set({ litertModelUrl: '…' })
    const store = await chrome.storage.local.get('litertModelUrl');
    const url = store.litertModelUrl || MODEL.url;

    const dir = await modelDir();
    const handle = await dir.getFileHandle(MODEL.file, { create: true });
    const writable = await handle.createWritable(); // truncates any partial file
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching model');
      const total = Number(res.headers.get('content-length')) || null;
      const reader = res.body.getReader();
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        loaded += value.byteLength;
        if (onProgress) onProgress(loaded, total);
      }
      await writable.close();
    } catch (err) {
      try { await writable.abort(); } catch (e) { /* already closed */ }
      try { await dir.removeEntry(MODEL.file); } catch (e) { /* nothing to clean */ }
      throw err;
    }
  }

  async function deleteModel() {
    const dir = await modelDir();
    try {
      await dir.removeEntry(MODEL.file);
    } catch (e) { /* already gone */ }
  }

  // -------------------------------------------------------------- engine ----

  // Lazy engine, same promise pattern as the other backends in background.js:
  // reset on failure, never created without someone actually asking. Engine
  // creation loads the whole model into WASM memory — expensive on a phone —
  // so nothing here runs at browser startup.
  let enginePromise = null;

  function getEngine() {
    if (!enginePromise) {
      enginePromise = createEngine().catch((err) => {
        enginePromise = null;
        throw err;
      });
    }
    return enginePromise;
  }

  async function createEngine() {
    const genai = await loadRuntime();
    if (!(await hasModel())) throw new Error('model not downloaded');

    const dir = await modelDir();
    const file = await (await dir.getFileHandle(MODEL.file)).getFile();
    // A blob URL lets the WASM loader stream the model from disk instead of
    // us materializing a ~776MB ArrayBuffer in JS first.
    const modelUrl = URL.createObjectURL(file);
    try {
      const fileset = await genai.FilesetResolver.forGenAiTasks(
        chrome.runtime.getURL(VENDOR_WASM_DIR)
      );
      return await genai.LlmInference.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl },
        maxTokens: 512, // prompt + few-shot ≈ 200 tokens; answer is one word
        topK: 1, // deterministic: same query, same verdict
        temperature: 0,
        randomSeed: 1,
      });
    } finally {
      URL.revokeObjectURL(modelUrl);
    }
  }

  // Gemma instruction-tuned models expect the turn markup below; a bare
  // prompt string degrades instruction-following badly at this size.
  function gemmaPrompt(system, fewShot, query) {
    let p = '<start_of_turn>user\n' + system + '\n\n' + fewShot[0].content + '<end_of_turn>\n';
    p += '<start_of_turn>model\n' + fewShot[1].content + '<end_of_turn>\n';
    for (let i = 2; i < fewShot.length; i += 2) {
      p += '<start_of_turn>user\n' + fewShot[i].content + '<end_of_turn>\n';
      p += '<start_of_turn>model\n' + fewShot[i + 1].content + '<end_of_turn>\n';
    }
    p += '<start_of_turn>user\n' + query + '<end_of_turn>\n<start_of_turn>model\n';
    return p;
  }

  // Classify one normalized query. The system prompt and few-shot pairs are
  // passed in by background.js so all three backends share one source of
  // truth for what "medical" means.
  async function classify(key, system, fewShot) {
    const engine = await getEngine();
    const out = await engine.generateResponse(gemmaPrompt(system, fewShot, key));
    return /^\s*yes/i.test(out) ? 'yes' : 'no';
  }

  // -------------------------------------------------------------- status ----

  async function status() {
    if (!(await hasRuntime())) return 'litert-no-runtime';
    if (!(await hasModel())) return 'litert-needs-model';
    return 'litert-ready';
  }

  // Load the engine (and model) into memory ahead of the first query. Only
  // ever called when the user is looking at the options page with the model
  // already downloaded — see the warmup notes in background.js.
  function warmup() {
    getEngine().catch(() => {});
  }

  globalThis.DR_NO_LITERT = {
    MODEL,
    status,
    hasRuntime,
    hasModel,
    downloadModel,
    deleteModel,
    classify,
    warmup,
  };
})();
