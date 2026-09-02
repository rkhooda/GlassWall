# ARCHITECTURE

How GLASSWALL is put together, what crosses the network, and what never does. File
paths are the authority; `docs/CONTRACTS.md` gives the interfaces between the parts.

## Components

```
 Chrome tab                          Extension (MV3)                                 Gateway (Fastify)
 ┌─────────────────┐   observe    ┌──────────────────────────────┐   SafePayload    ┌────────────────────┐
 │ content script  │ ───────────▶ │ service worker               │ ───────────────▶ │ /v1/session        │
 │  extractor      │ ◀─────────── │  orchestrator.ts             │ ◀─────────────── │ /v1/step           │
 │  registry       │   execute    │  perception.ts  capture.ts   │   StepResponse   │ /v1/health         │
 │  executor       │              │  net.ts (the only fetch)     │                  │  prompt/assemble   │
 │  overlay        │              └──────┬───────────────▲───────┘                  │  guard/validate    │
 └─────────────────┘                     │ perceive      │ evidence, redacted PNG    │  providers:        │
                                  ┌──────▼───────────────┴───────┐                  │   openai-compatible│
 ┌─────────────────┐  messages    │ offscreen document           │                  │   anthropic        │
 │ side panel      │ ◀──────────▶ │  NER (ONNX int8, WASM)       │                  │   scripted (last)  │
 │  Run / Privacy  │              │  OCR (tesseract.js)          │                  │   demo-hijacked    │
 └─────────────────┘              │  image decode → redact → PNG │                  └────────────────────┘
                                  └──────────────────────────────┘
```

| Component | Path | Responsibility |
|---|---|---|
| Content script | `apps/extension/src/content` | `extractor/` walks DOM and accessibility tree into a `RawObservation` without reading values, cookies or storage; `registry.ts` maps element ids to live nodes; `identity.ts` hashes tag, role, name, DOM path, quantized rect and frame into `id_hash`; `executor/` performs one validated action (native value setter, real events) and reports an `ActionResult`; `overlay.ts` draws numbered boxes and redaction rectangles in a shadow root. |
| Service worker | `apps/extension/src/background` | `orchestrator.ts` runs the loop; `perception.ts` adapts the offscreen document into `PerceptionSource`s for `sanitize()`; `capture.ts` takes the screenshot and owns the offscreen document lifecycle; `net.ts` is the only `fetch` and accepts a `SafePayload` only; `index.ts` routes panel messages. |
| Offscreen document | `apps/extension/src/offscreen` | `host.ts` answers `gw:perceive`, `gw:redact`, `gw:warmup`, `gw:stats`; `pipeline/ner.ts` and `pipeline/ocr.ts` are perception sources; `pipeline/image/` decodes the frame, maps viewport rects to physical pixels, blacks out regions and downscales. The frame never leaves this document unredacted. |
| Side panel | `apps/extension/src/sidepanel` | React: task, policy, provider and model chips, step trace, confirmation modal, Privacy tab with the raw-vs-outbound inspector, redaction reasons, encoding search and audit export. |
| Schema | `packages/schema` | Zod, strict at every level: `RawObservation`, `SanitizedObservation`, `Action`/`ActionEnvelope`/`ActionResult`, policy profiles, `SessionRequest`/`StepRequest`/`StepResponse`/`HealthResponse`, audit types, `SafePayload` brand. Changes go in `contract:` commits. |
| Privacy | `packages/privacy` | recognizers, label context, element rules, fusion, coverage, `sanitize()`, `SessionSecrets` (registry + tokenizer + vault), `resolveForBinding()`, validator hooks, `egressGate()`. |
| Inference | `packages/inference` | NER and OCR wrappers with CDN lockdown, chunking and span mapping, crop policy, capability probe, warm-up. |
| Perception | `packages/perception` | geometry, quantization, the sanitized observation builder. |
| Gateway | `apps/backend` | session store (memory), prompt assembly with the redaction scheme and an untrusted-content wrapper, provider chain with failover and one repair retry, response validation against the observation, loop detector. |
| Bench sites | `apps/bench-site` | ShopLite, GovPortal, ClinicDesk with seeded personas and ground-truth attributes; MailLite exists without a task. |
| Evaluation | `eval` | Playwright driver and runner, tasks, PS metrics, leakage canary, chaos and ablation suites. |

## One step

`startRun()` in `orchestrator.ts`, per step:

1. **Observe.** `gw:observe` to the tab. The content script waits for DOM stability,
   walks the document, computes `id_hash` per element, emits elements, text nodes and
   frames with `value_state` but no values. Content script missing (fresh tab) is
   re-injected once.
2. **Capture.** Under BALANCED only, `chrome.tabs.captureVisibleTab` gives a PNG data
   URL. STRICT skips this; no pixels exist to leak.
