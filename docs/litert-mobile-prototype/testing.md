# Testing status, plan, and known risks

## Emulator session results (2026-07-18)

Environment: Android 16 (API 36, Play x86_64 image) emulator via the
`android` CLI, Firefox Nightly 154.0a1 (universal APK), extension loaded as a
temporary add-on with `web-ext run --target=firefox-android`.

| Matrix # | Result | Notes |
| --- | --- | --- |
| 9 — core blocking | ✅ PASS | `google.com/search?q=diabetes` → full overlay, ASCII cat, correct reason. Host permissions auto-granted on temporary install |
| 10 — popup | ✅ PASS | Opens full-width; `pointer: coarse` branch active (large toggle, tap-sized options link) |
| 11 — options Android branch | ✅ PASS | Vendored runtime **imports inside Fenix** (status = `litert-needs-model`, not `unsupported`), OPFS probe works, LiteRT download button shown, trialML grant button correctly suppressed (UA branch) |
| 12 — model download | ⚠️ BLOCKED (error path ✅) | Download fails **HTTP 401**: all official LiteRT LLM bundles on HF are license-gated (see [model-selection.md](model-selection.md)). Clean failure — error surfaced in status line, retry button restored, no corrupt OPFS state |
| 13/14 — inference warm/cold | ⏸ NOT RUN | Needs a model; supply via the `litertModelUrl` override after accepting the HF license |
| 15 — memory pressure | ⏸ NOT RUN | Meaningless on an emulator anyway (configurable RAM) |

Net: everything up to the model bytes is proven on real Fenix/GeckoView —
manifest, content script, popup CSS, options states, runtime import, OPFS,
message plumbing, and the download error path. The remaining unknowns
(items 1, 3, 4 in the NOT-verified list below) all sit behind the license
gate, not behind code.

## Verified on this branch

- `node --check` on all touched/added JS; JSON parse on both manifests.
- `test/detect.test.html` — the static detection suite is unaffected
  (`detect.js`/`data.js` untouched); run it to confirm 71/71 before merging
  anything on top.
- Desktop Firefox load of the swapped manifest (temporary add-on): extension
  loads, options page renders the new states, `litert-no-runtime` maps to the
  pre-existing "unsupported" copy when `src/vendor/` is absent — i.e. the
  no-runtime path is behavior-neutral.

## NOT verified (the honest list)

1. **End-to-end inference.** No machine in this loop has run
   `gemma3-1b-it-q4_0-web.task` through the vendored runtime. The
   `LlmInference.createFromOptions` option shape and
   `FilesetResolver.forGenAiTasks` path convention are per current docs
   (`@mediapipe/tasks-genai@0.10.29`), unexecuted here.
2. **Anything on a physical Android device** — Fenix popup rendering, OPFS
   write throughput, memory survival, latency.
3. **Blob-URL model loading inside a moz-extension background page** — the
   documented path targets normal web pages; an extension origin may surprise
   us (fallback if it does: pass the OPFS `File` bytes as
   `modelAssetBuffer`, at the cost of a transient JS-side buffer).
4. **Verdict quality of Gemma-3-1B-q4 on the gray-zone set.**
5. **Whether Fenix throttles/kills a busy event page mid-inference.**

## Manual test matrix (run before promoting past prototype)

### Desktop Firefox (dev loop, do first)

| # | Step | Pass condition |
| --- | --- | --- |
| 1 | Load without vendoring | Status = "No on-device AI…"; static blocking unchanged |
| 2 | `fetch-litert-runtime.sh`, reload | Status = "LiteRT runtime bundled…", download button visible |
| 3 | Download model | Progress climbs with MB counter; ends at `litert-ready`; survives a mid-download cancel (close page, reopen → needs-model again, no corrupt state) |
| 4 | "Test the arbiter": the 6 few-shot twins (`back clicking`/`back button`, `itchy all over`/`bleeding edge tech`, `birth control side effects`/`old fuel side effects`) | Verdicts match the few-shot labels; warm latency printed |
| 5 | Real search: `why does my back keep clicking` on google.com | Warm: blocked with "confirmed on-device". Cold (restart browser first): allowed via fallback within ~3.5s, blocked on the *second* try |
| 6 | Real search: `side effects of old fuel on engine` | Allowed (model rescues the `ambiguousKeywords` static block) |
| 7 | Delete model | Back to needs-model; searches revert to static behavior |
| 8 | `trialML` granted AND model present (desktop) | `trial-ml` wins the status display; classify falls through to LiteRT only if `trial.ml` errors |

### Firefox for Android (device)

| # | Step | Pass condition |
| --- | --- | --- |
| 9 | `web-ext run --target=firefox-android` | Extension loads; a tier-1 search (`diabetes`) blocks |
| 10 | Popup from extensions menu | Full-width, tap-sized toggle (the `pointer: coarse` branch) |
| 11 | Options page on device | LiteRT download offered (NOT the trialML grant button — UA branch) |
| 12 | Model download on Wi-Fi | Completes; phone survives; `litert-ready` |
| 13 | Warm arbiter query | Measure latency; record device model. Budget: < 3.5s warm |
| 14 | Cold arbiter query after force-stopping Firefox | Static fallback, no crash, no ANR |
| 15 | Memory pressure (open ~20 tabs, return) | Extension recovers; worst case = static verdicts |

Record 13/14 numbers in this file when they exist.

## <a name="known-risks"></a>Known risks & follow-ups, ranked

1. **Cold-start vs the 3.5s budget.** On Android CPU the cold path (load
   776MB + prefill) will essentially always fall back statically; only warm
   repeats benefit. Mitigations to explore: persist verdicts to
   `storage.local` (survive restarts), a "keep warm while browsing" opt-in,
   or a smaller/distilled model.
2. **API drift in `@mediapipe/tasks-genai`.** Version is pinned in the fetch
   script; treat bumps as testable changes, not routine.
3. **q4 verdict quality.** If the twins wobble, try `int8-web` (+240MB)
   before touching the prompt.
4. **Download UX.** No resume, dies with the page. Acceptable for a
   prototype; `Range` support is the obvious fix.
5. **UA sniff for the Android/desktop options branch.** Ugly but contained;
   replace with a capability probe if one appears.
6. **AMO review posture.** `wasm-unsafe-eval`, a 55MB vendored binary blob,
   and a user-triggered 776MB download will all draw reviewer attention;
   unlisted signing is the realistic channel while this is experimental.
