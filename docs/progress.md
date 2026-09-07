# GLASSWALL — Progress (single source of truth)

Problem statement: **SIH26171 · ISRO · On-device Visual Perception for Light-weight
Browser Agents**. Scoring at the finale: visual-context accuracy 25%, PII
precision/recall 20%, redaction precision 20%, client resource utilization 20%,
end-to-end latency 15%. Use cases are supplied by the judges.

Nothing in this file is marked complete until it is implemented and verified by a
command that can be re-run.

## PROJECT STATUS

| | |
|---|---|
| Overall completion | **~92%** |
| Core functionality (closed observe → reason → act loop) | **100%** — 33/33 bench runs complete (T1–T5, T7 × 3 seeds × STRICT/BALANCED), 0 leaks; smoke re-run green after the lint refactor |
| SIH requirement coverage | **~90%** — all five PS metrics measured end to end; local NER + OCR + pixel redaction in the loop; open-weights reasoner via any OpenAI-compatible endpoint with Anthropic and a scripted planner as fallbacks; no trained face detector (extension point only) |
| Testing | **~90%** — 503 unit/integration tests across 8 packages incl. the orchestrator error matrix; Playwright smoke, full suite and leakage canary with a negative control; `build`, `typecheck`, `test`, `lint`, `verify:boundary` all green; CI wired |
| Demo readiness | **~90%** — every DEMO.md beat except the judge's unseen page and the Ollama/LLM beat has been driven by the harness on this machine; docs reconciled to the build |

| Phase | Status | Completion | Notes |
|---|---|---|---|
| 0 — Foundation and cleanup | ✅ COMPLETE | 100% | build, typecheck, test, lint, boundary all green; `ml` package reduced to the vendoring script |
| 1 — Extension shell that loads and observes | ✅ COMPLETE | 100% | verified in Chromium: panel, content script, overlay, `verify:boundary` 8/8 |
| 2 — Privacy seam: sanitize ↔ vault ↔ gate ↔ net | ✅ COMPLETE | 100% | integration test: sanitize → gate accepts; vault resolves; exfiltration blocked; handles stable; one handle per value |
| 3 — Closed loop: orchestrator, gateway, execution | ✅ COMPLETE | 100% | T1–T5, T7 complete in Chromium with 0 leaks; injection blocked (VAULT_TYPE_MISMATCH); gateway failover tested |
| 4 — Side panel UI and page overlay | ✅ COMPLETE | 100% | gateway chip, run summary, trace, privacy inspector + reasons, audit export, confirm modal, page overlay; RTL tests |
| 5 — Local vision: OCR, NER, redacted screenshot | ✅ COMPLETE | 100% | NER (WASM) on DOM text every profile; OCR reads Aadhaar/phone off the ClinicDesk canvas under BALANCED; pixel-redacted 640px PNG on the wire; STRICT never captures |
| 6 — Bench sites, harness, PS-aligned evaluation | ✅ COMPLETE | 100% | `bench:all` 33/33, 0 leaks; `bench:leakage` 0 findings on 46 requests, UNSAFE control leaks 6; five PS metrics in `eval/reports/summary.md`; CI runs smoke + leakage |
| 7 — Hardening, tests, reliability | ✅ COMPLETE | 95% | orchestrator error matrix (11 tests); blocked-literal history leak, cross-run vault staleness and NER/label false positives fixed; lint zero errors; two consecutive unattended scripted runs (`bench:all`, then `bench:leakage` + smoke) green. Not done: an LLM-provider e2e run (no key or Ollama on the machine; failover covered by `backend.test.ts`) |
| 8 — Demo and documentation | ✅ COMPLETE | 95% | README, DEMO, ARCHITECTURE, SECURITY, PRIVACY, EVALUATION, MODEL_CARD, CONTRACTS rewritten to the build; final audit below. Not done: a judge-facing rehearsal of beat 9 on an unseen public page |

## Current Gaps (as of 2026-09-08, after the live-provider rehearsal)

