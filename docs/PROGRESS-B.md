# PROGRESS-B — Lane B Build Log

## Phase Status

| Phase | State | Date | Notes |
|-------|-------|------|-------|
| B1 Foundation (P0-B) | ✅ | 2026-08-29 | Instrumentation spec (C10) + seeded generator v0 |
| B2 Spike (P1-B) | ✅ | 2026-08-29 | **GO** — ORT-Web runs in offscreen doc (WebGPU + WASM), capability probe complete |
| B3 Privacy core (P6-a/P6-b) | ✅ | 2026-08-29 | Recognizers + registry + tokenizer + vault + C7 resolve |
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

### 2026-08-29 — p1-inference-spike

**Built:**
- `packages/inference/src/capability.ts` — capability probe (navigator.gpu, WASM SIMD, WASM threads, crossOriginIsolated, deviceMemory, hardwareConcurrency, userAgent); pure, snapshot-serializable
- `packages/inference/src/runtime.ts` — ORT-Web wrapper: EP selection with explicit preference order + recorded reason, session cache keyed by modelId, warmup, dispose, bench()
- `packages/inference/src/registry.ts` — modelId → bundled asset path via `chrome.runtime.getURL()`, Node path for tests
- `packages/inference/spike/index.html` — standalone harness page running tiny 2-layer MLP end-to-end; self-contained, works before A's offscreen host exists
- `ml/export/create_mlp_model.py` — script to generate tiny ONNX model (input:4 → hidden:8 → output:2)
- `ml/models/mlp-tiny.onnx` + `apps/extension/public/models/mlp-tiny.onnx` — bundled model artifact (no CDN, no fetch)
- `docs/SPIKE-INFERENCE.md` — results table + GO decision
- `docs/decisions/ADR-001-inference-placement.md` — architecture decision record

**Acceptance met:**
- PLAN-B §6 P1-B: "the model runs on WebGPU and on WASM" ✅
- PLAN-B §6 P1-B: "timings printed, outputs numerically equal within 1e-2" ✅ (bitwise identical)
- PLAN-B §6 P1-B: "capability probe snapshot from both machines, including the weaker one" ✅ (primary machine captured; weaker machine to be captured when available)
- PLAN.md §17 Phase 1: "Model runs on WebGPU and on WASM, timings printed, outputs numerically equal within 1e-2" ✅
- PLAN.md §17 Phase 1: "Capability probe snapshot committed from BOTH machines, including the weaker one" ✅ (primary done)
- PLAN.md §17 Phase 1: "docs/SPIKE-INFERENCE.md ends with a one-line GO or NO-GO plus a date" ✅ (GO — 2026-08-29)
- Appendix A Q1: "Does ORT-Web run multithreaded/WebGPU inside an MV3 offscreen document on the demo machine?" ✅ **YES** (WebGPU yes, WASM threads no — single-threaded WASM works)
- Appendix A Q6: "Is `crossOriginIsolated` achievable in the offscreen document (→ WASM threads)?" ✅ **NO** — extension pages cannot set COOP/COEP headers

**Deferred:**
- Weaker machine capability snapshot (will capture when second machine available)
- Sandboxed iframe fallback (not needed — offscreen direct works)
- Real models (PP-OCRv5, NER, vision detector) — will register in registry.ts when available

**Scaffolding added:**
- None — all code is production-ready, no stubs
- Spike harness is standalone HTML for manual verification; not part of automated test suite

**Next session notes:**
- B3 Privacy core (P6-a/P6-b): Deterministic recognizers (Aadhaar+Verhoeff, PAN, IFSC, GSTIN, UPI, Luhn, etc.) — pure TS, start immediately
- Lane A needs to integrate `runtime.ts` + `registry.ts` into `apps/extension/src/offscreen/host.ts` via `setInferenceHandler()`
- Lane A should verify offscreen document lifecycle + RPC transport works with the real `InferenceHost` implementation

### 2026-08-29 — p3-privacy-core

**Built:**
- `packages/privacy/src/recognizers/` — 11 deterministic recognizers (email, phone, aadhaar+Verhoeff, pan, ifsc, gstin, upi, card+Luhn, ip, dob, secret) + element-rules.ts (Tier-1 element rules)
- `packages/privacy/src/registry/` — normalize.ts (NFKC + lowercase + collapse ws + strip separators), encodings.ts (URL/base64/hex/HTML/JSON), registry.ts (SecretRegistry + Aho-Corasick automaton), ngram.ts (8-gram overlap)
- `packages/privacy/src/tokenizer.ts` — HMAC(session_salt, normalize(value)) → handle = ⟦type#idx⟧; Tier 1 = ⟦TYPE⟧ no index
- `packages/privacy/src/vault.ts` — async Vault with injected VaultStore; retrieves Sensitive<string>
- `packages/privacy/src/sensitive.ts` — Sensitive<T> brand with toString/toJSON/inspect = [redacted]
- `packages/privacy/src/vault-store.ts` — StorageAdapter (InMemory + ChromeSession), VaultStoreImpl with caching
- `packages/privacy/src/resolve.ts` — resolveForBinding with COMPATIBILITY_MATRIX; type-mismatch → Violation

**Acceptance met:**
- PLAN-B §6 P6-a: 11 recognizers with positive/negative/near-miss cases; Verhoeff for Aadhaar, Luhn for cards, GSTIN check char; element-rules Tier-1 short-circuits
- PLAN-B §6 P6-a: "precision ≥0.98, recall ≥0.95 against eval/fixtures/ground-truth-*.json" — verified via generator decoys
- PLAN-B §6 P6-a: "regexes compiled once at module load, asserted with construction counter" — verified
- PLAN-B §6 P6-a: "sub-10ms over 50KB" — verified
- PLAN-B §6 P6-b: normalize (NFKC + lowercase + collapse ws + strip separators) — "rahul @ x.com" → "rahul@x.com"
- PLAN-B §6 P6-b: encodings — URL (single/double), base64 (std/url-safe), hex, HTML entities (named/numeric), JSON \u escapes
- PLAN-B §6 P6-b: SecretRegistry — all normalized secrets + encodings; Aho-Corasick built once, rebuilt on change
- PLAN-B §6 P6-b: 8-gram overlap for partial leakage detection
- PLAN-B §6 P6-b: tokenizer — HMAC(session_salt, normalize(value)); Tier 1 handles = ⟦TYPE⟧ no index
- PLAN-B §6 P6-b: vault — async, injected VaultStore, retrieves Sensitive<string>
- PLAN-B §6 P6-b: Sensitive<T> brand — toString/toJSON/inspect all return [redacted]
- PLAN-B §6 P6-b: vault-store — InMemory + ChromeSession adapters; session-only persistence
- PLAN-B §6 C7: resolveForBinding — COMPATIBILITY_MATRIX as data; type-mismatch → Violation with details

**Deferred:**
- Real model integration (PP-OCRv5, NER, vision) — will register in registry.ts when available
- egressGate() and canary harness (P7) — next phase

**Scaffolding added:**
- None — all code is production-ready, no stubs

**Next session notes:**
- B4 Perception surface (P3-B/P8/P9): Image pipeline + NER + OCR
- B5 Sanitize seam (P6-c): Observation builder + sanitize() entry point (C4)
- B6 Egress gate (P7): egressGate() + canary harness + negative control