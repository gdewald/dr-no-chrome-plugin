# Firefox for Android support

Firefox for Android (Fenix, GeckoView-based) is the **only mobile browser
that can run Dr. No at all**: Chrome for Android/iOS and Firefox for iOS have
no extension runtime whatsoever. That makes "mobile support" concretely
"Firefox for Android support."

## What already worked

The Firefox build was structurally Android-ready before this branch:

- `background.scripts` event page (not a service worker) — Fenix-supported.
- Content scripts on `<all_urls>` at `document_start` — the core blocking
  path, fully functional on Android.
- `storage` permission, `storage.session` verdict cache — supported.
- `options_ui` with `open_in_tab: true` — opens as a normal tab on Android.
- The block interstitial (`block.css`) is already responsive
  (`max-width: 640px; width: 100%`).

What did **not** work on Android was the arbiter: `browser.trial.ml` is not
shipped in Fenix, so every gray-zone query silently took its static fallback.
The LiteRT backend ([architecture.md](architecture.md)) is the fix.

## Changes in this branch

### Manifest (`manifest.firefox.json`)

- **`browser_specific_settings.gecko_android`** — declares Android
  compatibility explicitly (with its own `strict_min_version: 134.0`;
  Fenix shares desktop version numbers). Without this key AMO infers
  Android support; with it, intent is explicit and the min version is
  pinned independently of desktop.
- **`content_security_policy.extension_pages`** adds `'wasm-unsafe-eval'` —
  required for the LiteRT WASM engine to compile in extension pages.
- **Background script order** — `arbiter-litert.js` loads before
  `background.js`.

### Popup (`src/popup.html`)

Fenix renders the action popup as a full-width panel, not a dropdown sized
from the body — the old hard-coded `body { width: 260px }` left dead space
and desktop-sized tap targets. Now:

- viewport meta added;
- `@media (pointer: coarse)`: body goes full-width, the toggle and the
  options link grow to comfortable tap sizes (~44px including padding).

`pointer: coarse` rather than a width query on purpose: on desktop the popup
viewport is *derived from* the body width, so a `max-width` media query would
match the 260px popup itself and `width: 100%` would collapse it. Coarse
pointer cleanly separates "touch device" from "desktop toolbar dropdown."

### Options page

Already had a viewport meta and a 720px max width; it gains the LiteRT
states/buttons, and its availability logic knows Android has no `trial.ml`
(UA sniff) so it offers the LiteRT model download instead of a permission
grant that can't help.

## Compute reality on Android

### WebGPU: not yet

The MediaPipe/LiteRT web runtime prefers WebGPU and falls back to WASM CPU
(XNNPACK). As of mid-2026, **WebGPU in Firefox is enabled on Windows (141+)
and macOS ARM (145+); on Android it exists only behind
`dom.webgpu.enabled`** with Mozilla planning Android work in 2026. So:

- **Assume CPU inference on Fenix.** SIMD WASM is present; expect the
  1B-q4 model to prefill+decode our ~200-token prompt in single-digit
  seconds on a flagship, worse on mid-range hardware. (Measure — see
  [testing.md](testing.md); these are expectations, not measurements.)
- The first query after browser start also pays the model load
  (~776MB from OPFS into WASM memory).
- When Fenix ships WebGPU, the same vendored runtime should light it up
  without code changes here.

### <a name="memory"></a>Memory

The loaded engine holds the whole model in WASM memory: ~0.8GB resident for
the default model. Android will happily kill the extension process (or
Firefox) under memory pressure — the event page then restarts cold on the
next message, and the arbiter's timeout+fallback design absorbs the miss.
This is survivable but shapes the UX: the arbiter on Android is best-effort,
warm-cache-fast, cold-start-slow. A 3GB E2B model makes this categorically
worse, which is half the reason it isn't the default
([model-selection.md](model-selection.md)).

### Storage

OPFS quota on Firefox is a share of free disk; 776MB is generally fine but
eviction is possible if the device is starved — `litert-needs-model` will
simply reappear and the user can re-download. The model never counts against
`storage.sync/local` quotas.

## Installing on a device

Temporary/dev loop (recommended for this prototype):

```sh
# on the desktop, phone connected with USB debugging, Fenix installed:
sh tools/fetch-litert-runtime.sh
cp manifest.firefox.json manifest.json
npx web-ext run --target=firefox-android --android-device=<serial> \
  --firefox-apk=org.mozilla.firefox
```

Longer-lived installs: AMO **unlisted** signing (`web-ext sign`) and install
the signed XPI from Fenix's settings, or Fenix Nightly + a custom add-on
collection. Note the model download happens *on the phone* (776MB — Wi-Fi),
and the runtime must be vendored *before* packaging since it ships inside
the XPI.

## Out of scope, recorded for later

- **Firefox iOS / Chrome mobile:** no extension runtime; nothing an
  extension can do. Platform gate, not a bug.
- **GeckoView + AICore bridge:** the only conceivable road to literal Gemini
  Nano on Android — requires Mozilla platform work, tracked as an idea only.
- **Background download resumption:** the options-page download dies with
  the page (documented in its status text). `Range` resume would be a small
  follow-up.