- Closed 2026-09-08: an LLM provider now drives the loop end to end. Rehearsal on
  Gemini (`gemini-3.6-flash`, falling back through `gemini-3.1-flash-lite`, two free
  OpenRouter models and three Groq models) was 11/11 tasks across all three sites in
  both policies, 0 leaks, at `eval/reports/summary.md`.
- Free-tier request budgets, not the code, are the demo constraint: Gemini allows 20
  requests/minute, so back-to-back automated suites throttle and fall down the chain
  (a live demo, one task at a time, does not). Groq is ~8k tokens/minute per model
  plus a daily cap; OpenRouter free models are 20/min and 50/day and are noticeably
  weaker on long multi-step tasks — fallback material, not a primary.
- The keys live only in `apps/backend/.env`, which is gitignored, and the local model
  weights under `apps/extension/public/` are not in the repo. A fresh clone or a
  different machine needs both restored before anything but the scripted planner runs.
- `guard/validate.ts` does not validate `NAVIGATE.url_template`; only the
  orchestrator's same-origin check constrains it, and models do emit NAVIGATE freely.
- `scrubPlaceholder()` only masks recognizer-shaped placeholder text, while labels get
  full registry substitution. One `REGISTRY_SCAN` gate violation was seen on a
  placeholder and could not be reproduced in ~40 later runs.
- Redaction precision is 95.6% overall and 83% on ClinicDesk: OCR crops around the
  canvas report are larger than the instrumented regions.
- T1 visual recall is 88%: the checkout's cross-origin gift-message iframe input is a
  truth control the extractor reports as a frame, not an element.
- BALANCED steps cost 2–4 s on the first OCR pass per page (WASM); NER runs on WASM,
  WebGPU is probed but not used for the NER session.
- No trained face/visual-PII detector; image regions without a DOM owner are masked
  wholesale.
- NER STREET_ADDRESS recall 0.84 on bare localities in prose; covered in the loop by
  label context and explain-or-redact, but free prose with a bare locality can pass.

## Must Fix (before any judge demo)

Nothing outstanding. Rehearse DEMO.md once on the demo machine; vendor the models
(`bash ml/fetch-models.sh`) and configure a provider in `apps/backend/.env` if one is
available.

## Nice to Have

Ollama provider on the demo machine (the "unplug the network" beat); a face/person
detector for the PS's "blur faces" example; rate-limit gate check; smaller NER encoder
(≤ 30 MB); Firefox port (needs a non-offscreen inference host).

---

## Phase 0 — Foundation and cleanup

### Objective
A clean clone builds, typechecks, tests and lints green; the gateway starts; the bench
sites render; dead code and stale plans are out of the way.

### What to build
- Fix bench-site compile errors; rebuild ShopLite with seeded persona, checkout ids that
  match `eval/tasks/T1.yaml`, orders, account, and a prompt-injection page.
- Bench shell mounting `/shoplite`, `/govportal`, `/clinicdesk` under one router.
- `eval` and `ml` as workspace members; `packages/schema` emits JS.
- Gateway runs as ESM under `tsx`; no `pino-pretty`.
- Delete placeholders and dead files; archive lane plans to `docs/archive/`.
- ESLint: advisory type-aware rules demoted to warnings; real errors fixed.
- `CLAUDE.md`/`AGENTS.md` rewritten for single ownership.

### Files / modules
`apps/bench-site/**`, `apps/backend/{package.json,src/index.ts,tsconfig.json}`,
`pnpm-workspace.yaml`, `packages/schema/tsconfig.json`, `.eslintrc.cjs`, `CLAUDE.md`,
`docs/archive/**`, `docs/progress.md`.

### Dependencies
None.

### Testing
`pnpm build && pnpm typecheck && pnpm test && pnpm lint`; `curl :3000/v1/health`;
open `http://localhost:5173/shoplite/?seed=1337`.

### Definition of Done
- [x] `pnpm --filter @glasswall/bench-site build` green, ShopLite/GovPortal/ClinicDesk render
- [x] Gateway starts and answers `/v1/health`
- [x] `eval` and `ml` in the workspace
- [ ] `pnpm build && pnpm typecheck && pnpm test` green across the workspace
- [ ] `pnpm lint` exits 0
- [x] Stale plans archived, `CLAUDE.md` rewritten

