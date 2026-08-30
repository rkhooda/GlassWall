# GLASSWALL

**Privacy-preserving Runtime for Agent–Host Reasoning Interfaces**  
SIH26171 · ISRO · Software / AI / Computer Vision

> **One-sentence thesis:** Privacy for browser agents is not a detection problem, it is an **architecture** problem: we build the agent's view of the page from an allowlist of non-sensitive facts instead of redacting a raw capture, we let the agent _reference_ sensitive values it can never read, and we prove the boundary holds with an automated canary harness rather than asserting it.

---

## Quickstart (Cold Clone → Demo in 3 Commands)

```bash
# 1. Clone and install
git clone https://github.com/your-org/glasswall.git
cd glasswall
pnpm install

# 2. Build everything
pnpm build

# 3. Start bench sites + backend (two terminals)
# Terminal 1:
pnpm --filter @glasswall/bench-site dev
# Terminal 2:
pnpm --filter @glasswall/backend dev

# 4. Load extension in Chrome
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist

# 5. Open http://localhost:5173/shoplite
# Click extension icon → Type "Fill the shipping form and submit" → Watch it work
```

**That's it.** No API keys, no cloud accounts, no model downloads (models bundled). Works offline.

---

## What This Actually Does

| Capability | How | Verified |
|------------|-----|----------|
| **Local perception** | DOM + A11y + screenshot → structured observation | ✓ T1/T2/T3 complete |
| **Sensitive value protection** | Allowlist construction (explain-or-redact) + vault handles | ✓ 0 leakage in CI |
| **Deferred value binding** | Agent emits `TYPE(e17, @vault:EMAIL#1)` → extension resolves locally | ✓ Form fills, no values in payload |
| **Egress gate** | Single `fetch` in `net.ts`, branded `SafePayload` from `egressGate()` | ✓ Compile-time enforcement |
| **Provable boundary** | Canary harness seeds secrets → asserts absence in raw/normalized/encoded forms | ✓ Runs on every push |

---

## Architecture Overview

```
┌──────────────────────── USER'S DEVICE (TRUSTED) ────────────────────────┐
│                                                                          │
│  Page DOM · A11y tree · Raw screenshot · Raw OCR text · Input values    │
│  Cookies · Storage · Vault (real values) · Secret registry · Audit log   │
│                                                                          │
│  Local models: OCR · sensitive-region detector · PII token classifier   │
│  Policy engine · Fusion engine · Action validator · Executor             │
│                                                                          │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │  EGRESS GATE (single choke point, fail-closed)
                              │  connect-src pinned in manifest CSP
                              ▼
┌──────────────────── NETWORK / REMOTE REASONER (UNTRUSTED) ───────────────┐
│  Sanitized Observation (schema-validated allowlist)                       │
│  Task string (user-authored, scanned)                                     │
│  Redacted screenshot (optional, policy-gated, off in STRICT)              │
│  Sanitized action history · step budget · error codes                     │
└──────────────────────────────────────────────────────────────────────────┘
```

**Three ideas that carry the project:**

1. **Explain-or-Redact** — Every pixel/text released must be explained by a DOM element with known-low sensitivity. Unexplained content (canvas, cross-origin iframe, OCR without DOM owner) is withheld by default.
2. **Vault-Referenced Actions** — Sensitive values become typed handles (`⟦EMAIL#1⟧`). Agent plans with handles; extension resolves at execution time. Form fills correctly, value never hits network/model.
3. **Provable Boundary** — Single egress choke point + manifest CSP `connect-src` + automated canary harness. Fail-closed. Negative control makes test go red on demand.

---

## Honest Scope Statement

**We are a 2-person team executing a 5–6 person, 15-day plan.** We made deliberate cuts up front rather than shipping broken features. This is the §20.3 fallback ladder applied _before_ we started:

| Item | Master Plan | Our Call | Why |
|------|-------------|----------|-----|
| Bench sites | 4 (ShopLite, GovPortal, MailLite, ClinicDesk) | **2 + 1 stretch** — ShopLite, GovPortal, ClinicDesk if time | ClinicDesk earns place only for B's canvas/OCR proof |
| Vision detector (P10) | Full datagen + training | **Stretch only. Cut by default.** | 3 days of B's time; explain-or-redact keeps leakage at 0 without it |
| NER (P8) | Fine-tune DistilBERT | **Off-the-shelf ONNX NER, no training** | Training is 2.5 days B doesn't have |
| OCR (P9) | PP-OCRv5 via raw ORT-Web | **tesseract.js first, PP-OCRv5 as upgrade** | Integration in hours instead of days |
| Ablations | A1–A7 | **A1, A6, A7** | §20.1 already sanctions this |
| Real-site suite | 2–3 public pages | **Cut** | Pure risk, zero demo value |
| Full-page stitch, per-site memory, signed audit log | Stretch | **Cut, do not discuss again** | |

**Never cut** (these four _are_ the project):
- Egress gate
- Canary harness
- Deferred value binding
- Leakage-zero result

**What we don't guarantee** (stated openly in `SECURITY.md`):
- N1: Perfect recall — statistical detectors have finite recall; mitigation is allowlist-first construction
- N2: Non-inference — sanitized observation carries structure; adversary may infer context
- N3: Malicious-page immunity — we mitigate prompt injection; we don't solve it
- N4: Malicious reasoner — validator is defense-in-depth, not a proof
- N5: Side channels — payload size, step counts, timing carry information; out of scope

