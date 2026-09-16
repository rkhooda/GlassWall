# Project status

This is the current engineering status for GlassWall. Historical planning and
milestone notes remain in [`docs/archive/`](archive/); they are not required to run
the project.

## Current state

| Area | Status | Evidence or note |
|---|---|---|
| Browser loop | Complete | Observe → perceive → sanitize → gate → reason → validate → confirm → execute is implemented in the extension. |
| Privacy boundary | Complete | Session vault, typed handles, value-blind extraction, one typed egress path, registry scan, and leakage tests. |
| Local perception | Complete with known gaps | DOM/accessibility extraction, NER on WASM, policy-controlled OCR, and redacted screenshots in `BALANCED`. |
| Reasoning providers | Complete | OpenAI-compatible, Anthropic, and deterministic scripted adapters with failover and repair retry. |
| Extension UI | Complete | Side panel trace, privacy inspector, redaction explanations, audit export, and confirmation flow. |
| Evaluation harness | Complete for local benchmark | Playwright smoke, full task matrix, leakage canary, negative control, and metric reports. |
| Production hardening | In progress | Navigation validation, visual-PII detection, model footprint, and arbitrary-site compatibility remain open. |

## Verified baseline

Run these from the repository root:

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm verify:boundary
```

The checked-in benchmark report records 11/11 successful local task runs, zero safe-build
wire leaks, 97.8% visual recall, 100% PII recall, 95.6% redaction precision, 1059 ms
local compute per step, and 3446 ms p50 step latency. These are measurements of the
synthetic Chromium benchmark, not guarantees for arbitrary websites.

## Known limitations

- Chrome/Chromium only; the offscreen-document inference host is not portable to Firefox
  without a different architecture.
- Cross-origin iframe controls are represented as frames and are not inspected.
- NER is English and misses some bare localities in free prose; label context and
  explain-or-redact reduce, but do not eliminate, this gap.
- OCR is English, adds several seconds in some `BALANCED` steps, and is conservative when
  a crop times out or cannot be read.
- There is no face or general visual-PII detector; unexplained image regions are masked
  wholesale.
- Reasoning quality depends on the configured provider. The scripted planner supports
  common semantic form, search, and navigation flows but is not a general web agent.
- The local gateway is HTTP-only and intended for development. A deployed gateway needs
  TLS, authentication, rate limiting, and operational logging that does not capture raw
  values.
- The extension currently enforces same-origin navigation in the orchestration loop;
  navigation action validation should be tightened before broad deployment.

## Recent engineering decisions

- Raw input values are never part of the extractor output. `value_state` is derived from
  browser state signals without reading `.value`.
- Recognition sources are advisory. A failed or unavailable source increases masking;
  it cannot make an unexplained region releasable.
- The model receives typed handles, not resolved values. A vault reference is resolved
  only after local target/type validation and only for page execution.
- `apps/extension/src/background/net.ts` is the only network call site and accepts only
  the branded payload constructed by `egressGate()`.
- The schema package is the contract source of truth for extension, gateway, and tests.

## Next work

- [ ] Tighten `NAVIGATE` validation at the action guard and add focused regression tests.
- [ ] Improve pixel-level visual PII detection while retaining conservative masking on
  failure.
- [ ] Evaluate a smaller local NER model and reduce first-run model setup cost.
- [ ] Expand browser compatibility and test the loop on more real-world page patterns.

## Updating this file

Only record a result here when it is reproducible by a checked-in command or test. Put
historical project-origin material in `docs/archive/` and keep current claims aligned
with `SECURITY.md`, `PRIVACY.md`, `EVALUATION.md`, and the root README.