### SIH relevance
Reproducibility (a judge or teammate can build it).

---

## Phase 1 — Extension shell that loads and observes

### Objective
The extension loads in Chrome with zero console errors, the side panel opens, and the
content script returns a complete `RawObservation` for the active tab.

### What to build
- `manifest.json`: `content_scripts` for `http(s)://*/*`, `side_panel.default_path`,
  action opens the panel, permissions `activeTab scripting storage sidePanel offscreen tabs`,
  `host_permissions` only the gateway origin, CSP with `'wasm-unsafe-eval'` and
  `connect-src` pinned to the gateway. Gateway origin lives in one constant.
- Offscreen page built by Vite (`src/offscreen/offscreen.html` → `host.ts`); the
  sandbox fallback is removed.
- One typed message module (`shared/messages.ts`) for every channel; the panel listens
  on `chrome.runtime.onMessage`.
- Content script: no `chrome.scripting`; `id_hash` computed by a shared
  `content/identity.ts`; `autocomplete` and `input_type` emitted; `value_state` derived
  without reading `.value`; harness hooks as `data-gw-eval-*` attributes.
- Delete `shared/bus.ts`, `shared/flags.ts`, `shared/offscreen-rpc.ts`, the sanitize
  stub test and the placeholder test.

### Files / modules
`apps/extension/manifest.json`, `vite.config.ts`, `src/shared/{config,messages}.ts`,
`src/background/index.ts`, `src/content/{index,identity}.ts`,
`src/content/extractor/walk.ts`, `src/offscreen/{offscreen.html,host.ts}`.

### Dependencies
Phase 0.

### Testing
jsdom tests for the extractor (shadow root, same-origin iframe, password field,
`.value` never read, `id_hash` stable across two walks); manual load in Chrome.

### Definition of Done
- [x] `verify:boundary` check 8 (no `.value` in extractor) green
- [x] Load unpacked: no errors in service worker, panel, content script consoles
- [x] Start on ShopLite → panel shows "observed N elements"

### SIH relevance
Client-side component running in Chrome; visual-context accuracy (structure extraction).

---

## Phase 2 — Privacy seam: sanitize ↔ vault ↔ gate ↔ net

### Objective
A real page passes `sanitize → egressGate → send` with every detected value tokenized,
registered, and resolvable from the vault; nothing else reaches the network.

### What to build
- `SessionSecrets` (registry + tokenizer + vault entries) shared across steps and
  persisted to `chrome.storage.session`; `sanitize()` reuses it and returns
  `secrets_added` so the orchestrator writes the vault.
- One `PiiType` vocabulary across recognizers, tokenizer, compat matrix and planner
  (`contract:` change widening `PiiTypeSchema`).
- Gate redesign: validates `StepRequest`/`SessionRequest` (new `packages/schema/src/transport.ts`),
  check 2 = deterministic recognizer sweep over released strings + handle-shape check,
  destination pin against the configured gateway, `SafePayload = {brand, destination, path, body}`.
- `net.ts` posts `body` to `destination + path`; `capture.ts` decodes the data URL without `fetch`.
- `verify-boundary.sh` catches bare `fetch(`, checks `host_permissions` and the CSP pin.

### Files / modules
`packages/privacy/src/{session-secrets,sanitize,egress-gate,tokenizer,resolve,validator-hooks,policy}.ts`,
`packages/schema/src/{policy,branded,transport}.ts`, `apps/extension/src/background/{net,capture}.ts`,
`scripts/verify-boundary.sh`, `config/policies/*.json`.

### Dependencies
Phase 1 (config constant), schema build.

### Testing
`packages/privacy/src/integration.test.ts`: realistic raw observation → sanitize → gate
accepts; registry non-empty; `resolveForBinding('⟦EMAIL#1⟧')` resolves; a raw Aadhaar
smuggled into a label is rejected by the sweep. Existing gate/tokenizer/resolve suites
updated and green.

