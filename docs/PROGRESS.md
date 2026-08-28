# PROGRESS — Build Log

## Phase Status

| Phase                      | State | Tag                       | Notes                                                                                     |
| -------------------------- | ----- | ------------------------- | ----------------------------------------------------------------------------------------- |
| A-P0.1 Foundation          | ✅    | v0.0.1-foundation         | pnpm workspace, TS strict, ESLint no-fetch, schema v1, CI green                           |
| A-P0.2 Schema v1           | ✅    | v0.0.1-schema-v1          | RawObservation, RawElement, RawTextNode, CapturedFrame, SanitizedObservation, ObservedElement, Action, ActionEnvelope, Target, Value, ActionResult, PolicyConfig, AuditRecord, AuditPrivacyFields, SafePayload, PiiType, Branded types (SafePayload, Sensitive<T>) |
| A-P0.3 Sanitize stub       | ☐     | —                         | `sanitize.stub.ts` with UNSAFE banner                                                     |
| A-BS.1 ShopLite            | ☐     | —                         | Bench site skeleton + C10 instrumentation                                                 |
| A-P1.1 MV3 skeleton        | ☐     | v0.1.0-extension-skeleton | manifest.json, message bus, sidepanel, offscreen bootstrap                                |
| A-P1.2 Offscreen RPC       | ☐     | —                         | RPC transport, sandboxed-iframe fallback                                                  |
| A-BS.2 GovPortal           | ☐     | —                         | Bench site skeleton + C10 instrumentation                                                 |
| A-P2.1 geometry            | ☐     | —                         | `packages/perception/geometry.ts` rect ops, IoU, quantization                             |
| A-P2.2 Traversal           | ☐     | —                         | TreeWalker, open-shadow-root, same-origin iframes, frame IDs                              |
| A-P2.3 Visibility+identity | ☐     | —                         | elementFromPoint centre+4 corners, id_hash, value_state, group_path                       |
| A-P2.4 ShadowDOM+iframes   | ☐     | —                         | Cross-origin iframe unexplained, closed shadow root unexplained                           |
| A-P2.5 WaitStable+overlay  | ☐     | —                         | MutationObserver + IntersectionObserver + fetch/XHR patch, debug overlay                  |
| A-P2.6 Security test       | ☐     | —                         | Grep extractor for .value/.innerHTML/cookie/storage — assert absent                       |
| A-P3.1 Capture             | ☐     | —                         | captureVisibleTab in SW, ImageBitmap transfer, throttle handling                          |
| A-P4.1 Validator           | ☐     | v0.4.0-action-protocol    | 12-rung ladder (rungs 7-8 stubbed), Action/ActionEnvelope frozen                          |
| A-P4.2 Executor            | ☐     | —                         | CLICK/TYPE event ordering, native value setter, effect verification                       |
| A-P4.3 Confirmation        | ☐     | —                         | Confirm.tsx for high-risk actions                                                         |
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

## Frozen Types

| Type                             | Frozen? | Date |
| -------------------------------- | ------- | ---- |
| RawElement / RawObservation (C1) | ✅       | 2026-08-28    |
| Action / ActionEnvelope          | ✅       | 2026-08-28    |
| SanitizedObservation (C5)        | ✅       | 2026-08-28    |
| ObservedElement                  | ✅       | 2026-08-28    |
| Target                           | ✅       | 2026-08-28    |
| Value                            | ✅       | 2026-08-28    |
| ActionResult                     | ✅       | 2026-08-28    |
| PolicyConfig                     | ✅       | 2026-08-28    |
| AuditRecord                      | ✅       | 2026-08-28    |
| AuditPrivacyFields               | ✅       | 2026-08-28    |
| SafePayload                      | ✅       | 2026-08-28    |
| PiiType                          | ✅       | 2026-08-28    |

---

## Outstanding Scaffolding to Delete

| Marker                    | Where                                            | Delete at                        |
| ------------------------- | ------------------------------------------------ | -------------------------------- |
| `sanitize.stub.ts`        | `apps/extension/src/background/sanitize.stub.ts` | Day 7 (P5.5)                     |
| UNSAFE banner             | SidePanel + console.warn                         | Day 7 (P5.5)                     |
| Validator rungs 7–8 stubs | `apps/extension/src/background/validator.ts`     | Day 8 (P5.5)                     |
| Scripted planner only     | `apps/backend/src/providers/scripted.ts`         | After real provider lands (P5.4) |

---

## Session Entry Template

**Built:** Monorepo foundation (pnpm workspaces + turbo, TS strict, ESLint with fetch restriction, Prettier, Vitest, Playwright, GitHub Actions CI, .nvmrc, full directory skeleton, packages/schema with Zod→JSON Schema, ADR-000)
**Acceptance criteria met:** pnpm i && pnpm build && pnpm test && pnpm lint all green from clean clone; CI green; ESLint fetch rule verified (errors outside net.ts, passes in net.ts)
**Deferred:** Actual application code (extraction, executor, privacy pipeline, etc.)
**New scaffolding added:** packages/schema (observation.ts, action.ts, policy.ts, audit.ts, gen-schema.ts), packages/privacy, perception, inference, apps/extension (manifest, background, content, offscreen, sidepanel), apps/backend, apps/bench-site, eval, ml, docs/decisions/ADR-000.md
**Notes for next session:** Begin P1 - Extension skeleton with message bus, offscreen document, and inference spike. Pair with B on Day 2 for inference spike go/no-go.
