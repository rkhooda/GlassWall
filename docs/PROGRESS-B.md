# PROGRESS-B — Lane B Build Log

## Phase Status

| Phase | State | Date | Notes |
|-------|-------|------|-------|
| B1 Foundation (P0-B) | ✅ | 2026-08-29 | Instrumentation spec (C10) + seeded generator v0 |
| B2 Spike (P1-B) | ☐ | | Inference spike with A — ORT-Web in offscreen, capability probe |
| B3 Privacy core (P6-a/P6-b) | ☐ | | Recognizers complete + tokenizer/vault/registry |
| B4 Perception surface (P3-B/P8/P9) | ☐ | | Image pipeline + NER + OCR |
| B5 Sanitize seam (P6-c) | ☐ | | Observation builder + `sanitize()` entry point (C4) |
| B6 Egress gate (P7) | ☐ | | `egressGate()` + canary harness + negative control ⭐ |
| B7 NER+OCR (P8/P9) | ☐ | | Integrated, chunking, coordinate round-trip |
| B8 Fusion (P11) | ☐ | | Fusion + explain-or-redact + policy engine ⭐ |
| B9 Eval+Inspector (P12-B) | ☐ | | Ablations A1/A6/A7 + Inspector.tsx + Handles.tsx |
| B10 Perf/chaos/docs (P13-B/P14-B/P15-B) | ☐ | | Warmup, chaos (leakage=0 degraded), SECURITY/PRIVACY/MODEL_CARD/EVALUATION |

---

## Pending on A

| Date | What I Need | Why | Blocks What |
|------|-------------|-----|-------------|
| | | | |

---

## Outstanding Scaffolding to Delete

| Date Added | File / Path | Reason | Target Deletion |
|------------|-------------|--------|-----------------|
| | | | |

---

## Entry Template

Copy this block for each completed task/session:

```
### YYYY-MM-DD — <phase-slug>

**Built:**
- <what was implemented>

**Acceptance met:**
- <specific criterion from PLAN-B §6>

**Deferred:**
- <what was consciously skipped and why>

**Scaffolding added:**
- <stubs, flags, temp files that must be deleted later>

**Next session notes:**
- <where to pick up, blockers, decisions needed>
```

### 2026-08-29 — p0-instrumentation

**Built:**
- `docs/LANE-B.md` — standing rules for Lane B (ownership, never-rules, commits, branches, end-of-task)
- `docs/PROGRESS-B.md` — phase table, pending-on-A, scaffolding tracker, entry template
- `docs/REQUESTS-TO-A.md` — append-only request log
- `.github/pull_request_template.md` — PR template from PLAN-B §8
- `docs/INSTRUMENTATION.md` — C10 attribute spec (data-glasswall-* attributes, PII types, tiers, value_id for referential consistency, decoys, canvas/image regions, worked example)
- `apps/bench-site/src/data/generator.ts` — seeded PRNG (mulberry32), generatePersona with valid Verhoeff Aadhaar, Luhn card, GSTIN check char, Indian phone/E.164, PAN, IFSC, UPI, DOB, address, PIN, IPv4, high-entropy secret, MRN, clinical paragraph with embedded PII
- `apps/bench-site/src/data/generator.test.ts` — 17 tests: seed determinism, all checksums valid, all decoys fail checksums, referential consistency (same value_id for same value), schema compliance
- `apps/bench-site/src/instrument.ts` — framework-free attribute helpers (piiAttrs, regionsAttr, applyAttrs, piiAttrsInput/Span/Canvas/Image/TextBlock)
- `apps/bench-site/src/instrument.test.ts` — 9 tests for attribute helpers

**Acceptance met:**
- PLAN-B §6 P0-B: "A can instrument a page from your spec without asking you a question"
- PLAN-B §6 P0-B: "Same seed → identical PII across runs"
- PLAN-B §6 P6-a: "Tests: table tests with positive, negative and near-miss cases for every type — a 12-digit number that fails Verhoeff, a card number that fails Luhn, a PAN-shaped string that is not a PAN"
- PLAN-B §6 P6-a: "Aadhaar-shaped 12 digits WITH A VALID VERHOEFF CHECK DIGIT"
- PLAN-B §6 P6-a: "GSTIN with a valid check character"
- PLAN-B §6 P6-a: "Credit card with Luhn"

**Deferred:**
- ClinicDesk/MailLite site instrumentation (will use generator + instrument.ts when building those sites)
- exportGroundTruth writes to eval/fixtures/ (directory created on demand)

**Scaffolding added:**
- None — all code is production-ready, no stubs

**Next session notes:**
- B2 Spike (P1-B): Pair with A on inference spike — ORT-Web in offscreen document, capability probe, WebGPU/WASM parity
- Need to verify ORT-Web runs in MV3 offscreen; if not, escalate to Node sidecar by end of day 2