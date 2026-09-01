# MODEL CARD

Every model GLASSWALL runs, what it is, what we measured, and where it fails.

**Nothing here is fetched at runtime.** Every model ships in the extension bundle and
loads through `chrome.runtime.getURL()`. Transformers.js and Tesseract.js both default
to pulling weights — and their own WASM runtimes — from a CDN; every one of those doors
is closed explicitly in `packages/inference/src/ner/wrapper.ts` and
`packages/inference/src/ocr/wrapper.ts`. A missing file degrades to `ner_unavailable`
or `ocr_unavailable`, never to a network call.

A metric marked **target** is an acceptance threshold, not a result. Only **measured**
rows are results. Rows marked **measured, below target** are criteria we failed and are
recording rather than lowering.

Machine for every measurement: Apple M1, 8 cores, 8 GB, macOS 26.5 (arm64), Node
v24.20.0. It is the only machine on the project, so it is also the weakest.

---

## 1. `ner-base` — Xenova/bert-base-NER (ONNX, int8)

| | |
|---|---|
| **Purpose** | Local NER over DOM free text. Advisory evidence for fusion. |
| **Source** | https://huggingface.co/Xenova/bert-base-NER |
| **License** | MIT (ONNX conversion); underlying bert-base-NER is Apache-2.0 |
| **Training data** | CoNLL-2003 English — Reuters newswire, 1996. Labels PER, LOC, ORG, MISC. |
| **Size** | **108.9 MB** (`onnx/model_quantized.onnx`) |
| **Runs on** | ONNX Runtime Web, WASM or WebGPU in the browser; CPU EP in node for the accuracy harness |
| **Vendored by** | `bash ml/fetch-models.sh` |

### Measured

25 held-out clinical paragraphs from the seeded generator, threshold 0.5, CPU EP.
Harness: `packages/inference/src/ner/ner.model.test.ts`.

| metric | value | target | |
|---|---|---|---|
| span F1 | **0.958** | ≥0.85 | ✅ |
| precision | **1.000** | — | |
| recall | **0.920** | — | |
| recall, `PERSON_NAME` | **1.000** | ≥0.90 | ✅ |
| recall, `STREET_ADDRESS` | **0.840** | ≥0.90 | ❌ **below target** |
| model size | **108.9 MB** | ≤30 MB | ❌ **below target, by 3.6×** |
| p50 latency, WebGPU | — | ≤250 ms | **not measured — browser only** |
| p50 latency, WASM | — | ≤700 ms | **not measured — browser only** |
| WebGPU/WASM output parity | — | equal | **not measured — browser only** |

The three unmeasured rows are unmeasured for one reason: node's transformers.js backend
exposes only the `cpu` device, so neither browser execution provider can be
instantiated outside a browser. They stay blank rather than being filled in with the
CPU number.

### Quantization sweep

Because "the model is too big" invites the obvious next move — quantize harder — we
ran it instead of assuming it. Same held-out set, same threshold, same machine.
Reproduce with `bash ml/fetch-models.sh --sweep` then
`pnpm --filter @glasswall/inference test quantization`.

| dtype | size | load | p50 | F1 | precision | recall | `PERSON_NAME` | `STREET_ADDRESS` |
|---|---|---|---|---|---|---|---|---|
| **q8 — ships** | 103.9 MB | 358 ms | 11.2 ms | **0.958** | 1.000 | 0.920 | 1.000 | 0.840 |
| q4f16 | 89.3 MB | 194 ms | 34.6 ms | 0.926 | 0.978 | 0.880 | 1.000 | 0.760 |
| fp16 | 205.8 MB | 563 ms | 133.8 ms | 0.958 | 1.000 | 0.920 | 1.000 | 0.840 |

Two conclusions, both of which changed what we would otherwise have done:

