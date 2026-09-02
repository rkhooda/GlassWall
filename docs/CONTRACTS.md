# CONTRACTS — the interfaces between the parts

The Zod schemas in `packages/schema/src` are the source of truth; this file explains
who produces and consumes each shape and the obligations that are not expressible in a
type. Schema changes go in their own commit prefixed `contract:`, followed by
`pnpm gen:schema` (CI fails if the generated JSON is stale).

## C1 — `RawObservation` · content script → service worker

`packages/schema/src/observation.ts`. Never leaves the device.

- `page`: `origin_class`, `url_template` (ids generalised, query and fragment dropped),
  `title_raw`, `type_hint`, `modal_active`, `stability`.
- `viewport`: `w`, `h`, `scroll_y_pct`, `doc_h_ratio`, `dpr`.
- `elements[]`: `id` (`e17`, sequential per observation), `id_hash`, `tag`, `role`,
  `type`, `label_raw`, `placeholder_raw`, `rect` (CSS px, 4 px grid), `visible`,
  `enabled`, `focusable`, `value_state` (`empty | partial | filled | n/a`),
  `options_count`, `group`, `frame`, `unexplained`, `autocomplete`, `input_type`.
- `text_nodes[]`: `id`, `rect`, `text`, `owner_element_id`, `source: 'dom'`.
- `frames[]`, `truncated`, `list_virtualized`.

Producer obligations (`apps/extension/src/content/extractor`): never read `.value`,
`innerHTML`, `outerHTML`, cookies or storage; derive `value_state` from
`:placeholder-shown`, validity and `textLength`; set `unexplained` on everything it
could not read (cross-origin frame, closed shadow root, canvas, image); populate
`owner_element_id` wherever an ancestor is a reported element; compute `id_hash` with
`content/identity.ts` so the executor can recompute it.

Consumer obligations: treat every `*_raw` field as sensitive; never persist or send a
`RawObservation`. The UNSAFE build violates this on purpose and is never shipped.

## C2 — the frame · service worker → offscreen document

A PNG data URL from `chrome.tabs.captureVisibleTab`, sent once per step inside the
`gw:perceive` message (`apps/extension/src/shared/perceive.ts`) with the viewport size
and `dpr`. The offscreen document decodes it, holds the bitmap for the step, and answers
`gw:redact` with a downscaled PNG that has the fused rectangles blacked out. Unredacted
pixels never leave the offscreen document; under STRICT no frame is captured and the
loop still runs.

## C3 — `PerceptionSource` · offscreen sources → `sanitize()`

`packages/privacy/src/sanitize.ts`:

```ts
interface PerceptionSource {
  id: 'ner' | 'ocr' | 'vision';
  timeout_ms: number;
  coverage?(ctx: PerceptionContext): Array<{ rect; reason }>;   // what this source is the account for
  run(ctx: PerceptionContext): Promise<SourceOutput>;            // evidence[], unexplained[], degraded[]
}
```

`apps/extension/src/background/perception.ts` wraps the offscreen document in these
adapters; `apps/extension/src/offscreen/pipeline/{ner,ocr}.ts` implement them in place
for tests. A source that throws or exceeds `timeout_ms` contributes its `coverage()` as
unexplained regions, which `sanitize()` masks. Evidence carries a `textSpan` for values
NER/OCR read; `sanitize()` registers it and substitutes the handle.

## C4 — `sanitize()` · privacy library → service worker

```ts
sanitize({ raw, frame: null, task, step, session: { session_id, policy_profile, secrets }, perceptionSources, budget })
  → { observation: SanitizedObservation, redactions: RedactionReason[], audit, timings, degraded: string[] }
```

Never throws; on an internal error it returns a maximally redacted observation with
`degraded: ['sanitize_exception']`. `session.secrets` (`SessionSecrets`) carries the
registry, tokenizer and vault across steps so `⟦EMAIL#1⟧` is stable and values seen on
one page are substituted on the next. The caller must `await secrets.flush()` after
each call to persist queued values to the vault.

## C5 — `SanitizedObservation` · `sanitize()` → gateway

`packages/schema/src/observation.ts`, strict at every level. Elements keep `tag`,
`role`, `rect`, state flags, `available_actions`, `sensitivity_class`, and `label_raw` /
`placeholder_raw` after substitution; text nodes carry substituted text; `handles[]`
lists type and tier only. There is no field for values, HTML, cookies, storage or raw
pixels.

## C6 — `egressGate()` · privacy library → `net.ts`

