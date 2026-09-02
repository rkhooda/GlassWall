# P14-B — chaos: every perception source, force-failed

**Measured 2026-09-01T06:28:13.443Z at `fecda0542a80bda57062464c8fcb29e1a6b88b53`.**

| | |
|---|---|
| Hardware | Apple M1 · 8 cores · 8 GB |
| OS | macOS 26.5 (arm64) |
| Runtime | Node v24.20.0 |
| Scene | `eval/ablations/scene.ts`, seed 1337 |
| Configurations | every non-empty subset of {ner, ocr, vision} × {throw, timeout, silent}, plus healthy |

Three failure modes. **throw** and **timeout** are detectable — `sanitize()` sees the
source die and applies its declared `coverage()`. **silent** is a source that loaded,
ran, and returned nothing: indistinguishable from a clean page, and therefore *not*
detectable. It is measured here rather than asserted away. See `SECURITY.md` N1.

### STRICT

| configuration | terminated | degraded[] | redactions | leaked | tier-1 |
| --- | --- | --- | --- | --- | --- |
| healthy | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner throw | yes | ner_error | 12 | 0  | 0 |
| ocr throw | yes | ocr_error | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr throw | yes | ner_error, ocr_error | 12 | 0  | 0 |
| vision throw | yes | vision_error | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+vision throw | yes | ner_error, vision_error | 12 | 0  | 0 |
| ocr+vision throw | yes | ocr_error, vision_error | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr+vision throw | yes | ner_error, ocr_error, vision_error | 12 | 0  | 0 |
| ner timeout | yes | ner_timeout | 12 | 0  | 0 |
| ocr timeout | yes | ocr_timeout | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr timeout | yes | ner_timeout, ocr_timeout | 12 | 0  | 0 |
| vision timeout | yes | vision_timeout | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+vision timeout | yes | ner_timeout, vision_timeout | 12 | 0  | 0 |
| ocr+vision timeout | yes | ocr_timeout, vision_timeout | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr+vision timeout | yes | ner_timeout, ocr_timeout, vision_timeout | 12 | 0  | 0 |
| ner silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |
| ocr silent | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |
| vision silent | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+vision silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |
| ocr+vision silent | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr+vision silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |

- terminated with a schema-valid observation: **22/22**
- tier-1 values exposed, any configuration: **0**
- detectable failures that redacted less than healthy: **0/14**
- detectable failures that leaked more than healthy: **0/14**
- silent failures that leaked more than healthy: **4/7** — undetectable by design, see N1

### BALANCED

| configuration | terminated | degraded[] | redactions | leaked | tier-1 |
| --- | --- | --- | --- | --- | --- |
| healthy | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner throw | yes | ner_error | 12 | 0  | 0 |
| ocr throw | yes | ocr_error | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr throw | yes | ner_error, ocr_error | 12 | 0  | 0 |
| vision throw | yes | vision_error | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+vision throw | yes | ner_error, vision_error | 12 | 0  | 0 |
| ocr+vision throw | yes | ocr_error, vision_error | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr+vision throw | yes | ner_error, ocr_error, vision_error | 12 | 0  | 0 |
| ner timeout | yes | ner_timeout | 12 | 0  | 0 |
| ocr timeout | yes | ocr_timeout | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr timeout | yes | ner_timeout, ocr_timeout | 12 | 0  | 0 |
| vision timeout | yes | vision_timeout | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+vision timeout | yes | ner_timeout, vision_timeout | 12 | 0  | 0 |
| ocr+vision timeout | yes | ocr_timeout, vision_timeout | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr+vision timeout | yes | ner_timeout, ocr_timeout, vision_timeout | 12 | 0  | 0 |
| ner silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |
| ocr silent | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |
| vision silent | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+vision silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |
| ocr+vision silent | yes | — | 12 | 1 (STREET_ADDRESS) | 0 |
| ner+ocr+vision silent | yes | — | 11 | 2 (PERSON_NAME, STREET_ADDRESS) | 0 |

- terminated with a schema-valid observation: **22/22**
- tier-1 values exposed, any configuration: **0**
- detectable failures that redacted less than healthy: **0/14**
- detectable failures that leaked more than healthy: **0/14**
- silent failures that leaked more than healthy: **4/7** — undetectable by design, see N1

## What this found

The suite was written against the current code and immediately failed, twice, on real
fail-open paths:

1. **A source that threw contributed nothing at all** — no evidence *and* no unexplained
   regions, because `sanitize()` had no output to read. Losing NER *raised* leakage from
   1 to 2 and *lowered* redactions from 12 to 11. Fixed by
   `PerceptionSource.coverage()`: a source declares what it is the account for, and
   `sanitize()` applies that when the source dies.
2. **A fused region redacted pixels but never the text.** A text node could be correctly
   marked unexplained, correctly masked in the screenshot, and still ship verbatim in
   the payload. Fixed — for regions carrying no detection evidence only, because
   replacing a whole paragraph where a detector already fired would discard the
   type-preserving tokenization the system exists to provide.

After both fixes, a **crashed NER leaks less than a working one**: losing it makes its
text nodes unaccounted-for, and coverage tokenizes them wholesale, catching the bare
locality the working model misses. The degraded path is strictly safer than the happy
path, which is the property the whole design is aiming at.