### Definition of Done
- [x] Integration test green (`packages/privacy/src/integration.test.ts`)
- [x] `verify:boundary` 8/8
- [x] Handles stable across two consecutive `sanitize()` calls with the same secrets

### SIH relevance
Privacy-preserving filter; "only anonymized data transmitted"; PII P/R and redaction precision.

---

## Phase 3 — Closed loop: orchestrator, gateway, execution

### Objective
T1 ("Fill the shipping form and submit") completes on ShopLite end to end, with only
handles on the wire, using the scripted planner and, when configured, an LLM.

### What to build
- Orchestrator rewrite: session creation via `/v1/session` (through the gate), step loop
  with real budgets, action history, abort mid-await, audit records, persistence.
- Gateway providers: `openai-compatible` (Ollama / Groq / OpenRouter / vLLM; open-weights
  per the PS), `anthropic` (fallback), `scripted` (generic form filling by input
  type/autocomplete/label + vault handle type). Per-request failover; `/v1/health`
  reports providers; `/v1/step` returns the provider used; real repair retry.
- Executor protocol `{action, observation}` → `ActionResult`; identity hash recomputed.
- ShopLite injection page for the blocked-exfiltration beat.

### Files / modules
`apps/extension/src/background/{orchestrator,audit,session}.ts`, `apps/backend/src/{routes,providers,prompt,guard}/**`,
`apps/extension/src/content/{index,executor/**}.ts`.

### Dependencies
Phases 1–2.

### Testing
Backend: `fastify.inject` tests for session/step/health, failover, repair, DONE
predicate. Orchestrator: unit tests with a mocked `chrome` and a fake gateway.
Manual: T1 on ShopLite, DevTools Network shows handles only; injection page yields
`VAULT_TYPE_MISMATCH`; backend stopped → clear error, Abort works.

### Definition of Done
- [x] T1 completes with scripted provider (Chromium e2e driver, 10 steps, DONE success, 0 leaks on the wire)
- [ ] T1 completes with an LLM provider when configured (provider code + failover tested; live LLM run pending a key/Ollama)
- [x] Injection page blocked and logged (`GLASSWALL_DEMO_HIJACKED=1` simulated hijack → VAULT_TYPE_MISMATCH)
- [x] Gateway down → panel error within 10 s, no hang (`GATEWAY_UNREACHABLE`)

### SIH relevance
End-to-end task; server-side integration returning UI actions; latency metric.

---

## Phase 4 — Side panel UI and page overlay

### Objective
A judge can follow the whole flow from the panel and the page: what was observed, what
was redacted and why, what was sent, what the agent did.

### What to build
- `App.tsx` with plain CSS: policy selector, provider/capability status, task input,
  Start/Abort; **Run** tab (trace with local/network latency split, redactions,
  degraded sources, errors, confirm modal); **Privacy** tab (existing Inspector +
  Handles, redaction reasons, audit export).
- Page overlay drawing numbered elements and redaction boxes with reasons.

### Files / modules
`apps/extension/src/sidepanel/{App.tsx,styles.css,components/**}`, `src/content/overlay.ts`.

### Dependencies
Phase 3.

### Testing
React Testing Library with a mocked `chrome`: start → running → trace → done; error
banner; confirm approve/deny; inspector receives `gw:inspect`.

### Definition of Done
- [x] Judge flow works live (inspector mounted, fed per step; test `inspector.test.tsx` asserts both directions)
- [x] Overlay visible during a run and cleared at the end
- [x] Panel tests green (`App.test.tsx`)

### SIH relevance
"Privacy filter clearly demonstrated"; explainability.

---

## Phase 5 — Local vision: OCR, NER, redacted screenshot

### Objective
The screenshot is processed locally: OCR reads regions the DOM cannot explain, NER
finds names/addresses in free text, and a pixel-redacted screenshot is the only image
that can leave the device (BALANCED). STRICT never touches pixels.