```ts
egressGate({ path, body }, registry, policy, destination) → Result<SafePayload, Violation>
send(p: SafePayload): Promise<{ status, body }>            // apps/extension/src/background/net.ts
```

`SafePayload` (`packages/schema/src/branded.ts`) is branded and constructed only by the
gate; `send()` accepts nothing else, so bypassing the gate is a compile error. Checks in
order: strict schema (`SessionRequest` or `StepRequest`), recognizer sweep over every
released string, registry scan (raw, normalized, nine encodings, 8-gram overlap for
tier ≤ 2), entropy heuristic, size budget, rate limit, destination pin. Fail-closed: a
violation aborts the step and is audited; nothing is stripped and retried.

## C7 — transport · extension ↔ gateway

`packages/schema/src/transport.ts`: `SessionRequest` (`task`, `policy_profile`,
`site_allowlist`) → `SessionResponse` (`session_id`, `budget`, `provider`);
`StepRequest` (`session_id`, `observation`, `history` ≤ 5, `last_result`,
`screenshot?: RedactedImagePayload`) → `StepResponse` (`action_envelope`, `provider`,
`latency_ms`); `HealthResponse` (`providers[]`, `active`). Paths in `GATEWAY_PATHS`.
The gateway validates every request with these schemas and returns `{ error, message }`
with a 4xx/5xx on failure; the client surfaces `error` as the run's error code.

## C8 — `ActionEnvelope` and the validator · gateway → service worker

`packages/schema/src/action.ts`: `action` (`CLICK`, `TYPE`, `SELECT`, `PRESS_KEY`,
`SCROLL`, `NAVIGATE`, `BACK`, `WAIT`, `DONE`, …), `observation_id`, `step_index`,
`session_id`, `risk`, `requires_confirmation`, `reasoning`. `TYPE.value` is
`{ kind: 'vault_ref', handle }` or `{ kind: 'literal', text }`; `user_input` is
rejected. Targets are `{ id, id_hash }`; there is no selector field.

The gateway's guard checks ids and handles against the observation it sent. The client
re-validates: freshness, target, `id_hash`, visibility, enabled, `available_actions`,
same-origin `NAVIGATE`, then rung 7 `checkVaultTypeMatch()` and rung 8
`scanLiteralAgainstRegistry()` (`packages/privacy/src/validator-hooks.ts`).

## C9 — `resolveForBinding()` · privacy library → executor

```ts
resolveForBinding(handle, { element_id, sensitivity_class, accepts }, vault) → Result<Sensitive<string>, Violation>
```

Rejects a handle whose type is not in `accepts` (`VAULT_TYPE_MISMATCH`, audited as a
potential exfiltration attempt) or that the vault does not hold (`HANDLE_NOT_FOUND`).
The resolved literal is placed in the `gw:execute` tab message and nowhere else: not in
the trace, the history, the audit, or any request.

## C10 — messages · panel ↔ service worker ↔ content script

`apps/extension/src/shared/messages.ts` is one discriminated union: panel → worker
(`gw:start`, `gw:abort`, `gw:confirm-response`, `gw:get-state`, `gw:get-audit`,
`gw:get-health`), worker → panel (`gw:state`, `gw:trace`, `gw:confirm-request`,
`gw:inspect`, `gw:error`), worker → content (`gw:ping`, `gw:observe`, `gw:execute`,
`gw:overlay`, `gw:overlay-clear`, `gw:eval-hook`) and content replies (`gw:pong`,
`gw:observation`, `gw:action-result`, `gw:ok`, `gw:content-error`). `gw:inspect`
carries the raw and sanitized observation to the panel for the inspector; it stays
inside the extension.

## C11 — audit · service worker → panel and storage

`AuditEntry` (`shared/messages.ts`): per step, action type, provider, latency, element
and handle counts, redaction count and rectangles with reasons, degraded sources, gate
and validation verdicts, payload bytes, observed elements (tag, rect, visible) and
timings. No field can hold a value; `assertNoValuesInAudit()` in
`packages/privacy/src/audit.ts` is the test-time check.

## C12 — bench-site instrumentation · bench sites → harness

```html
<span data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17">…</span>
<canvas data-glasswall-regions='[{"pii":"AADHAAR","x":..,"y":..,"w":..,"h":..}]'>
<span data-glasswall-pii="PHONE" data-glasswall-decoy="true">…</span>
```

Read only by `eval/harness/runner.ts` from inside the page. `verify:boundary` check 3
asserts the built extension contains no `data-glasswall-` reference; `data-gw-eval-*`
on the document element is the harness hook the content script does set (ready, step,
done) and it carries no page content.
