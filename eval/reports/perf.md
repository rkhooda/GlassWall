# Performance after optimization

**Measured 2026-09-01T06:06:11.192Z at `569f52bb6cef494fdf4099aaecc44a84a49b5858`.**

| | |
|---|---|
| Hardware | Apple M1 · 8 cores · 8 GB |
| OS | macOS 26.5 (arm64) |
| Runtime | Node v24.20.0 |
| Commit | `569f52bb6cef494fdf4099aaecc44a84a49b5858` |
| Forced GC available | yes |

This is the only machine in the project, so it is also the weakest one. Every number
below was measured on it. Nothing here is extrapolated to faster hardware.

| metric | value | p95 | n | note |
| --- | --- | --- | --- | --- |
| NER module import | **157.2 ms** | — | 1 | transformers.js + ORT glue |
| NER model load (109MB int8, cold) | **248.5 ms** | — | 1 | device cpu |
| NER first inference | **21.7 ms** | — | 1 | includes graph warm-up |
| NER cold start (import + load + first inference) | **427.3 ms** | — | 1 | what a step pays if the model was never loaded |
| NER warm inference | **14 ms** | 16.7 ms | 20 | 170 chars |
| first step, model cold | **427.3 ms** | — | 1 | no warm-up: the user waits for the whole cold start inside step 1 |
| first step, after warm-up at install | **14 ms** | — | 20 | warmUpInference() already paid import + load + first inference |
| first-step saving from warm-up | **413.3 ms** | — | 1 | 97% of the cold start, moved off the user's first step |
| model bytes loaded, STRICT | **103.9 MB** | — | 1 | ner yes · ocr no (screenshot off) |
| model bytes loaded, BALANCED | **144.9 MB** | — | 1 | ner yes · ocr yes (screenshot on) |
| sanitize() per step, STRICT | **0.3 ms** | 6.9 ms | 10 | stub perception sources; fusion + coverage + build are real |
| sanitize() per step, BALANCED | **0.2 ms** | 0.3 ms | 10 | stub perception sources; fusion + coverage + build are real |
| OCR skip decision | **0 ms** | 0.2 ms | 10 | findUnexplainedRegions over the whole observation |
| OCR skip rate, ablation scene | **0 %** | — | 10 | 2 unexplained regions per scene, so OCR runs |
| OCR skip rate, no unexplained regions | **100 %** | — | 1 | the same page with its canvases removed |
| heap after 50 steps | **30 MB** | — | 50 | from 30MB; checkpoints 29.9 → 29.9 → 30 → 30 → 30 |
| heap growth per 10 steps | **0 MB** | — | 5 | after forced collection |


## Before → after

Baseline: `eval/reports/perf-baseline.md`, measured on the same machine before any
of this phase's changes existed.

| metric | before | after | delta |
| --- | --- | --- | --- |
| NER module import | 171.4 ms | **157.2 ms** | -14.2 ms |
| NER model load (109MB int8, cold) | 287.1 ms | **248.5 ms** | -38.6 ms |
| NER cold start (import + load + first inference) | 477 ms | **427.3 ms** | -49.7 ms |
| NER warm inference | 12.3 ms | **14 ms** | +1.7 ms |
| first step, model cold | 477 ms | **427.3 ms** | -49.7 ms |
| first step, after warm-up at install | — *no warm-up existed: every install paid the cold start inside step 1* | **14 ms** | **new** |
| model bytes loaded, STRICT | — *OCR loaded whenever a frame arrived, so the profile did not decide — the caller did* | **103.9 MB** | **new** |
| model bytes loaded, BALANCED | — *same as after: BALANCED wants the pixel path* | **144.9 MB** | **new** |
| sanitize() per step, STRICT | 0.3 ms | **0.3 ms** | unchanged |
| sanitize() per step, BALANCED | 0.2 ms | **0.2 ms** | unchanged |
| heap after 50 steps | 29.9 MB | **30 MB** | +0.1 MB |
| heap growth per 10 steps | 0 MB | **0 MB** | unchanged |

**Read the cold-start rows as noise, not regression.** No change in this phase touches
the import, the load, or the first inference — they are the same code on the same
weights. Three runs on this machine gave 477 / 443 / 427.3ms for the same path,
a spread of roughly ±60ms, which is what an 8GB laptop with a 109MB mmap does. The
delta column is arithmetic on two single samples and nothing more.

**What actually moved, and what did not.**

The one number worth the work is the first step. 427.3ms of cold start now
happens at install instead of inside the user's first action, leaving 14ms.
Nothing was made faster — the cold start costs exactly what it always did — it was
moved off the path where a human is waiting. That is the honest description.

Row-by-row latency (`sanitize()`, the OCR skip decision) is **unchanged**, and was
never the problem: fusion, coverage and the observation build were already sub-
millisecond at baseline. Optimizing them would have been optimizing against intuition.

Heap was already flat at baseline and still is. The change is that it is now asserted
by `packages/privacy/src/sanitize.memory.test.ts` rather than observed once — the test
goes red at a 2.2MB leak and passes at the measured 0.06MB over 40 steps.

The model-bytes row is a policy change, not a speed change: STRICT now decides against
the OCR engine because its policy disables the screenshot, rather than avoiding it by
the accident of no frame being passed.

## Quantization sweep — measured, not assumed

Reproduce with `bash ml/fetch-models.sh --sweep` then
`pnpm --filter @glasswall/inference test quantization`. 25 held-out generator
paragraphs, threshold 0.5, ONNX Runtime CPU EP on the machine above.

| dtype | size | load | p50 | F1 | precision | recall | PERSON_NAME | STREET_ADDRESS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **q8 (ships)** | 103.9MB | 358ms | 11.2ms | **0.958** | 1.000 | 0.920 | 1.000 | 0.840 |
| q4f16 | 89.3MB | 194ms | 34.6ms | 0.926 | 0.978 | 0.880 | 1.000 | 0.760 |
| fp16 | 205.8MB | 563ms | 133.8ms | 0.958 | 1.000 | 0.920 | 1.000 | 0.840 |

Two results, both of which change what we would have done on intuition:

1. **int8 costs us nothing.** fp16 scores identically to q8 on every column while
   being twice the size and twelve times slower here. The 0.84 STREET_ADDRESS recall
   is the encoder, not the number format, so re-quantizing cannot fix it — only a
   different model can. Before measuring, "try less aggressive quantization" was the
   obvious next move. It is not.
2. **The one smaller format is worse on every axis.** q4f16 saves 14.6MB (14%) and
   pays 3.2 F1 points, 8 points of STREET_ADDRESS recall, and 3x the inference time.
   It also still misses the 30MB budget by 3x, so the trade buys nothing.

The size acceptance criterion therefore stays failed and stays reported. Every
published weight format of this encoder is over budget; the sweep's job was to find
out whether that was a quantization choice or a model choice, and it is a model choice.
