#!/bin/sh
# fetch-litert-runtime.sh — vendor the LiteRT web runtime into the extension.
#
# MV3 forbids remotely hosted code, so the runtime must ship inside the
# extension package. This pulls MediaPipe's LLM Inference bundle — the LiteRT
# WASM engine plus its JS loader — from the npm CDN into src/vendor/litert/,
# which is gitignored (~55MB of third-party binaries don't belong in git).
#
# Run once before loading the extension in Firefox if you want the LiteRT
# arbiter backend (src/arbiter-litert.js). Without it the backend reports
# "no runtime" and the extension behaves exactly as before.
#
# Usage:  sh tools/fetch-litert-runtime.sh
set -eu

VERSION="0.10.29"   # @mediapipe/tasks-genai — bump deliberately, testing after
BASE="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@${VERSION}"
DEST="$(dirname "$0")/../src/vendor/litert"

mkdir -p "${DEST}/wasm"

fetch() {
  echo "  ${1}"
  curl -fsSL -o "${DEST}/${1}" "${BASE}/${1}"
}

echo "Vendoring @mediapipe/tasks-genai@${VERSION} into src/vendor/litert/"
fetch "genai_bundle.mjs"
fetch "wasm/genai_wasm_internal.js"
fetch "wasm/genai_wasm_internal.wasm"
fetch "wasm/genai_wasm_nosimd_internal.js"
fetch "wasm/genai_wasm_nosimd_internal.wasm"
echo "Done. Reload the extension; the options page should now offer the model download."