### What to build
- Offscreen `gw:perceive` handler running the image pipeline, `ocrSource`, `nerSource`;
  service-worker adapters exposing them to `sanitize()` as perception sources.
- `StepRequest.screenshot` (branded `RedactedImage` → base64) forwarded to
  vision-capable providers.
- Warm-up on install/session start; capability probe and model bytes surfaced in the panel.

### Files / modules
`apps/extension/src/offscreen/{host,pipeline/**}.ts`, `src/background/perception.ts`,
`packages/inference/src/**`, `packages/schema/src/transport.ts`, gateway prompt/providers.

### Dependencies
Phases 2–4; `bash ml/fetch-models.sh`.

### Testing
Offscreen handler tests with stub sources; existing NER/OCR/no-raw-leak suites;
browser check on ClinicDesk (canvas Aadhaar masked in the outbound image and tokenized
in text); STRICT loads no OCR engine.

### Definition of Done
- [x] ClinicDesk canvas PII masked and tokenized under BALANCED (handles AADHAAR/PHONE from OCR; image shows black boxes)
- [x] STRICT never captures pixels; degraded path completes with more redaction (`capture_unavailable`, `ocr_unavailable:<reason>` shown in the trace)
- [x] Per-stage latency (observe/capture/perceive/sanitize/redact/gate/reason/execute) in the trace; local model state in the header chip

### SIH relevance
"Local Vision Processing" (explicit PS requirement); visual-context accuracy; resource use.

---

## Phase 6 — Bench sites, harness, PS-aligned evaluation

### Objective
Reproducible numbers for the five judge metrics, produced by one command against the
real extension.

### What to build
- Instrument ShopLite/GovPortal ground truth; tasks T1–T5; harness hooks; predicates.
- Leakage harness that loads the extension, captures gateway traffic, scans nine
  encodings; negative control via a dev-only unsafe build flag.
- `eval/metrics/ps-metrics.ts` + `pnpm bench:report` → `eval/reports/summary.md`.
- CI: workspace tests, `verify:boundary`, Playwright smoke + leakage.

### Files / modules
`apps/bench-site/src/sites/**`, `eval/{tasks,harness,leakage,metrics,reports}/**`,
`.github/workflows/*.yml`, root `package.json` scripts.

### Dependencies
Phases 3–5.

### Testing
`pnpm bench:smoke`, `pnpm bench:leakage`, `pnpm bench:report`.

### Definition of Done
- [x] `pnpm bench:smoke` passes T1 and T3 (and every task passes under `bench:all`)
- [x] `pnpm bench:leakage` 0 leaks; negative control red (6 findings on the UNSAFE build)
- [x] `pnpm bench:report` writes all five metrics with hardware/commit/seeds

### Measured (commit deb468a, Apple M1, 3 seeds × STRICT/BALANCED)
Visual context recall 97.8% / precision 99.7% · PII recall 100% / precision 97.7%, 0 leaks ·
redaction precision 95.6% · 1.8 s local compute per step, payload p50 41 KB ·
step latency p50 2.1 s, p95 2.7 s · task completion 33/33.

### Fixed on the way
- Table-column context rule treated any two labels on one line as a header row and
  registered "Back", "Submit application", "Personal information" as addresses.
- One value could get two handles when NER re-classified a context hit.
- NER evidence from control labels is now ignored.
- `dist-eval` and `dist-unsafe` were tracked in git.

### SIH relevance
All five scoring metrics, measured.

---

## Phase 7 — Hardening, tests, reliability

### Objective
The system fails loudly and recovers: no silent hangs, no fail-open path.

### What to build
Error matrix (gateway down, provider errors → failover, missing model assets, restricted
pages, SW restart, confirmation timeout, abort during network); unit tests for
orchestrator, messaging, validator, backend, planner, panel; lint zero errors.

### Definition of Done
- [x] Two consecutive unattended e2e runs (scripted): `bench:all` 33/33, then `bench:leakage` + `bench:smoke` green
- [ ] An LLM-provider e2e run — not possible on this machine (no key, no Ollama); provider chain unit-tested
- [x] All gates green locally (`build`, `typecheck`, `test`, `lint`, `verify:boundary`); CI workflow updated (not yet observed on GitHub from this machine)

