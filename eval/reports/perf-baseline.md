# P13-B baseline — Lane B performance BEFORE optimization

**Measured 2026-09-01T05:54:50.537Z at `543938f1b770958764eb13898ff3a383c4ecd7ce`.**

| | |
|---|---|
| Hardware | Apple M1 · 8 cores · 8 GB |
| OS | macOS 26.5 (arm64) |
| Runtime | Node v24.20.0 |
| Commit | `543938f1b770958764eb13898ff3a383c4ecd7ce` |
| Forced GC available | yes |

This is the only machine in the project, so it is also the weakest one. Every number
below was measured on it. Nothing here is extrapolated to faster hardware.

| metric | value | p95 | n | note |
| --- | --- | --- | --- | --- |
| NER module import | **108.1 ms** | — | 1 | transformers.js + ORT glue |
| NER model load (109MB int8, cold) | **227.8 ms** | — | 1 | device cpu |
| NER first inference | **20.3 ms** | — | 1 | includes graph warm-up |
| NER cold start (import + load + first inference) | **356.2 ms** | — | 1 | what a step pays if the model was never loaded |
| NER warm inference | **13.3 ms** | 18.5 ms | 20 | 170 chars |
| sanitize() per step, STRICT | **0.9 ms** | 7.5 ms | 10 | stub perception sources; fusion + coverage + build are real |
| sanitize() per step, BALANCED | **0.2 ms** | 0.3 ms | 10 | stub perception sources; fusion + coverage + build are real |
| OCR skip decision | **0 ms** | 0.2 ms | 10 | findUnexplainedRegions over the whole observation |
| OCR skip rate, ablation scene | **0 %** | — | 10 | 2 unexplained regions per scene, so OCR runs |
| OCR skip rate, no unexplained regions | **100 %** | — | 1 | the same page with its canvases removed |
| heap after 50 steps | **29.5 MB** | — | 50 | from 29.4MB; checkpoints 29.4 → 29.4 → 29.5 → 29.5 → 29.6 |
| heap growth per 10 steps | **0 MB** | — | 5 | after forced collection |
