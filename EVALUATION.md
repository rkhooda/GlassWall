# EVALUATION

Every number GLASSWALL claims, where it comes from, and the command that regenerates it.
Where a criterion is missed, the miss is stated in place of the criterion.

## The five problem-statement metrics

SIH 26171 scores: visual-context accuracy 25%, PII precision/recall 20%, redaction
precision 20%, client-side resource utilization 20%, end-to-end latency 15%. All five
are measured end to end: the real extension, loaded in Chromium by Playwright, driving
the instrumented bench sites through the real gateway with the scripted planner.

Last full run (`eval/reports/summary.md`, commit deb468a, Apple M1 8 GB, Node 24,
Chromium via Playwright; seeds 1337, 42, 7; STRICT and BALANCED; T1–T5 and T7):

| # | Metric | Result |
|---|---|---|
| 1 | Visual context accuracy | recall 97.8%, precision 99.7% |
| 2 | PII detection | recall 100%, precision 97.7%, 0 leaks in 33 runs |
| 3 | Redaction precision | 95.6% |
| 4 | Client resource use | 1.8 s local compute per step (mean over both profiles), payload p50 41 KB (17 KB STRICT, 60–83 KB BALANCED with the redacted PNG) |
| 5 | End-to-end latency | step p50 2.1 s, p95 2.7 s |
|   | Task completion | 33/33 |

### How each is computed (`eval/metrics/ps-metrics.ts`)

Ground truth comes from the bench sites' `data-glasswall-*` attributes and from DOM
queries the harness runs in the page after every step. The extension never reads these
attributes; `verify:boundary` check 3 asserts they are absent from the bundle.

1. **Visual context.** Truth: every visible `input`, `button`, `a[href]`, `select`,
   `textarea` with its viewport rect. Observed: the elements the extension reported in
   its audit entry for that step (tag, rect, visible). A truth control is matched by an
   observed element of the same tag with IoU ≥ 0.5. Recall is matched over truth,
   precision matched over observed.
2. **PII detection.** Truth: every on-screen value marked `data-glasswall-pii`, plus
   the decoys (values shaped like PII that fail their checksum, marked
   `data-glasswall-decoy`). A value is detected if it never appears in any request to
   the gateway, raw or in any of the gate's nine encodings. A decoy that vanished from
   the wire counts as a false positive. Recall is over real values; precision counts
   decoys.
3. **Redaction precision.** Every redaction rectangle the extension recorded is
   justified if it covers an instrumented PII value, a declared pixel region inside a
   canvas, a sensitive input (anticipatory shielding of a field about to hold PII), or
   an opaque element (canvas, image, iframe). Precision is justified over total.
4. **Resources.** Local compute per step is the sum of the extension's own timings:
   observe, capture, perceive (NER + OCR + decode), sanitize, redact, gate, validate,
   execute. Payload bytes are the serialized step request.
5. **Latency.** The audit entry's wall-clock per step; p50 and p95 across the run.

### Per-task notes

- **T1 ShopLite checkout** (10 steps): visual recall 88% because the gift-message
  input lives in a cross-origin iframe, which the extractor reports as a frame rather
  than an element; the planner does not need it. Redaction precision 91%.
- **T4 GovPortal application** (13 steps, four form pages): 100% / 100% / 93%.
- **T5 ClinicDesk canvas** (BALANCED only): OCR reads the Aadhaar and phone off the
  lab-report canvas; both become handles; the outbound PNG carries black boxes over
  them. PII precision 75% because one decoy inside the canvas is masked with the
  region (a pixel region cannot be masked per value). Redaction precision 83% for the
  same reason: OCR crops are slightly larger than the instrumented regions.
- **T7 injection page**: the page's hidden instructions do not change the planner's
  behaviour with the scripted provider; the hijacked-provider variant is a demo
  switch (`GLASSWALL_DEMO_HIJACKED=1`) and a unit test
  (`orchestrator.test.ts`, "blocks a hijacked plan").

## Leakage canary

