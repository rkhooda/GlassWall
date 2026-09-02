# GLASSWALL

**On-device visual perception for a light-weight browser agent, with a provable privacy boundary.**
SIH 2026 · Problem statement 26171 · ISRO

A Chrome (MV3) extension reads the page on your device, redacts everything personal
before anything leaves the browser, sends only anonymised structure to a server-side
reasoner, and executes the one action it gets back. Sensitive values become typed
handles (`⟦EMAIL#1⟧`); the agent plans with handles and the extension resolves them
locally at execution time, so a form fills correctly while the value never reaches the
network or the model.

```
page ─▶ extractor ─▶ OCR + NER (offscreen, WASM/WebGPU) ─▶ sanitize ─▶ egress gate ─▶ gateway ─▶ reasoner
 ▲        (no .value reads)        (redacted screenshot)      (handles)   (one fetch)    (open-weights / Claude / scripted)
 └── executor ◀── validator (freshness, identity, type-matched vault binding, literal scan) ◀── one action
```

## Quickstart

Requirements: Node 20 (see `.nvmrc`), pnpm 9, Chrome or Chromium.

```bash
pnpm install
bash ml/fetch-models.sh        # once: vendors the NER model, ONNX Runtime WASM and Tesseract (~200 MB, gitignored)
pnpm build
pnpm dev                       # bench sites on :5173 and the gateway on :3000
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/dist`. Click the toolbar icon to open the side panel.

Then open `http://localhost:5173/shoplite/checkout`, type
*Fill the shipping form with my saved details and place the order*, pick a policy,
and press Start. The panel shows every step; the page shows numbered elements and
redaction boxes; DevTools → Network shows requests to `localhost:3000` that carry
handles and never values.