3. **Perceive.** `createStepPerception()` sends the raw observation (and the frame) to
   the offscreen document once. NER runs on the joined text nodes; OCR crops the
   regions `findUnexplainedRegions()` names (canvas, images, cross-origin frames) and
   runs recognizers, label context and NER on what it reads. Each source returns
   evidence (type, confidence, rect, text span) plus the regions it could not account
   for. A source that throws or times out is replaced by its declared coverage, which
   `sanitize()` masks.
4. **Sanitize.** `sanitize()` runs element rules and deterministic recognizers, then
   the perception sources, records every value in `SessionSecrets` (registry for the
   gate, vault for execution, tokenizer for stable handles), fuses evidence by
   noisy-OR, applies explain-or-redact, substitutes every known value in labels and
   text with its handle, scrubs placeholders, classifies each input's sensitivity, and
   builds the `SanitizedObservation`. It returns redaction rectangles with reasons.
5. **Redact pixels.** The offscreen document blacks out the fused rectangles on the
   held frame, downscales to 640 px and returns a PNG; only this payload can be
   attached as `StepRequest.screenshot`.
6. **Gate.** `egressGate()` validates the `StepRequest` (strict schema, recognizer
   sweep over every string, registry scan in nine encodings plus 8-gram overlap for
   tier-1/2 values, entropy, size, rate, destination pin) and returns a `SafePayload`.
   A violation ends the step; three in a row end the run.
7. **Reason.** `net.ts` posts the payload. The gateway assembles the prompt, asks the
   provider chain, validates the answer against the observation it was given, and
   returns one `ActionEnvelope`.
8. **Validate.** Freshness (`observation_id`), target exists, `id_hash` matches,
   visible, enabled, action available on the element, same-origin navigation, vault
   type matches the target's sensitivity class (rung 7), literal text contains no
   registered secret (rung 8).
9. **Confirm.** Payment, deletion, external navigation, or a planner-flagged high-risk
   action waits for Approve in the panel; 90 s or Deny aborts.
10. **Execute.** A vault reference is resolved locally by `resolveForBinding()` into a
    literal that travels only in the tab message; the content script performs the
    action and reports whether an effect was observed. Navigation tearing down the
    content script counts as an observed effect.
11. **Record.** A trace entry to the panel and a content-free `AuditEntry` (counts,
    timings, rectangles, verdicts, payload size) to memory and `chrome.storage.session`.
    Blocked literals are replaced by `[blocked]` before the envelope enters the history
    sent on the next step.

The run ends on `DONE`, abort, budget (20 steps, 5 minutes by default), three
consecutive blocked or failed actions, or a gateway error. The vault is cleared at the
start and the end of every run.

## What crosses the network

Only a `SessionRequest` (task, policy, allowlist) and `StepRequest`s (sanitized
observation, last five envelopes, last result, optional redacted PNG) to the gateway
origin in `shared/config.ts`, and their responses. `PRIVACY.md` lists the fields.

## What never crosses

Input values, `innerHTML`, cookies, storage, raw screenshots, raw OCR or NER text,
vault contents, the secret registry, the audit log. These are kept out by construction
(the extractor does not read them, the schema has no field for them), by detection
(handles), and by the gate (refuses what still matches). `scripts/verify-boundary.sh`
greps the source and the built bundle for the rules that make this checkable.

## Builds and permissions

| Build | Command | Permissions | Use |
|---|---|---|---|
| `dist` | `pnpm --filter @glasswall/extension build` | `host_permissions` gateway only; sites are `optional_host_permissions` requested per origin on Start under BALANCED | ship, demo |
| `dist-eval` | `build:eval` | adds `<all_urls>` | Playwright harness needs to see the service worker's requests |
| `dist-unsafe` | `build:unsafe` | as eval, with `__GW_UNSAFE_PASSTHROUGH__` compiled in: raw observation sent, gate skipped | negative control for the leakage canary; `verify:boundary` asserts the marker is absent from `dist` |

CSP `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' <gateway>`. Model
assets load from the extension's own `public/` directory.

## Gateway

`POST /v1/session` creates an in-memory session and returns its budget and the active
provider. `POST /v1/step` validates the request, assembles the prompt (system
instructions, redaction scheme, handle inventory, the observation under an
`untrusted_page_content` wrapper, history and last result), asks the providers in
`GLASSWALL_PROVIDER_ORDER` with one repair retry each, validates the action against the
observation (ids, hashes, handle names, action shape), and returns the envelope with
the provider name and latency. A loop detector ends sessions that repeat an action
without effect. `GET /v1/health` reports each provider's availability.

## Recovery and failure

See `SECURITY.md`, failure matrix. In short: every local failure produces more
redaction and a smaller payload; every remote failure produces a named error in the
panel; nothing hangs, nothing retries around the gate.

## Non-goals

Firefox (no offscreen document), a trained visual PII/face detector (extension point
only), full-page stitching, per-site memory, a signed audit log, TLS to a hosted gateway
(none is deployed).