### SIH relevance
Credibility; latency and resource metrics under failure.

---

## Phase 8 — Demo and documentation

### Objective
A judge-ready walkthrough and documentation that describes the current system only.

### What to build
README (setup, models, run, env vars, troubleshooting), ARCHITECTURE, SECURITY,
PRIVACY, EVALUATION, MODEL_CARD, CONTRACTS reconciled; DEMO.md with only beats that
work; final evaluator-style audit recorded here.

### Definition of Done
- [x] Cold clone → demo using README alone (commands verified in this checkout; models vendored once)
- [x] DEMO.md beats 2–8 driven by the harness on this machine; beat 9 (judge's page) by nature unrehearsed
- [x] Final audit recorded below

---

## Final Definition of Done

| # | Criterion | State |
|---|---|---|
| 1 | Clean clone: `pnpm install && bash ml/fetch-models.sh && pnpm build` green | ✅ |
| 2 | `pnpm dev` starts bench sites and gateway; `/v1/health` shows the active provider | ✅ |
| 3 | Extension loads unpacked; panel opens from the toolbar icon | ✅ |
| 4 | Task typed in the panel runs the loop: observe → local perception/redaction → gate → gateway → validated action → executed | ✅ (33/33 runs) |
| 5 | DevTools Network shows only handles and, under BALANCED, a pixel-redacted image | ✅ (leakage canary: 0 findings) |
| 6 | Privacy tab: on-page value NOT PRESENT; public text FOUND | ✅ (`inspector.test.tsx`; DEMO beat 3) |
| 7 | Injection page: exfiltration attempt blocked with `VAULT_TYPE_MISMATCH` | ✅ (`orchestrator.test.ts`; `GLASSWALL_DEMO_HIJACKED=1`) |
| 8 | `bench:smoke`, `bench:leakage` (0 leaks, negative control red), `bench:report` (five metrics) run from the repo | ✅ |
| 9 | Gateway/provider/model failures degrade visibly and never leak | ✅ (error matrix tests; chaos suite) |
| 10 | Tests cover extractor, executor, orchestrator, privacy, gateway, panel; CI green | ✅ locally (503 tests); CI run not observed from this machine |
| 11 | Docs describe the current implementation; DEMO.md beats rehearsed | ✅ (beat 9 excepted by design) |

## Final audit (2026-09-02, evaluator's view)

Method: every claim below was re-run in this checkout, not read from a document.

| Check | Command | Result |
|---|---|---|
| Build | `pnpm build` | 7/7 packages |
| Types | `pnpm typecheck` | 11/11 |
| Unit and integration tests | `pnpm test` | 503 passed, 7 skipped (gated model tests skip without `--sweep` assets) |
| Lint | `pnpm lint` | 0 errors (warnings remain on advisory rules) |
| Privacy boundary | `pnpm verify:boundary` | 8/8 |
| End to end, full suite | `pnpm bench:all` | 33/33 runs, 0 leaks, five metrics in `eval/reports/summary.md` |
| Leakage canary | `pnpm bench:leakage` | 0 findings on 46 requests; UNSAFE build 6 findings |
| Smoke after final refactor | `pnpm bench:smoke` | 2/2 |

What a judge will see working: the closed loop on three bench sites under both
policies; handles-only payloads with a live inspector; on-device NER and OCR with
pixel redaction; the injection block; the leakage canary that goes red on demand; the
five PS metrics produced by one command.

What a judge should be told plainly: the reasoner in every measured run was the
scripted planner (an LLM endpoint is a config change, untested here); pixel redaction
uses coverage, not a face detector; the model is 109 MB against a 30 MB wish; Chrome
only.

Verdict: demonstrable and SIH-ready as a prototype. Remaining risk is the unseen-page
beat, which depends on the planner (scripted or LLM) rather than on the privacy
boundary, which holds by construction on any page.