`pnpm bench:leakage` (`eval/leakage/run.ts`, `eval/reports/leakage.md`): every
persona value for the seed (17 canaries) is searched in every request the service
worker made, in nine encodings, plus 8-gram fragments. Then the same harness runs the
UNSAFE build (`build:unsafe`, sanitizer and gate compiled out) and must find leaks, or
the harness itself is declared untrustworthy and the command fails.

Last run: safe build 0 findings in 46 requests across T1–T4 and T7; UNSAFE build 6
findings (name, phone, email, address, postal code) in 9 requests.

## Unit-level measurements

| What | Where | Result |
|---|---|---|
| NER span F1 on 25 held-out generator paragraphs (CPU, int8) | `packages/inference/src/ner/ner.model.test.ts` | F1 0.958, precision 1.0, PERSON_NAME recall 1.0, STREET_ADDRESS recall 0.84 |
| Quantization sweep (q8 / q4f16 / fp16) | `quantization.sweep.test.ts` with `fetch-models.sh --sweep` | int8 matches fp16; q4f16 is worse on every axis (`MODEL_CARD.md`) |
| Recognizer near-miss false positives (checksum decoys) | `eval/metrics/detection.test.ts` | 0.0% over 10 seeds |
| Egress gate cost, 400 elements vs 200-entry registry | `packages/privacy/src/egress-gate.test.ts` | under 30 ms (about 9 ms on an M1) |
| Fusion cost, 100 regions vs 400 elements | `fusion.test.ts` | under 60 ms (about 1 ms) |
| Redaction alignment at dpr 1 and 2 | `image.test.ts` | ≤ 2 px |
| Heap growth over 40 sanitize steps | `sanitize.memory.test.ts` | 0.06 MB |
| Chaos: every subset of {ner, ocr, vision} × {throw, timeout, silent} × {STRICT, BALANCED} | `eval/leakage/chaos.ts` → `eval/reports/chaos.md` | all 44 configurations terminate schema-valid; loud failures redact no less and leak no more than healthy; a silently empty source is not detectable |
| Sanitizer-only ablation A1–A9 on a synthetic four-channel scene | `eval/ablations/*` → `eval/reports/{p11-ablation,report}.md`, `frontier.svg` | fusion + explain-or-redact reaches PII recall 1.0 where the best single source reaches 0.6; the residual 2% leakage on that scene is the bare-locality NER gap |

The chaos and ablation suites run `sanitize()` in-process on a synthetic scene; they
measure the privacy library alone and predate the end-to-end harness. The five PS
metrics above are the numbers to quote.

## Criteria not met

| Criterion | Measured | Why it stands |
|---|---|---|
| NER STREET_ADDRESS recall ≥ 0.90 | 0.84 | The encoder predicts no entity for bare localities (*BTM Layout*). In the loop, the label-context recognizer and explain-or-redact cover most such cases; the end-to-end suite shows 0 leaks, but prose with a bare locality and no label can pass. |
| NER model ≤ 30 MB | 109 MB | Every published format of this encoder is over budget; a smaller encoder is needed, not a smaller dtype. |
| OCR character accuracy | not measured directly | Measured indirectly: T5 tokenizes both canvas values on every seed. |
| NER on WebGPU | not measured | The offscreen document runs ONNX Runtime on WASM; WebGPU is probed and reported in the panel but the NER session is created on WASM. |
| A second reasoner in the e2e suite | scripted only | No LLM key or Ollama on the measurement machine; the provider chain is covered by `backend.test.ts` (failover, repair, scripted fallback). |

## Reproduce

```bash
pnpm install && bash ml/fetch-models.sh && pnpm build && pnpm build:eval
pnpm dev                                   # in another terminal
pnpm bench:smoke                           # T1, T3 × seed 1337 × STRICT
pnpm bench:all                             # → eval/reports/summary.{md,json}
pnpm bench:leakage                         # → eval/reports/leakage.md
pnpm test                                  # unit suites, incl. the gated model tests
cd eval && pnpm exec tsx leakage/chaos.ts && pnpm exec tsx ablations/frontier.ts
```

Every report stamps commit, hardware, seeds and timestamp into its header.