1. **int8 costs us nothing.** fp16 is identical to q8 on every accuracy column while
   being twice the size and twelve times slower here. So the 0.84 address recall is
   **the encoder, not the number format** — re-quantizing cannot fix it, and a smaller
   or larger dtype is not the lever.
2. **The only smaller published format is worse on every axis.** q4f16 saves 14.6 MB
   (14%) and pays 3.2 F1 points, 8 points of `STREET_ADDRESS` recall, and 3× the
   inference time — while still missing the 30 MB budget by more than 3×.

Every published weight format of this encoder is over budget: fp32 431 MB, fp16 216 MB,
q4 144 MB, bnb4 139 MB, int8/uint8 109 MB, q4f16 94 MB. **Meeting 30 MB requires a
smaller encoder, not a smaller number format.** We did not have time to find, evaluate
and vendor one, so we shipped the over-budget model and wrote this paragraph.

### Known gaps

- **MEASURED: bare Indian localities are missed entirely.** *BTM Layout*, *Hebbal*,
  *Koramangala*, *Whitefield* — the model predicts no location at all, not a wrong one.
  This is the whole of the `STREET_ADDRESS` shortfall. Addresses containing *Road* or
  *Street* are found reliably.
- **MEASURED: house numbers are excluded from predicted spans.** *42 Residency Road*
  comes back as *Residency Road*. Harmless under IoU matching, but a redaction rect
  drawn from the span will not cover the number.
- **No `STREET_ADDRESS` label exists.** Addresses are inferred from `LOC`, which
  conflates a city, a state and a street.
- **NOT observed, contrary to our own expectation.** We expected CoNLL-2003 newswire
  training to depress recall on Indian personal names. It scored **1.00** on the
  generator's pool. We are recording that we were wrong rather than repeating the
  concern as though it were a finding — though note the pool is 30 first names against
  a last-name list in a clean clinical template, which is not a hard test.
- **Latin script only.** Devanagari, Tamil and Bengali names are not recognised at all.
- **Case-sensitive.** ALL-CAPS or all-lowercase form fields degrade sharply.
- **Newswire register.** Clinical and transactional prose is out of domain.

### Mitigations, and the one that is not a mitigation

NER is one source among several and fusion combines them with noisy-OR, so a missed
entity can still be caught by a deterministic recognizer or by OCR. Evidence from this
model can only ever *raise* suspicion — it can never release anything, and it is never
consulted for a Tier-1 decision.

**Honest residual, not mitigated:** a bare locality in free text with no other signal
*will* pass. Explain-or-redact masks regions the DOM cannot account for, but a text
node *is* accounted for, so an NER miss inside one is not covered by it. This is a real
leak path and it is the whole of the measured 2.0% residual in `eval/reports/report.md`.

There is one counterintuitive measured consequence, from the chaos suite: **when this
model fails loudly, leakage goes down.** A dead NER means its text nodes are
unaccounted-for, so coverage tokenizes them wholesale and catches the address the
working model misses. A working NER leaks 1 value on the ablation scene; a crashed one
leaks 0. The model is not the safest thing in the pipeline — its absence is.

---

## 2. `tesseract-eng` — Tesseract.js 5 (LSTM, English)

| | |
|---|---|
| **Purpose** | Targeted OCR on regions the DOM cannot explain. **Never full-page.** |
| **Source** | https://github.com/naptha/tesseract.js + tessdata 4.0.0 `eng.traineddata` |
| **License** | Apache-2.0 |
| **Training data** | Tesseract 4/5 LSTM English traineddata |
| **Size** | ~43 MB (worker + WASM core + language data) |
| **Runs on** | WASM only. There is no WebGPU backend, so the WebGPU latency target does not apply. |
| **Loaded when** | The policy enables a screenshot **and** at least one region is unexplained. Under STRICT it is never loaded at all. |

### Measured

