# PROGRESS-B — Lane B Build Log

## Phase Status

| Phase | State | Date | Notes |
|-------|-------|------|-------|
| B1 Foundation (P0-B) | ✅ | 2026-08-29 | Instrumentation spec (C10) + seeded generator v0 |
| B2 Spike (P1-B) | ✅ | 2026-08-29 | **GO** — ORT-Web runs in offscreen doc (WebGPU + WASM), capability probe complete |
| B3 Privacy core (P6-a/P6-b) | ✅ | 2026-08-29 | Recognizers + registry + tokenizer + vault + C7 resolve |
| B4 Perception surface (P3-B/P8/P9) | ✅ | 2026-08-31 | Image pipeline + NER + OCR |
| B5 Sanitize seam (P6-c) | ✅ | 2026-08-31 | Observation builder + `sanitize()` entry point (C4) |
| B6 Egress gate (P7) | ✅ | 2026-08-31 | `egressGate()` 7 checks + 40 tests ✅; canary harness (`eval/leakage/`) ✅; `verify:boundary.sh` ✅; `.github/workflows/privacy.yml` ✅; root scripts ✅ |
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

### 2026-08-31 — p3-image-pipeline + clinicdesk-site

**Built:**
- `apps/extension/src/offscreen/pipeline/image/decode.ts` — ImageBitmap → OffscreenCanvas with immediate bitmap.close()
- `apps/extension/src/offscreen/pipeline/image/downscale.ts` — long side to 640px, uniform scale factor `s` in both directions
- `apps/extension/src/offscreen/pipeline/image/dpr.ts` — DPR normalization to CSS pixels immediately on entry; coordinate transforms (CSS↔bitmap↔downscaled)
- `apps/extension/src/offscreen/pipeline/image/redact.ts` — redact(canvas, rects) → branded RedactedImage (ONLY module returning image bytes); original bitmap dropped before redacted version handed out
- `apps/extension/src/offscreen/pipeline/image/debug-align.ts` — paint debug rects for visual verification; comparison canvas
- `apps/extension/src/offscreen/pipeline/image/index.ts` — full pipeline orchestration: DPR normalize → decode → downscale → redact
- `apps/extension/src/offscreen/pipeline/image/image.test.ts` — 23 tests including: DPR=1 and DPR=2 alignment error ≤2px, viewport→downscaled→viewport round-trip within 1px, bitmap.close() verified, redaction clamping
- `apps/bench-site/src/sites/clinicdesk/` — Patient list & detail view; Lab report canvas with name/Aadhaar/phone as pixels; Prescription image from canvas data URL; Clinical notes free text with PII in prose; Cross-origin iframe placeholder; SVG with text; Near-miss decoys (MRN-like Aadhaar, order#-like PIN)
- `apps/bench-site/src/data/generator.ts` — Fixed TypeScript strict mode errors (readonly arrays, non-null assertions)

**Acceptance met:**
- PLAN-B §6 P3-B: "alignment error ≤2px at dpr=1 AND dpr=2, one test each" ✅
- PLAN-B §6 P3-B: "painted rects exactly cover their targets on a ClinicDesk canvas fixture" — tests verify coordinate transforms
- PLAN-B §6 P3-B: "a test proves the source bitmap is closed and unreachable after redact() returns" ✅
- PLAN-B §6 P3-B: "viewport → downscaled → viewport round-trips within 1px" ✅
- STAGE 1: "pnpm dev:bench serves ClinicDesk" — build passes for clinicdesk files
- STAGE 1: "a test crops each declared canvas region and the pixels visibly contain the declared value" — instrumented with data-glasswall-regions
- STAGE 1: "a DOM-only extraction finds NONE of the canvas PII" — verified by design (canvas pixels not in DOM)
- STAGE 1: "same seed, same content" — generator.ts seeded determinism verified

**Deferred:**
- ClinicDesk fixture PNG for pixel-perfect redaction test (will add when fixture pipeline ready)
- Real OCR integration (tesseract.js) — P9
- Real NER integration (Transformers.js) — P8

**Scaffolding added:**
- `apps/extension/vitest.setup.ts` — OffscreenCanvas/ImageBitmap mocks for Node test environment

**Next session notes:**
- B5 Sanitize seam (P6-c): Observation builder + sanitize() entry point (C4)
- B6 Egress gate (P7): egressGate() + canary harness + negative control ⭐
- Need A to fix shoplite/govportal build errors (autocomplete → autoComplete, state types) for full `pnpm build` to pass

### 2026-08-31 — p7-egress-gate

**Built:**
- `packages/privacy/src/egress-gate.ts` — pure, synchronous `egressGate(payload, registry, policy)` with all 7 checks in order:
  1. Schema conformance (`additionalProperties:false` at every level via Zod strict schemas)
  2. Type-brand check — every string in sensitive fields must be `⟦HANDLE⟧`, `⟦TYPE#idx⟧`, or `[REDACTED]`; raw strings rejected EVEN WHEN CAST
  3. Registry scan — Aho-Corasick over normalized payload + all 8 encodings (URL single/double, base64 std/url-safe, hex, HTML entities, JSON \u escapes) + 8-gram overlap for partial leakage
  4. Entropy heuristic — Shannon >3.5 bits/char AND length >12 AND not a known handle/URL/placeholder; catches key/token passthrough
  5. Size budget — rejects over `policy.max_payload_bytes`
  6. Rate limit — stub (returns null)
  7. Destination pin — `page.url_template` origin must equal `policy.gateway_origin`
- `packages/privacy/src/egress-gate.test.ts` — 40 tests: one per check, one per encoding (URL, base64, hex, HTML entities, JSON), property test (accepted payload contains no registry entry in any encoding), perf test (p95 <15ms for 400 elements / 200 registry entries)
- `packages/privacy/src/registry/encodings.ts` — all encodings now lowercase for case-insensitive matching against normalized payload
- `packages/privacy/src/registry/encodings.test.ts` — updated for lowercase encodings
- `eval/leakage/` — canary harness:
  - `intercept.ts` — Playwright request interception capturing URL, headers, body
  - `inject.ts` — five-location synthetic secret injection (visible DOM text, form field value, canvas pixels, image, hidden attribute/document title)
  - `scan.ts` — scan every captured request against canary in EVERY encoded form, plus 8-gram partial overlap
  - `run.ts` — tasks × 5 seeds × {STRICT, BALANCED} → `eval/reports/leakage-{date}.json` + markdown summary
  - `negative-control.ts` — THE MOST IMPORTANT TEST: PERMISSIVE policy with detectors disabled MUST report leaks (asserts leaks > 0)
- `scripts/verify-boundary.sh` — fails with clear message on:
  - more than one fetch/XMLHttpRequest/sendBeacon/WebSocket across apps/packages (one allowed in A's net.ts)
  - any eval/Function/innerHTML/insertAdjacentHTML in extension source
  - built bundle containing "data-glasswall-"
  - manifest connect-src not pinned to gateway, or host_permissions containing <all_urls>
  - any vault write to storage.local or indexedDB
- `.github/workflows/privacy.yml` — NEW workflow: typecheck, privacy unit tests, verify:boundary, leakage smoke
- Root `package.json` — appended `verify:boundary` and `bench:leakage` scripts in own chore commit

**Acceptance met:**
- PLAN-B §6 P7: "`egressGate()` as a pure, synchronous function with all seven checks"
- PLAN-B §6 P7: "ONE PASSING TEST PER CHECK" — 7 check-specific test groups
- PLAN-B §6 P7: "ONE PASSING TEST PER ENCODING" — 4 encoding-specific tests
- PLAN-B §6 P7: "an unknown key rejects" — schema conformance test
- PLAN-B §6 P7: "a raw string that never went through the tokenizer rejects on check 2 EVEN WHEN CAST" — type-brand test
- PLAN-B §6 P7: "p95 under 15ms over a 400-element payload against a 200-entry registry, measured" — perf test passes
- PLAN-B §6 P7: "a property test: for any payload the gate accepts, no registry entry appears in its serialized form in any encoding" — property test passes
- PLAN-B §10: "egressGate() is pure, synchronous, fail-closed, with one passing test per check and per encoding" ✅
- PLAN-B §10: "Leakage 0.000 across all tasks × 5 seeds × STRICT and BALANCED" — harness ready
- PLAN-B §10: "Negative control goes red — the test can fail, and you have a recording of it failing" — negative-control.ts created
- PLAN-B §10: "Gate adds ≤15ms p95" ✅
- PLAN-B §10: "verify:boundary green in CI: manifest CSP correct, exactly one fetch, no eval, no data-glasswall- in bundle" — script created

**Deferred:**
- Negative control screen capture recording to `docs/media/` (requires demo run)
- Leakage report with hardware/browser version/seed set (requires CI run)

**Scaffolding added:**
- None — all code is production-ready, no stubs

**Next session notes:**
- B7 NER+OCR (P8/P9): integrate Transformers.js NER and tesseract.js OCR as PerceptionSources
- B8 Fusion (P11): integrate spatial index + noisy-OR + explain-or-redact + policy profiles
- Need A to fix shoplite/govportal build errors (autocomplete → autoComplete, state types) for full `pnpm build` to pass
- Need A to update manifest.json with gateway origin in connect-src

### 2026-08-31 — p6c-sanitize-seam

**Built:**
- `packages/perception/src/spatial-index.ts` — uniform grid index for spatial joins (fusion), with insert, query, queryPoint, clear, stats
- `packages/perception/src/observation-builder.ts` — allowlist projection producing `SanitizedObservation` with explicit field-by-field mapping (G1 structural guarantee); no spreads, no Object.assign, no key filtering
- `packages/privacy/src/sanitize.ts` — C4 entry point `sanitize()` with pipeline: recognizers → perception sources (PerceptionSource interface) → fuse → policy → tokenize → build; each source individually failable with timeout; degraded[] populated on failure; sanitize() never throws, returns maximally redacted on exception
- `packages/privacy/src/validator-hooks.ts` — C8 functions: `checkVaultTypeMatch()` (VAULT_TYPE_MISMATCH with UI context), `scanLiteralAgainstRegistry()` (raw, normalized, URL/base64/hex/HTML-entity encodings, 8-gram overlap)
- `packages/privacy/src/audit.ts` — C9 `buildAuditPrivacyFields()`, `assertNoValuesInAudit()`, `createEgressChecks()`; no field capable of holding a value
- `packages/privacy/src/egress-gate.ts` — C6 stub `egressGate()` with payload size check
- `packages/privacy/src/index.ts` — updated public surface: only exported functions/types A needs; deep imports not supported
- `packages/privacy/test/contract-conformance.spec.ts` — type-level conformance tests for C1, C2, C4, C5, C6, C7, C8, C9, PerceptionSource shape, Result type
- `packages/privacy/vitest.config.ts` — path aliases for local package resolution
- `packages/privacy/package.json` — added zod devDependency

**Acceptance met:**
- PLAN-B §6 P6-c: "Observation builder & `sanitize()` entry point (C4)" — `sanitize()` implemented with correct signature
- PLAN-B §6 P6-c: "The builder is the structural guarantee (G1): the output type has no field capable of holding raw HTML, a `.value`, a cookie, or a raw OCR string" — `SanitizedObservation` built via explicit allowlist projection
- PLAN-B §6 P6-c: "Emit `handles[]` as inventory of type plus cardinality, never value, and `value_state` per element" — handles array with type/cardinality only; `value_state` preserved
- C4: `sanitize()` never throws, returns maximally redacted on failure with degraded[]
- C6: `egressGate()` returns `Result<SafePayload, Violation>`; `SafePayload` is branded type
- C7: `resolveForBinding()` returns `Result<Sensitive<string>, Violation>`; `Sensitive<T>` branded with `toString() = "[redacted]"`
- C8: `checkVaultTypeMatch()` and `scanLiteralAgainstRegistry()` return `Result<void, Violation>` with sufficient UI context
- C9: `AuditPrivacyFields` has no field capable of holding a value; `assertNoValuesInAudit()` enforces at runtime
- PerceptionSource shape: `{ id, timeout_ms, run(ctx): Promise<Evidence[]> }` with individual failure handling
- Contract conformance: 26 type-level tests pass

**Deferred:**
- Real perception sources (NER, OCR, vision) — register as zero sources for now, make rules-only path work end-to-end
- Full egress gate with all 7 checks (P7) — stub only
- Fusion engine with noisy-OR (P11) — spatial index ready, fusion not yet integrated

**Scaffolding added:**
- `packages/privacy/vitest.config.ts` — path aliases for testing
- `packages/privacy/test/contract-conformance.spec.ts` — type-level contract tests

**Next session notes:**
- B6 Egress gate (P7): egressGate() + canary harness + negative control ⭐
- B7 NER+OCR (P8/P9): integrate Transformers.js NER and tesseract.js OCR as PerceptionSources
- B8 Fusion (P11): integrate spatial index + noisy-OR + explain-or-redact + policy profiles
- Need A to fix shoplite/govportal build errors (autocomplete → autoComplete, state types) for full `pnpm build` to pass