---

## Repository Structure

```
glasswall/
├── apps/
│   ├── extension/          # MV3 Chromium extension (A owns)
│   │   ├── src/
│   │   │   ├── background/     # Orchestrator, step loop, net.ts, recovery, circuit-breaker, persist
│   │   │   ├── content/        # Extractor, executor, overlay
│   │   │   ├── offscreen/      # Offscreen document host (A), pipeline handlers (B)
│   │   │   ├── sidepanel/      # React UI: Trace, Confirm, ErrorState, ResetDemoButton
│   │   │   └── shared/         # Message bus, types
│   │   └── manifest.json
│   ├── backend/            # Fastify gateway (A owns)
│   │   ├── src/
│   │   │   ├── gateway/        # HTTP routes
│   │   │   ├── prompt/         # Prompt assembly
│   │   │   ├── providers/      # Anthropic, OpenAI, Ollama, ScriptedPlanner
│   │   │   ├── guard/          # Response validation, retry-with-repair
│   │   │   └── schema/         # Shared Zod schemas
│   │   └── package.json
│   └── bench-site/         # Local benchmark sites (A owns ShopLite/GovPortal)
│       └── src/sites/
│           ├── shoplite/     # E-commerce: cart, checkout, orders, tracking
│           ├── govportal/    # Multi-step government form
│           └── clinicdesk/   # Canvas-rendered PII (B's test surface)
├── packages/
│   ├── schema/             # Zod schemas → JSON Schema (A owns, contract: PRs only)
│   ├── perception/         # Geometry, spatial index (A: geometry, B: spatial-index)
│   ├── privacy/            # Recognizers, vault, tokenizer, policy, egress gate (B owns)
│   └── inference/          # ORT-Web wrappers, model registry (B owns)
├── eval/
│   ├── harness/            # Playwright driver, runner, predicates (A owns)
│   ├── tasks/              # T1–T3 YAML tasks (A owns)
│   ├── metrics/
│   │   ├── utility.ts      # Completion rate, step efficiency, semantic fidelity (A)
│   │   └── performance.ts  # Latency p50/p95/p99, NFR checks, baseline diff (A)
│   └── package.json
├── docs/
│   ├── CONTRACTS.md        # C1–C10 interface contracts (canonical)
│   ├── PROGRESS.md         # Phase status tracking
│   └── decisions/          # ADRs for irreversible choices
├── PLAN.md                 # Full architecture + phase specs (authoritative)
├── PLAN-A-AGENT-CONTROL.md # Lane A ownership, sequencing, review checklist
├── PLAN-B-PERCEPTION-PRIVACY.md # Lane B reference only
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

---

## Running the Benchmarks

```bash
# Smoke suite (CI): T1 + T3 × seed 1337 (~3 min)
pnpm --filter @glasswall/eval bench:smoke

# Full suite: all tasks × seeds (unattended)
pnpm --filter @glasswall/eval bench:all

# Leakage test (required check): seeds known secrets, asserts 0 leaks
pnpm --filter @glasswall/eval bench:leakage

# Ablation study: runs A1, A6, A7 across policies
pnpm --filter @glasswall/eval bench:ablation

# Performance: NFR targets (NFR-01 perception ≤400ms p50 WebGPU)
pnpm --filter @glasswall/eval bench:perf
```

**Tiered suites:** smoke runs in CI on every push; full runs locally before tagging.  
**Flaky runs:** 3 retries at same seed, flake rate reported as metric (not hidden).  
**Headless note:** uses `--headless=new` (classic headless fails to load extensions).

---

## Key Commands

```bash
# Build everything
pnpm build

# Typecheck all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Run unit tests
pnpm test

# Verify boundary (CI gate: CSP pinned, one fetch, no eval, no bench attrs in bundle)
pnpm verify:boundary

# Regenerate schema JSON (after contract: PR merge)
pnpm gen:schema
```

---

## Documentation

| File | Contents | Owner |
|------|----------|-------|
| `PLAN.md` | Full architecture + phase specs | Lead |
| `PLAN-A-AGENT-CONTROL.md` | Lane A ownership, sequencing, review checklist | A |
| `PLAN-B-PERCEPTION-PRIVACY.md` | Lane B reference only | B |
| `docs/CONTRACTS.md` | C1–C10 interface contracts (canonical) | Both |
| `ARCHITECTURE.md` | Component map, data flow, ADR index | A |
| `DEMO.md` | Beat-by-beat script with timings | A |
| `SECURITY.md` | Threat model, guarantees, non-guarantees, failure matrix | B |
| `PRIVACY.md` | PII taxonomy, detection pipeline, policy profiles | B |
| `EVALUATION.md` | Methodology, metrics, ablation tables, frontier chart | B |
| `MODEL_CARD.md` | Per model: task, arch, params, license, bias notes | B |

---

## License

Apache-2.0 — see `LICENSE` file.

---

## Acknowledgments

- **WebPII / WebRedact** (Zhao, ICLR 2026) — baseline visual PII detection, cited as prior work
- **OmniParser** (Microsoft) — set-of-mark methodology, referenced
- **ONNX Runtime Web** / **Transformers.js** — in-browser inference runtime
- **Presidio** / **GLiNER** — text PII detection baselines

We stand on the shoulders of this work. Our contribution is the _system_ that closes the loop inside the browser with a verified boundary.