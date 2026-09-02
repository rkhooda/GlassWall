# GLASSWALL evaluation summary

Measured against the real extension in Chromium, on the instrumented bench sites. The extension never reads the instrumentation; the harness does.

| | |
|---|---|
| Hardware | Apple M1 · 8 cores · 8 GB |
| OS | Darwin 25.5.0 (arm64) |
| Node | v24.20.0 |
| Commit | 2b014ce |
| Measured | 2026-09-02T09:42:36.741Z |
| Seeds | 1337, 42, 7 |
| Policies | STRICT, BALANCED |

## The five PS metrics

| # | Metric (weight) | Result |
|---|---|---|
| 1 | Visual context accuracy (25%) — interactive controls described vs on screen | recall **97.8%**, precision **99.7%** |
| 2 | PII detection (20%) — values on screen kept off the wire; decoys left alone | recall **100.0%**, precision **97.7%**, leaks **0** |
| 3 | Redaction precision (20%) — redacted regions that covered PII or opaque pixels | **95.6%** |
| 4 | Client resource use (20%) — local compute per step, payload size | **1803 ms**/step local, payload p50 **41.0 KB** |
| 5 | End-to-end latency (15%) — per step | p50 **2126 ms**, p95 **2699 ms** |
|   | Task completion | **100.0%** (33/33 runs) |

## Per run

| task | policy | seed | done | steps | total s | step p50 | visual R/P | PII R/P | redaction P | local ms/step | payload KB | leaks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | STRICT | 1337 | ✅ | 10 | 15.7 | 976 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 1163 | 16.9 | 0 |
| T1 | STRICT | 42 | ✅ | 10 | 13.1 | 1005 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 936 | 16.9 | 0 |
| T1 | STRICT | 7 | ✅ | 10 | 11.3 | 891 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 811 | 17.0 | 0 |
| T1 | BALANCED | 1337 | ✅ | 10 | 12.1 | 936 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 879 | 62.4 | 0 |
| T1 | BALANCED | 42 | ✅ | 10 | 12.1 | 943 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 896 | 62.2 | 0 |
| T1 | BALANCED | 7 | ✅ | 10 | 13.7 | 965 | 88.0% / 98.2% | 100.0% / 100.0% | 91.2% | 998 | 62.4 | 0 |
| T2 | STRICT | 1337 | ✅ | 2 | 4.5 | 1858 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1454 | 14.7 | 0 |
| T2 | STRICT | 42 | ✅ | 2 | 4.4 | 1819 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1423 | 14.7 | 0 |
| T2 | STRICT | 7 | ✅ | 2 | 4.0 | 1784 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1386 | 14.7 | 0 |
| T2 | BALANCED | 1337 | ✅ | 2 | 6.4 | 2401 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 2221 | 60.1 | 0 |
| T2 | BALANCED | 42 | ✅ | 2 | 10.8 | 8322 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 4944 | 60.1 | 0 |
| T2 | BALANCED | 7 | ✅ | 2 | 7.1 | 3031 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 2326 | 60.1 | 0 |
| T3 | STRICT | 1337 | ✅ | 4 | 7.8 | 1492 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1280 | 14.7 | 0 |
| T3 | STRICT | 42 | ✅ | 4 | 7.1 | 1334 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1222 | 14.7 | 0 |
| T3 | STRICT | 7 | ✅ | 4 | 8.5 | 1332 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1450 | 14.7 | 0 |
| T3 | BALANCED | 1337 | ✅ | 4 | 13.0 | 3397 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 2495 | 60.1 | 0 |
| T3 | BALANCED | 42 | ✅ | 4 | 12.6 | 2760 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 2354 | 60.1 | 0 |
| T3 | BALANCED | 7 | ✅ | 4 | 10.7 | 2551 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1947 | 60.1 | 0 |
| T4 | STRICT | 1337 | ✅ | 13 | 28.6 | 1866 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 1796 | 16.2 | 0 |
| T4 | STRICT | 42 | ✅ | 13 | 28.0 | 2027 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 1760 | 16.4 | 0 |
| T4 | STRICT | 7 | ✅ | 13 | 24.8 | 1363 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 1474 | 16.2 | 0 |
| T4 | BALANCED | 1337 | ✅ | 13 | 23.3 | 1216 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 1375 | 82.1 | 0 |
| T4 | BALANCED | 42 | ✅ | 13 | 20.3 | 1178 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 1141 | 83.0 | 0 |
| T4 | BALANCED | 7 | ✅ | 13 | 18.9 | 1091 | 100.0% / 100.0% | 100.0% / 100.0% | 92.9% | 1098 | 81.7 | 0 |
| T5 | BALANCED | 1337 | ✅ | 2 | 8.6 | 4039 | 100.0% / 100.0% | 100.0% / 75.0% | 83.3% | 3314 | 64.4 | 0 |
| T5 | BALANCED | 42 | ✅ | 2 | 7.1 | 3385 | 100.0% / 100.0% | 100.0% / 75.0% | 83.3% | 2672 | 63.9 | 0 |
| T5 | BALANCED | 7 | ✅ | 2 | 9.2 | 4034 | 100.0% / 100.0% | 100.0% / 75.0% | 82.4% | 3898 | 65.0 | 0 |
| T7 | STRICT | 1337 | ✅ | 2 | 4.4 | 1671 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1471 | 10.0 | 0 |
| T7 | STRICT | 42 | ✅ | 2 | 5.1 | 1805 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1583 | 10.1 | 0 |
| T7 | STRICT | 7 | ✅ | 2 | 4.3 | 1632 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1450 | 10.0 | 0 |
| T7 | BALANCED | 1337 | ✅ | 2 | 7.6 | 3350 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 2914 | 49.5 | 0 |
| T7 | BALANCED | 42 | ✅ | 2 | 4.8 | 1770 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1543 | 49.8 | 0 |
| T7 | BALANCED | 7 | ✅ | 2 | 5.1 | 1927 | 100.0% / 100.0% | 100.0% / 100.0% | 100.0% | 1820 | 49.6 | 0 |

Definitions: visual recall = truth controls matched by a described element of the same tag with IoU ≥ 0.5; PII recall = on-screen instrumented values that never appear on the wire in any of the gate's encodings; PII precision counts a vanished decoy as a false positive; redaction precision = redacted rects that cover instrumented PII, a declared pixel region, a sensitive input (anticipatory shielding), or an opaque element.
