# PROGRESS-B — Lane B Build Log

## Phase Status

| Phase | State | Date | Notes |
|-------|-------|------|-------|
| B1 Foundation (P0-B) | ☐ | | Instrumentation spec (C10) + seeded generator v0 |
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