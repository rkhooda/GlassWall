## What

One sentence. No "and".

## Phase / acceptance criterion

PLAN-B §6 P__ — quote the specific criterion this satisfies.

## Contracts touched

[ ] None
[ ] C__ — and I opened a separate `contract:` PR for the schema change

## Checks

[ ] `pnpm build && pnpm test` green
[ ] Tests named in the acceptance criteria are present and passing
[ ] `verify:boundary` green (day 8+)
[ ] `bench:leakage` green (day 8+)
[ ] No `fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket`
[ ] No `eval` / `Function` / `innerHTML`
[ ] No file outside my ownership map (PLAN-B §4)
[ ] No raw value logged, traced, returned, or persisted outside `storage.session`
[ ] On failure, this code degrades toward MORE redaction, not less

## Metrics (if it moves a number)

Before → after. Model artifacts: metrics in the commit message + `MODEL_MANIFEST.json` updated.