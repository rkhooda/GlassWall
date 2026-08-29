# PROGRESS — Build Log

## Phase Status

| Phase                      | State | Tag                       | Notes                                                                                     |
| -------------------------- | ----- | ------------------------- | ----------------------------------------------------------------------------------------- |
| A-P0.1 Foundation          | ✅    | v0.0.1-foundation         | pnpm workspace, TS strict, ESLint no-fetch, schema v1, CI green                           |
| A-P0.2 Schema v1           | ✅    | v0.0.1-schema-v1          | RawObservation, RawElement, RawTextNode, CapturedFrame, SanitizedObservation, ObservedElement, Action, ActionEnvelope, Target, Value, ActionResult, PolicyConfig, AuditRecord, AuditPrivacyFields, SafePayload, PiiType, Branded types (SafePayload, Sensitive<T>) |
| A-P0.3 Sanitize stub       | ✅    | v0.0.1-sanitize-stub      | `sanitize.stub.ts` with UNSAFE banner                                                     |
| A-BS.1 ShopLite            | ✅    | v0.1.0-shoplite           | ShopLite site built with cart, checkout, orders, tracking; includes modal, same-origin iframe, open shadow DOM, virtualized list, form fields with correct autocomplete tokens, React controlled input, realistic placeholder PII |
| A-P1.1 MV3 skeleton        | ✅    | v0.1.0-extension-skeleton | manifest.json, message bus, sidepanel, offscreen bootstrap                                |
| A-P1.2 Offscreen RPC       | ✅    | v0.1.0-offscreen-rpc      | Offscreen document lifecycle with RPC transport for InferenceHost interface, includes handler registration for Lane B implementations |
| A-BS.2 GovPortal           | ✅    | v0.1.0-govportal          | Multi-step government form bench site for testing extension functionality, includes personal info, address, document upload, and review/submit steps |
| A-P2.1 geometry            | ✅    | v0.2.0-geometry           | `packages/perception/geometry.ts` rect ops, IoU, occlusion helpers, area union, quantization, bidir transforms |
| A-P2.2 Traversal           | ✅    | v0.2.0-traversal          | TreeWalker, open-shadow-root, same-origin iframes, frame IDs                              |
| A-P2.3 Visibility+identity | ✅    | v0.2.0-visibility         | elementFromPoint centre+4 corners, id_hash, value_state, group_path                       |
| A-P2.4 ShadowDOM+iframes   | ✅    | v0.2.0-shadow-iframe      | Cross-origin iframe unexplained, closed shadow root unexplained                           |
| A-P2.5 WaitStable          | ✅    | v0.2.0-waitstable         | MutationObserver + route stability (URL/hashchange), 3s timeout/500ms stable duration     |
| A-P3.1 Capture             | ✅    | v0.3.0-capture            | captureVisibleTab in SW, dataURL→Blob, viewport/DPI metadata                              |
| A-P4.1 Validator           | ☐     | v0.4.0-action-protocol    | 12-rung ladder (rungs 7-8 stubbed), Action/ActionEnvelope frozen                          |
| A-P4.2 Executor            | ✅    | v0.4.0-executor           | CLICK/TYPE/SCROLL/SELECT/PRESS_KEY/NAVIGATE/WAIT/BACK event ordering, native value setter, effect verification |
| A-P4.3 Confirmation        | ✅    | v0.4.0-confirmation       | Confirm.tsx: risk classification (SUBMIT_LIKE/NAVIGATE_EXTERNAL/PAYMENT/DELETE), blocking modal with approve/deny |
| A-P5.1 Gateway             | ☐     | —                         | Fastify /v1/session, /v1/step, /v1/health, provider abstraction                           |
| A-P5.2 Orchestrator        | ☐     | —                         | Step loop, budgets, abort, consecutive_failures, SW-restart persistence                   |
| A-P5.3 Trace               | ☐     | —                         | Trace.tsx, progress object, loop/oscillation detector                                     |
| A-P5.4 Real provider       | ☐     | —                         | One real LLM provider + scripted planner, prompt assembly with `<untrusted_page_content>` |
| A-P5.5 Integrate B         | ☐     | v0.5.0-mvp-closed-loop ⭐ | Swap stub→sanitize(), net.ts→SafePayload, rungs 7-8, vault binding, delete stub           |
| A-P12.1 Harness            | ☐     | v0.12.0                   | Playwright driver, task YAML, success predicates, CDP metrics                             |
| A-P13.1 Perf               | ☐     | v0.13/14.0                | Incremental extraction, observation caching, payload minimization                         |
| A-P14.1 Hardening          | ☐     | —                         | Recovery ladder, circuit breakers, error taxonomy, chaos testing                          |
| A-P15.1 Demo               | ☐     | v1.0.0 🎉                 | Demo script, backup videos, README/ARCHITECTURE/DEMO.md, dress rehearsals                 |

---