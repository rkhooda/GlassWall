# MODEL CARD

The models GLASSWALL runs on the user's device, what they are for, what was measured,
and where they fail.

Nothing is fetched at runtime. Every asset is vendored by `bash ml/fetch-models.sh`
into `apps/extension/public/` (gitignored) and loaded through `chrome.runtime.getURL()`.
Transformers.js and Tesseract.js default to CDN downloads for weights and their own WASM
runtimes; both are pinned to the extension's own files in
`packages/inference/src/ner/wrapper.ts` and `packages/inference/src/ocr/wrapper.ts`. A
missing file degrades to `ner_unavailable` or `ocr_unavailable` (the affected text or
pixels are withheld), never to a network call.

Both models run in the extension's offscreen document (`apps/extension/src/offscreen`),
which is the only MV3 context that can host WASM workers and canvases. They are
advisory: their output can add redaction, never remove it, and no tier-1 decision
(password, card, OTP) consults a model.

## 1. NER — Xenova/bert-base-NER, ONNX int8

| | |
|---|---|
| Purpose | Names and places in DOM text (and in OCR output under BALANCED) that no deterministic recognizer or label rule catches. Runs under every profile. |
| Source, license | https://huggingface.co/Xenova/bert-base-NER (MIT conversion of Apache-2.0 bert-base-NER) |
| Training data | CoNLL-2003 English newswire; labels PER, LOC, ORG, MISC |
| Size | 109 MB (`onnx/model_quantized.onnx`) |
| Runtime | ONNX Runtime Web on WASM in the offscreen document; CPU in Node for the accuracy harness |
| Used labels | PER → PERSON_NAME, LOC → STREET_ADDRESS. ORG and MISC are ignored: product names and brands are not personal data, and registering them would make the gate refuse the agent's own legitimate literals. |

### Measured

Accuracy on 25 held-out paragraphs from the seeded generator, threshold 0.5
(`packages/inference/src/ner/ner.model.test.ts`):

| Metric | Value | Target | |
|---|---|---|---|
| span F1 | 0.958 | ≥ 0.85 | met |
| precision | 1.000 | | |
| recall, PERSON_NAME | 1.000 | ≥ 0.90 | met |
| recall, STREET_ADDRESS | 0.840 | ≥ 0.90 | not met |
| size | 109 MB | ≤ 30 MB | not met |

In the loop (WASM, Apple M1, `eval/reports/summary.md`): a STRICT step on a page with
40–60 text nodes costs about 0.8–1.5 s of local compute, most of it NER; the first step
after install also pays the model load, which `warmUp()` moves ahead of the user's first
step.

Quantization sweep (`bash ml/fetch-models.sh --sweep`, `quantization.sweep.test.ts`):

| dtype | size | p50 (CPU) | F1 | STREET_ADDRESS recall |
|---|---|---|---|---|
| q8 (ships) | 104 MB | 11 ms | 0.958 | 0.84 |
| q4f16 | 89 MB | 35 ms | 0.926 | 0.76 |
| fp16 | 206 MB | 134 ms | 0.958 | 0.84 |

int8 costs nothing against fp16, so the address gap is the encoder, not the number
format; the only smaller published format is worse on every axis and still over budget.

### Known gaps and what covers them

- Bare Indian localities (*Hebbal*, *BTM Layout*) get no entity at all. In the loop,
  the label-context recognizer (`dt/dd`, `Label: value`, table columns) catches most of
  them because pages print addresses next to labels; free prose with a bare locality
  and no label can pass (`SECURITY.md` N1).
- House numbers are excluded from predicted spans; the surrounding text node is still
  tokenized because substitution runs on the whole known value.
- Latin script only; case-sensitive; newswire register.
- False positives on UI copy ("Personal information", "Back") are filtered: spans made
  only of generic words, spans under 3 characters, and spans inside control labels are
  dropped before they reach the registry (`apps/extension/src/offscreen/pipeline/ner.ts`).

## 2. OCR — Tesseract.js 5, English LSTM

| | |
|---|---|
| Purpose | Read pixel regions the DOM cannot explain (canvas, images) so their values become handles and their rectangles are blacked out. |
| Source, license | https://github.com/naptha/tesseract.js, tessdata 4.0.0 `eng.traineddata` (Apache-2.0) |
| Size | about 43 MB (worker, WASM core, language data) |
| Runtime | WASM only |
| Loaded when | The profile allows pixels (BALANCED) and the page has at least one unexplained region. Never under STRICT. |
| Budget | 6 crops per step at up to 512 px; regions beyond the budget or that time out are masked, not skipped. |

### Measured

- ClinicDesk lab-report canvas (T5, three seeds): the Aadhaar and phone rendered to
  pixels are read, registered and masked on every run; 0 leaks (`eval/reports/summary.md`).
- Crop coordinate round trip ≤ 3 px (`ocr.test.ts`); redaction alignment ≤ 2 px at
  dpr 1 and 2 (`image.test.ts`).
- Character accuracy is not measured as a number; the end-to-end result above is the
  evidence that the values it matters for are read.
- A BALANCED step with an OCR pass costs 2–4 s of local compute on an M1.

### Known gaps

Rotated, skewed or low-contrast text and handwriting degrade sharply; English only. A
crop that cannot be read is still masked, so a bad read never yields a clean-looking
region.

## 3. Visual PII / face detector: not built

The problem statement gives "blur faces" as an example. GLASSWALL masks every image
region without a DOM owner wholesale (explain-or-redact), so a photo is blacked out
rather than analysed. A detector would refine that box into a face box; the extension
point is a third `PerceptionSource` in `apps/extension/src/background/perception.ts`
with its own coverage declaration. Ablation A8 (`eval/reports/p11-ablation.md`) shows
that on the synthetic scene coverage alone accounts for the pixel channel.

## 4. `mlp-tiny`

A 575-byte two-layer MLP (`ml/export/create_mlp_model.py`, MIT) used only by the
inference spike that established ONNX Runtime Web runs inside an MV3 offscreen document
on both WASM (1.2 ms) and WebGPU (0.8 ms). Not part of the pipeline.

## What decides more than the models

- Deterministic recognizers with checksums: Aadhaar (Verhoeff), cards (Luhn), PAN,
  IFSC, GSTIN, UPI, email, phone, DOB, IP, high-entropy secrets. 0.0% false positives
  on the generator's near-miss decoys (`eval/metrics/detection.test.ts`).
- Label context: `dt/dd`, `Label: value`, table columns under a label header.
- Element rules: `type=password`, `autocomplete` tokens, OTP heuristics; these decide
  tier 1 without any model.
- Explain-or-redact: whatever nothing can account for is withheld.

The models are advisory. The structure holds.
