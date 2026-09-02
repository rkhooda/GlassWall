# GLASSWALL — Agent Context

Repo for SIH 2026 problem statement **SIH26171** (ISRO): *On-device Visual Perception
for Light-weight Browser Agents*. Read this file fully before any task.

## Documents

| File | What it is |
|---|---|
| `docs/progress.md` | **Single source of truth**: status, phases, gaps, definition of done |
| `docs/CONTRACTS.md` | Interface contracts between extension, privacy library and gateway |
| `ARCHITECTURE.md` | Component map and data flow |
| `SECURITY.md` · `PRIVACY.md` · `EVALUATION.md` · `MODEL_CARD.md` | Threat model, data handling, measurements, models |
| `DEMO.md` | The judge demo script |
| `docs/archive/` | Original two-lane plans. History only; not authoritative |

The repository is single-owner. Every directory may be edited when a task needs it.

## The problem statement, in one paragraph

A browser extension perceives the page locally (DOM + accessibility tree + a local
vision/OCR pass on the screenshot), detects and redacts sensitive data before any
network request, sends only sanitized structure (and a pixel-redacted screenshot when
policy allows) to a gateway that asks an LLM/VLM for the next UI action, and executes
that action in the page, looping until the task is done. Judges score: visual-context
accuracy 25%, PII precision/recall 20%, redaction precision 20%, client resource use
20%, end-to-end latency 15%. Finale use cases are supplied by the judges, so the agent
must work on pages we have not seen.

## Hard rules (violating any of these fails the task)

1. **One `fetch` in the extension**, in `apps/extension/src/background/net.ts`. No
   `XMLHttpRequest`, `sendBeacon`, or `WebSocket` anywhere in the extension. Enforced
   by ESLint and `scripts/verify-boundary.sh`.
2. **`net.ts` exposes `send(p: SafePayload)` only.** `SafePayload` is produced solely by
   `egressGate()`. Bypassing the gate must be a compile error.
3. **No `eval`, `Function`, `innerHTML`, `insertAdjacentHTML`, or model-supplied
   selectors** anywhere in the execution path.
4. **The extractor never reads** `.value`, `.innerHTML`, `.outerHTML`,
   `document.cookie`, `localStorage`, `sessionStorage`, or `indexedDB`. It is the
   privacy boundary, not just a parser.
5. **Never log, trace, or transmit a resolved vault value.** `Sensitive<T>` values go
   vault → page and nowhere else.
6. **Schema changes** (`packages/schema`) go in their own commit prefixed `contract:`.
7. **`main` must build and pass tests at every commit.** Unfinished features go behind
   a policy flag rather than leaving `main` broken.

## Working method

- Read the phase in `docs/progress.md` before writing code; implement to its
  Definition of Done, then update the phase table in the same session.
- Never skip the tests a phase names. If a criterion cannot be met, say so in
  `docs/progress.md` rather than lowering it silently.
- Prefer editing existing files over creating new ones. No new docs unless asked.
- Commit after every green criterion.

## Commits

`type(scope): imperative summary`, ≤ 50 chars, one logical change each. Types:
`feat fix perf refactor test docs chore build ci sec contract`. No AI attribution
trailers.

## Stack

pnpm workspaces + turbo · TypeScript strict · Zod · Vitest · Playwright · MV3 +
Vite/crxjs · React (side panel) · Fastify (gateway) · ONNX Runtime Web /
Transformers.js / tesseract.js (offscreen document).

## Verify before you say you're done

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm verify:boundary
```