No API key is needed: the gateway falls back to a scripted planner that fills forms
and searches by field semantics. See [Reasoner providers](#reasoner-providers) to plug
in a real model.

## What is in the box

| Piece | Where | What it does |
|---|---|---|
| Content script | `apps/extension/src/content` | Extracts DOM/A11y structure without reading input values, cookies or storage; draws the overlay; executes validated actions with a stable identity hash per element. |
| Service worker | `apps/extension/src/background` | The run loop: observe → capture → perceive → sanitize → gate → reason → validate → confirm → execute → audit. `net.ts` is the only `fetch` in the extension and accepts a `SafePayload` only. |
| Offscreen document | `apps/extension/src/offscreen` | Runs Tesseract OCR and a BERT NER model (int8 ONNX, WASM or WebGPU) on device, and black-boxes the screenshot before it can leave. |
| Side panel | `apps/extension/src/sidepanel` | Task, policy, provider and model status, step trace with local/network timings, confirmation modal, Privacy tab with raw-vs-outbound inspector and a "find any value across nine encodings" search, audit export. |
| Privacy library | `packages/privacy` | Recognizers (checksummed identifiers, label context, element rules), NER/OCR fusion, explain-or-redact, session secrets and vault, policy profiles, the egress gate. |
| Gateway | `apps/backend` | Fastify server: `/v1/session`, `/v1/step`, `/v1/health`. Assembles the prompt with the redaction scheme, asks providers in order with failover and one repair retry, validates the action against the observation. |
| Bench sites | `apps/bench-site` | ShopLite (checkout, search, orders, injection page), GovPortal (four-step application), ClinicDesk (canvas-rendered PII). Instrumented with ground truth the extension never reads. |
| Evaluation | `eval` | Playwright harness that drives the real extension in Chromium, the leakage canary with a negative control, and the five problem-statement metrics. |

## Policies

| Profile | Pixels | Text | Confirmation |
|---|---|---|---|
| **STRICT** | Never captured. OCR does not run. | Every recognizer plus NER; every value tokenized. | Payment, delete, navigation. |
| **BALANCED** | Captured, redacted on device (fused regions blacked out, downscaled), sent as PNG. Needs a one-time per-origin permission that the panel requests on Start. | Same as STRICT plus OCR over canvas/image regions. | Payment, delete. |

## Reasoner providers

Copy `apps/backend/.env.example` to `apps/backend/.env`. The chain is tried in order;
the scripted planner is always last so a step always returns an action.

| Provider | Configure | Notes |
|---|---|---|
| `openai` (any OpenAI-compatible endpoint) | `GLASSWALL_LLM_BASE_URL`, `GLASSWALL_LLM_MODEL`, optional `GLASSWALL_LLM_API_KEY`, `GLASSWALL_LLM_VISION=1` | Ollama, vLLM, Groq, OpenRouter. Open-weights, offline-deployable models as the PS prefers (`qwen2.5:7b` on Ollama works). |
| `anthropic` | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` | Tool-use with the redacted screenshot as an image under BALANCED. |
| `scripted` | nothing | Deterministic planner keyed on field semantics (autocomplete, type, label, vault handle types). Fills forms, searches, opens records, scrolls. |

`GLASSWALL_DEMO_HIJACKED=1` puts a simulated prompt-injected planner first: it tries to
type the Aadhaar handle into the search box and the client blocks it with
`VAULT_TYPE_MISMATCH`. `GET /v1/health` reports which providers are live.

## Evaluation

The bench sites and gateway must be running (`pnpm dev`), and the extension needs the
evaluation build once (`pnpm build:eval`, which adds `<all_urls>` so the harness can
capture the service worker's requests, plus an unsafe build for the negative control).

```bash
pnpm bench:smoke      # T1 and T3, one seed, STRICT: must pass
pnpm bench:all        # T1–T5 and T7 × three seeds × STRICT and BALANCED → eval/reports/summary.md
pnpm bench:leakage    # every persona value on the wire in nine encodings = a leak; then the UNSAFE build must leak
pnpm bench:report     # same as bench:all
```

`eval/reports/summary.md` holds the last measured numbers for the five PS metrics
(visual-context accuracy, PII precision/recall, redaction precision, client resource
use, end-to-end latency) with hardware, commit and seeds. `EVALUATION.md` explains how
each number is computed.

## The boundary, and how to check it

`pnpm verify:boundary` greps the source and the built bundle for the hard rules:

1. one `fetch` in the extension, in `net.ts`; no `XMLHttpRequest`, `sendBeacon`, `WebSocket`;
2. no `eval`, `Function`, `innerHTML`, `insertAdjacentHTML`;
3. bench instrumentation attributes absent from the bundle; negative-control code compiled out;
4. CSP `connect-src` pinned to the gateway origin;
5. `host_permissions` limited to the gateway (sites are optional, per origin);
6. vault only in `chrome.storage.session`;
7. `net.ts` accepts `SafePayload` only, which only `egressGate()` constructs;
8. the extractor never reads `.value`, `innerHTML`, cookies or storage.

`SECURITY.md` states what is and is not guaranteed. `PRIVACY.md` states what leaves the
device, what is retained and when it is erased.

## Everyday commands

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
pnpm verify:boundary
pnpm gen:schema                 # regenerate JSON Schema after a contract change
pnpm --filter @glasswall/extension build      # dist/
```

## Repository layout

```
apps/extension     MV3 extension (content, background, offscreen, sidepanel)
apps/backend       Fastify gateway and providers
apps/bench-site    ShopLite, GovPortal, ClinicDesk (Vite + React)
packages/schema    Zod schemas: observation, action, policy, transport, audit (source of truth)
packages/privacy   recognizers, fusion, sanitize, session secrets, vault, egress gate
packages/inference NER and OCR wrappers (transformers.js, tesseract.js), crop policy
packages/perception geometry helpers and the observation builder
eval               harness, tasks, leakage canary, PS metrics, reports
ml                 fetch-models.sh, quantization sweep notes
docs               progress.md (single source of truth), CONTRACTS.md, archive/
```

## Troubleshooting

- **"Gateway unreachable"** in the panel: start `pnpm dev`; the extension only talks to `http://localhost:3000`.
- **"GLASSWALL works on http(s) pages only"**: the active tab is a `chrome://` or extension page; open a web page.
- **Screenshot missing under BALANCED**: accept the per-origin permission prompt on Start, or use STRICT.
- **NER/OCR shown as cold or degraded**: run `bash ml/fetch-models.sh` and rebuild; the run still completes, with more redaction.
- **Harness cannot capture requests**: build with `pnpm build:eval`; the shipped `dist` has no site permissions.

## Scope

Chrome/Chromium only (Firefox has no offscreen document; noted as a non-goal). No
trained face or visual-PII detector: image regions without a DOM owner are masked
wholesale, and a detector is a listed extension point (`MODEL_CARD.md`). No signed audit
log, no full-page stitching. MailLite exists as a site but has no task.

## Documents

| File | Contents |
|---|---|
| `docs/progress.md` | Phase status, gaps, definition of done, final audit |
| `ARCHITECTURE.md` | Components, data flow, what crosses the boundary |
| `SECURITY.md` | Threat model, guarantees, non-guarantees, failure matrix |
| `PRIVACY.md` | What leaves the device, retention, controls |
| `EVALUATION.md` | Metrics, harness, how to reproduce |
| `MODEL_CARD.md` | The models that run on device |
| `DEMO.md` | The rehearsed demo script |
| `docs/CONTRACTS.md` | Interfaces between the pieces |

## License

Apache-2.0.
