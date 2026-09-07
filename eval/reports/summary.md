# GLASSWALL evaluation summary

Measured against the real extension in Chromium, on the instrumented bench sites. The extension never reads the instrumentation; the harness does.

| | |
|---|---|
| Hardware | Apple M1 · 8 cores · 8 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v24.20.0 |
| Commit | a13a20d |
| Measured | 2026-09-07T19:47:56.959Z |
| Seeds | 1337 |
| Policies | STRICT, BALANCED |

## The five PS metrics

| # | Metric (weight) | Result |
|---|---|---|
| 1 | Visual context accuracy (25%) — interactive controls described vs on screen | recall **97.8%**, precision **99.7%** |
| 2 | PII detection (20%) — values on screen kept off the wire; decoys left alone | recall **100.0%**, precision **97.7%**, leaks **0** |
| 3 | Redaction precision (20%) — redacted regions that covered PII or opaque pixels | **95.6%** |
| 4 | Client resource use (20%) — local compute per step, payload size | **1059 ms**/step local, payload p50 **42.1 KB** |
| 5 | End-to-end latency (15%) — per step | p50 **3446 ms**, p95 **4666 ms** |
|   | Task completion | **100.0%** (11/11 runs) |

## Per run

| task | policy | seed | done | steps | total s | step p50 | visual R/P | PII R/P | redaction P | local ms/step | payload KB | leaks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | STRICT | 1337 | ✅ | 10 | 44.2 | 4080 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 628 | 16.9 | 0 |
| T1 | BALANCED | 1337 | ✅ | 10 | 42.3 | 4026 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 804 | 62.3 | 0 |
| T2 | STRICT | 1337 | ✅ | 2 | 6.2 | 2958 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 849 | 14.6 | 0 |
| T2 | BALANCED | 1337 | ✅ | 2 | 6.9 | 3653 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1026 | 60.0 | 0 |
| T3 | STRICT | 1337 | ✅ | 2 | 6.2 | 3147 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1248 | 15.0 | 0 |
| T3 | BALANCED | 1337 | ✅ | 2 | 6.4 | 3147 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1168 | 70.8 | 0 |
| T4 | STRICT | 1337 | ✅ | 13 | 39.3 | 2524 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 750 | 16.1 | 0 |
| T4 | BALANCED | 1337 | ✅ | 13 | 45.3 | 2670 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 844 | 82.2 | 0 |
| T5 | BALANCED | 1337 | ✅ | 2 | 9.6 | 5412 | 100.0% / 100.0% | 100.0% / 75.0% | 83.3% | 1928 | 65.2 | 0 |
| T7 | STRICT | 1337 | ✅ | 2 | 6.5 | 3030 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1144 | 10.0 | 0 |
| T7 | BALANCED | 1337 | ✅ | 2 | 6.6 | 3261 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1257 | 49.5 | 0 |

Definitions: visual recall = truth controls matched by a described element of the same tag with IoU ≥ 0.5; PII recall = on-screen instrumented values that never appear on the wire in any of the gate's encodings; PII precision counts a vanished decoy as a false positive; redaction precision = redacted rects that cover instrumented PII, a declared pixel region, a sensitive input (anticipatory shielding), or an opaque element.
