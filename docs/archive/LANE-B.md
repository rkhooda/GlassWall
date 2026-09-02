# LANE-B — Perception & Privacy Standing Rules

**Read this first in every session.** This document codifies the boundaries, non-negotiables, and working conventions for Lane B. It is derived from `PLAN-B-PERCEPTION-PRIVACY.md` and takes precedence over any implicit assumption.

---

## Ownership

| Path | Owner | Notes |
|------|-------|-------|
| `packages/privacy/**` | **B** | Entirely yours. Pure TS, zero browser APIs |
| `packages/inference/**` | **B** | ORT-Web wrappers, EP selection, OCR/NER/vision pre+post |
| `packages/perception/spatial-index.ts` | **B** | |
| `packages/perception/observation-builder.ts` | **B** | Allowlist projection into `SanitizedObservation` |
| `packages/perception/geometry.ts` | A | Rect ops, IoU, quantization, coordinate transforms. **Import it, never edit it.** Need a new function? Ask A |
| `packages/schema/**` | A | The contract. You propose changes via the §5 protocol |
| `apps/extension/src/offscreen/pipeline/**` | **B** | `image/`, `ocr.ts`, `ner.ts`, `vision.ts` — every handler body |
| `apps/extension/src/offscreen/{offscreen.html,host.ts,sandbox.html}` | A | Document lifecycle + RPC transport only |
| `apps/extension/src/background/privacy/**` | **B** | `vault-store.ts`, registry persistence in `storage.session` |
| `apps/extension/src/background/**` (rest) | A | Orchestrator, capture, `net.ts`, validator, session |
| `apps/extension/src/content/**` | A | **All of it.** Extractor, executor, overlay |
| `apps/extension/src/sidepanel/privacy/**` | **B** | `Inspector.tsx`, `Handles.tsx` |
| `apps/extension/src/sidepanel/**` (rest) | A | Shell, trace, confirm, error states |
| `apps/extension/manifest.json` | A | Need a CSP change for WASM? **Ask in writing, do not edit** |
| `apps/bench-site/src/sites/{clinicdesk,maillite}/**` | **B** | Canvas / image / free-text PII — your test surface |
| `apps/bench-site/src/sites/{shoplite,govportal}/**` | A | A needs these on day 3 to test extraction |
| `apps/bench-site/src/data/generator.ts` | **B** | Seeded PII generator — drives canaries and labels |
| `apps/bench-site/src/instrument.ts` | **B** | `data-glasswall-*` helper. **Spec due end of day 1** (contract C10) |
| `eval/leakage/**`, `eval/ablations/**` | **B** | |
| `eval/metrics/{privacy,detection}.ts` | **B** | |
| `eval/harness/**`, `eval/tasks/**` | A | |
| `ml/**` | **B** | |
| `config/policies/*.json` | **B** | |
| `scripts/verify-boundary.sh` | **B** | |
| `SECURITY.md`, `PRIVACY.md`, `MODEL_CARD.md`, `EVALUATION.md` | **B** | You write, A reviews for honesty |
| `README.md`, `ARCHITECTURE.md`, `DEMO.md` | A | |

**If a path is not mine I do not commit to it. I append to `docs/REQUESTS-TO-A.md` instead.**

---

## Never

- **Network:** `fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket` anywhere — including for model weights (models ship in the bundle or load via `chrome.runtime.getURL`)
- **Code execution:** `eval` / `Function` / `innerHTML` / `insertAdjacentHTML` anywhere in the execution path; no code path from model output to any of them
- **Reading secrets:** `.value` / `document.cookie` / `localStorage` / `sessionStorage` / `indexedDB` — the extractor is the privacy boundary (Layer 1), not just a parser
- **Leaking values:** a raw value in any log, trace, return value, or error message
- **Vault outside session storage:** a vault value outside `chrome.storage.session`
- **Schema edits:** editing `packages/schema` outside a `contract:` PR
- **A-owned files:** editing anything A-owned (see ownership table)
- **Repo formatting:** repo-wide formatting changes
- **Broken main:** leaving `main` unbuildable — every commit must build and pass the smoke demo

---

## Commits

Format: `type(scope): imperative summary` — **≤50 chars, imperative mood, one line, no body, no footer, no co-author trailer, no emoji, no trailing period, no "and"**

Types: `feat` `fix` `perf` `refactor` `test` `chore` `docs` `model` `sec` `data`

Scopes: `extension` `content` `background` `offscreen` `sidepanel` `perception` `agent` `backend` `schema` `eval` `bench-site` `docs` `privacy` `inference` `ocr` `vision` `ner` `ml`

**Rules:**
- One logical change per commit. Split large changes into multiple commits.
- Summary ≤ 50 chars. No filler words ("add", "implement", "create" → prefer "feat:", "fix:").
- Body only if needed for context (not for every commit).
- Stage explicitly, never `git commit -am`; deps get their own `chore(deps):` commit.
- Expect 4 to 10 commits on this branch.
- Banned: `wip`, `update code`, `fixed stuff`, `final2`, `and`, `also`, `with`.

Examples:
- `feat(privacy): add verhoeff check to aadhaar rule`
- `test(bench): assert generator output is seed stable`
- `perf(inference): reuse ort sessions across steps`

---

## Branches

- Naming: `feat/b-{phase}-{slug}` — e.g. `feat/b-p0-instrumentation`, `feat/b-p6-vault`, `fix/b-verhoeff-edge-case`
- Schema changes: `contract:` prefix (touches only `packages/schema` + fixture)
- Training experiments: `exp/...` — messy is fine, never merged directly
- Branch from fresh `origin/main`
- Rebase daily, never merge `main` in
- Push daily (at least once)
- Never push to `main`
- Never merge my own PR — A reviews and merges
- Branch lifetime ≤ 2 days. Longer means the feature was too big and should have been split.

---

## End of Every Task

1. Update `docs/PROGRESS-B.md` (mark phase complete, fill the entry template)
2. Push the branch
3. Print the filled PR template (from `.github/pull_request_template.md`) to stdout

---

## The Three Sentences (from memory)

> **Layer 1:** we never construct a payload containing sensitive data, because the builder is an allowlist projection.
> **Layer 2:** detectors tokenize whatever residual free text or pixels remain.
> **Layer 3:** the gate refuses to send anything that still matches a known secret, and the browser itself refuses to connect anywhere but our gateway.

And the honest counterpart: we do **not** guarantee perfect recall, non-inference from structure, immunity to malicious pages, or protection against a malicious reasoner. We mitigate. We measure. We publish the residual.