| metric | value | target | |
|---|---|---|---|
| crop coordinate round-trip error | **≤3 px** | ≤3 px | ✅ — pure geometry, measured without the engine (`ocr.test.ts`). Distinct from the redaction *alignment* criterion (≤2 px at dpr=1 and dpr=2), which is met separately in `image.test.ts:271`. |
| character accuracy | — | ≥0.90 | **not measured** |
| p50 latency, 3 crops | — | ≤1200 ms | **not measured** |

Character accuracy and latency are unmeasured because the engine is a browser worker
and the ClinicDesk fixture crops it would need do not exist yet. We are not reporting
a number we did not take.

What **is** measured is the skip: on a page with no unexplained regions, OCR runs 0% of
the time, and the skip decision itself costs 0.0 ms p50 / 0.2 ms p95 over 10 seeds
(`eval/reports/perf.md`). The cheapest OCR is the one that does not run.

### Known gaps

- Rotated, skewed or low-contrast text degrades sharply. Watermarks are effectively
  unreadable.
- Handwriting is not supported.
- English only. Devanagari or other scripts would need their own traineddata and would
  roughly double the bundle.

### Mitigations

A crop that times out, exceeds the budget, or cannot be read is reported **unexplained**
and masked — a bad read never produces a clean-looking region. Budget is 6 crops per
step at 512 px; regions beyond it are masked rather than skipped. Both paths are
asserted in `apps/extension/src/offscreen/pipeline/ocr.test.ts` and exercised under
force-failure in `eval/leakage/chaos.ts`.

---

## 3. Vision detector — **not built**

P10 was a stretch item, conditional on being ahead by day 11. We were not, and it was
cut.

**This costs nothing measurable, and that is a designed property rather than an
excuse.** Ablation A8 — fusion plus explain-or-redact with vision deliberately disabled
— scores **identically to A7 with it enabled** (`eval/reports/p11-ablation.md`), because
what accounts for the pixel channel is *coverage*, not a detector. A region nothing can
read is withheld because nothing can read it.

A half-trained detector would have been worse than this: it would have added a
confidence score to a decision that is currently made structurally, and it would have
needed its own model card section explaining why its recall was poor.

The license question that would have gated it is recorded anyway: Ultralytics YOLOv8 is
AGPL-3.0, which would have forced a decision about this repository's license. Not
having to make that decision is a second, smaller benefit of the cut.

---

## 4. `mlp-tiny` — 2-layer MLP

Not part of the pipeline. It is the fixture for the P1-B inference spike — the test
that answered whether ONNX Runtime Web can run inside an MV3 offscreen document at all,
which was the highest-risk unknown in the project.

| | |
|---|---|
| **License** | MIT — generated by `ml/export/create_mlp_model.py` |
| **Size** | 575 bytes |
| **WebGPU** | **0.8 ms** measured |
| **WASM** | **1.2 ms** measured |

Answer: yes, it runs, on both providers, with outputs equal within 1e-2. The
architecture stands.

---

## Non-model components that decide more than the models do

Worth stating on a model card because a reader will otherwise assume the ML is
load-bearing, and it is not.

- **Deterministic recognizers** — email, phone (E.164 + Indian formats), Aadhaar with
  Verhoeff, PAN, IFSC, GSTIN, UPI VPA, card with Luhn, IPv4/6, DOB, high-entropy key
  shapes. Checksums, not shapes: a 12-digit number that fails Verhoeff is **not** an
  Aadhaar. Measured false-positive rate against the generator's near-miss decoys over
  10 seeds: **0.0%** (`eval/metrics/detection.test.ts`). These are what stop the system
  redacting every order number.
- **Tier-1 element rules** — `input[type=password]`, `autocomplete` tokens, OTP
  heuristics. Deterministic, and short-circuiting: no ML output goes anywhere near the
  decision to release a password.
- **Explain-or-redact** — the mechanism that makes the pixel channel safe without a
  vision model, and the reason section 3 above is not a problem.

The models are advisory. The structure is what holds.
