# GLASSWALL — Agent Context

You are working in the GLASSWALL repo (SIH26171). Read this file fully before any task.

## Documents

| File                           | What it is                                     | Authority                                |
| ------------------------------ | ---------------------------------------------- | ---------------------------------------- |
| `PLAN.md`                      | Full architecture + phase specs                | **Authoritative on architecture**        |
| `PLAN-A-AGENT-CONTROL.md`      | My lane (A) — ownership, contracts, sequencing | **Authoritative on who does what**       |
| `PLAN-B-PERCEPTION-PRIVACY.md` | Teammate's lane (B) — reference only           | Do not implement anything from this file |
| `docs/CONTRACTS.md`            | The 10 interface contracts C1–C10              | **Authoritative on interfaces**          |

## What I own (Lane A)

The browser: DOM extraction → screenshot capture → action validation → execution → the step loop → the backend gateway → the repo.

**I do NOT own** and you must **never create or edit**:
`packages/privacy/**` · `packages/inference/**` · `packages/perception/spatial-index.ts` · `packages/perception/observation-builder.ts` · `apps/extension/src/offscreen/pipeline/**` · `apps/extension/src/background/privacy/**` · `apps/extension/src/sidepanel/privacy/**` · `apps/bench-site/src/sites/{clinicdesk,maillite}/**` · `apps/bench-site/src/{data/generator.ts,instrument.ts}` · `eval/leakage/**` · `eval/ablations/**` · `eval/metrics/{privacy,detection}.ts` · `ml/**` · `config/policies/*.json` · `scripts/verify-boundary.sh` · `SECURITY.md` · `PRIVACY.md` · `MODEL_CARD.md` · `EVALUATION.md`

If a task seems to require touching one of these, **stop and tell me**. Do not stub it in "temporarily".
When calling into B's code that doesn't exist yet, import from the contract type in `packages/schema` and let it fail to resolve — do not write a fake implementation in his directory.

## Hard rules (violating any of these fails the task)

1. **One `fetch` in the entire repo**, in `apps/extension/src/background/net.ts`. No `XMLHttpRequest`, `sendBeacon`, or `WebSocket` anywhere. Enforced by ESLint + CI grep.
2. **`net.ts` exposes `send(p: SafePayload)` only.** `SafePayload` is a branded type produced solely by B's `egressGate()`. Bypassing the gate must be a compile error, not a review note.
3. **No `eval`, `Function`, `innerHTML`, `insertAdjacentHTML`, or model-supplied selectors** anywhere in the execution path. There must be no code path from model output to any of them.
4. **The extractor never reads** `.value`, `.innerHTML`, `.outerHTML`, `document.cookie`, `localStorage`, `sessionStorage`, or `indexedDB`. It is the privacy boundary (PLAN.md §6.3, Layer 1), not just a parser.
5. **Never log, trace, or transmit a resolved vault value.** `Sensitive<T>` values go vault → page and nowhere else.
6. **Freeze respected:** types in `packages/schema` may only change via a PR touching _only_ that package, titled `contract: ...`. Never edit a frozen type inline as part of a feature.
7. **`main` must build and pass the smoke demo at every commit.** If a feature isn't ready, put it behind a policy flag rather than leaving `main` broken.

## Working method

- **Read the phase spec in `PLAN.md` before writing code.** Implement to its stated acceptance criteria, not to your own idea of "done".
- **Never skip tests named in a phase.** They exist to catch specific, named failures.
- **If an acceptance criterion cannot be met, stop and report.** Do not silently lower it.
- **If `PLAN.md` is ambiguous, ask.** Do not invent architecture.
- Where `PLAN.md` says _VERIFY_, verify before writing code that depends on it.
- Prefer editing existing files over creating new ones. No new docs unless asked.

## Commits

Format: `type(scope): imperative summary` — ≤50 chars, imperative mood.
Types: `feat fix perf refactor test docs chore build ci sec`
Scopes: `extension content background offscreen sidepanel perception agent backend schema eval bench-site docs`

Commit after every green acceptance criterion. Banned: `wip`, `update code`, `fixed stuff`, `final2`.

## Stack

pnpm workspaces + turbo · TypeScript strict · Zod (schema source of truth → JSON Schema) · Vitest (unit) · Playwright (integration) · MV3 + Vite/crxjs · React (side panel) · Fastify (backend).

## Verify before you say you're done

```bash
pnpm build && pnpm test && pnpm lint
```

Plus: no new `fetch` call sites, no forbidden tokens, no files outside my ownership map.
