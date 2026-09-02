# GLASSWALL evaluation summary

Measured against the real extension in Chromium, on the instrumented bench sites. The extension never reads the instrumentation; the harness does.

| | |
|---|---|
| Hardware | Apple M1 · 8 cores · 8 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v24.20.0 |
| Commit | f769890 |
| Measured | 2026-09-02T06:13:52.535Z |
| Seeds | 1337 |
| Policies | STRICT |

## The five PS metrics

| # | Metric (weight) | Result |
|---|---|---|
| 1 | Visual context accuracy (25%) — interactive controls described vs on screen | recall **100.0%**, precision **100.0%** |
| 2 | PII detection (20%) — values on screen kept off the wire; decoys left alone | recall **100.0%**, precision **100.0%**, leaks **0** |
| 3 | Redaction precision (20%) — redacted regions that covered PII or opaque pixels | **84.5%** |
| 4 | Client resource use (20%) — local compute per step, payload size | **1508 ms**/step local, payload p50 **17.1 KB** |
| 5 | End-to-end latency (15%) — per step | p50 **1559 ms**, p95 **2102 ms** |
|   | Task completion | **0.0%** (0/1 runs) |

## Per run

| task | policy | seed | done | steps | total s | step p50 | visual R/P | PII R/P | redaction P | local ms/step | payload KB | leaks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T4 | STRICT | 1337 | ❌ | 12 | 22.5 | 1559 | 100.0% / 100.0% | 100.0% / 100.0% | 84.5% | 1508 | 17.1 | 0 |

Definitions: visual recall = truth controls matched by a described element of the same tag with IoU ≥ 0.5; PII recall = on-screen instrumented values that never appear on the wire in any of the gate's encodings; PII precision counts a vanished decoy as a false positive; redaction precision = redacted rects that cover instrumented PII, a declared pixel region, a sensitive input (anticipatory shielding), or an opaque element.
