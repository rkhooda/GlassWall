#!/usr/bin/env bash
# Vendor the model and OCR assets GLASSWALL runs locally.
#
# SETUP ONLY. Nothing here runs at extension runtime — that is the whole point.
# The extension loads every one of these files through chrome.runtime.getURL(),
# with transformers.js and tesseract.js both pinned away from their CDNs.
#
# The assets are gitignored (apps/extension/public/), so this script is how a
# fresh clone gets them. Run once:  bash ml/fetch-models.sh
#
#   --sweep   also vendor the alternative NER weight formats (q4f16, fp16, ~310MB)
#             so packages/inference's quantization sweep can run. Not needed to
#             build or demo; needed to reproduce the numbers in MODEL_CARD.md.
set -euo pipefail

SWEEP=0
for arg in "$@"; do [ "$arg" = "--sweep" ] && SWEEP=1; done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC="$ROOT/apps/extension/public"

fetch() { # url dest
  if [ -s "$2" ]; then echo "  have $(basename "$2")"; return; fi
  echo "  get  $(basename "$2")"
  curl -sSL --retry 3 --retry-delay 2 --max-time 600 -o "$2" "$1"
}

echo "NER — Xenova/bert-base-NER (int8 ONNX)"
NER="$PUBLIC/models/ner-base"
HF="https://huggingface.co/Xenova/bert-base-NER/resolve/main"
mkdir -p "$NER/onnx"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  fetch "$HF/$f" "$NER/$f"
done
fetch "$HF/onnx/model_quantized.onnx" "$NER/onnx/model_quantized.onnx"

if [ "$SWEEP" = "1" ]; then
  echo "  --sweep: alternative weight formats for the quantization sweep"
  # q4f16 is the only published format smaller than the int8 we ship; fp16 is the
  # higher-precision reference that tells us whether int8 is costing us anything.
  # Measured answer (MODEL_CARD.md): it is not, and q4f16 is worse on every axis.
  for f in model_q4f16 model_fp16; do
    fetch "$HF/onnx/$f.onnx" "$NER/onnx/$f.onnx"
  done
fi

# pnpm does not hoist, so assets are located in the .pnpm store rather than
# guessed at a path under node_modules/.

echo "ONNX Runtime WASM binaries (else ORT fetches them from jsdelivr)"
mkdir -p "$PUBLIC/ort"
# Must be the build transformers.js itself depends on — a mismatched ORT version
# and JS glue will not load.
ORT_SRC="$(ls -d "$ROOT"/node_modules/.pnpm/@huggingface+transformers@*/node_modules/onnxruntime-web/dist 2>/dev/null | head -1)"
if [ -n "$ORT_SRC" ]; then
  cp -f "$ORT_SRC"/*.wasm "$PUBLIC/ort/" 2>/dev/null || true
  cp -f "$ORT_SRC"/*.mjs "$PUBLIC/ort/" 2>/dev/null || true
  echo "  copied $(ls "$PUBLIC/ort" | wc -l | tr -d ' ') files from $(basename "$(dirname "$(dirname "$ORT_SRC")")")"
else
  echo "  SKIP: run pnpm install first"
fi

echo "Tesseract — worker, wasm core and English language data"
TESS="$PUBLIC/tesseract"
mkdir -p "$TESS"
WORKER="$(ls "$ROOT"/node_modules/.pnpm/tesseract.js@*/node_modules/tesseract.js/dist/worker.min.js 2>/dev/null | head -1)"
if [ -n "$WORKER" ]; then cp -f "$WORKER" "$TESS/"; echo "  copied worker.min.js"
else echo "  SKIP worker.min.js: run pnpm install first"; fi
CORE="$(ls -d "$ROOT"/node_modules/.pnpm/tesseract.js-core@*/node_modules/tesseract.js-core 2>/dev/null | head -1)"
if [ -n "$CORE" ]; then
  cp -f "$CORE"/tesseract-core*.wasm "$CORE"/tesseract-core*.js "$TESS/" 2>/dev/null || true
  echo "  copied wasm core"
else
  echo "  SKIP wasm core: tesseract.js-core not installed"
fi
fetch "https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/eng.traineddata.gz" "$TESS/eng.traineddata.gz"

echo
echo "Done. Gated suites will now run:"
echo "  pnpm --filter @glasswall/inference test"
