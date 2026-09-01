# SECURITY

GLASSWALL lets a remote language model drive a browser without letting it see what
the page contains. This document says how, says what it does not do, and gives a
file and a function for every claim so the claims can be checked rather than trusted.

Everything numeric here was measured on the hardware named in [`EVALUATION.md`](./EVALUATION.md).
Where a criterion was missed, the miss is stated in place of the criterion.

---

## What we do not guarantee

These are first because they are the load-bearing part. A privacy system that lists
only its strengths is not describing a system, it is selling one.

**N1 — We do not guarantee perfect recall.** Statistical detectors have finite recall
and ours do too. Measured: NER `STREET_ADDRESS` recall is **0.84**, against a target
of 0.90. The misses are bare Indian localities with no road or street token — *BTM
Layout*, *Hebbal*, *Koramangala* — for which the model predicts no entity at all. On
the ablation scene that leaves a residual **2.0% leakage in every configuration**,
including with the vision model disabled and including under STRICT. It is published
in `eval/reports/report.md` and plotted on the frontier chart rather than rounded away.
Our mitigation is structural, not statistical: detection is the *second* layer, and the
first one does not depend on detection at all.

There is a sharper version of N1 that the chaos suite measured directly. A perception
source that **throws or times out is detected**, and losing it makes the system redact
*more*. A source that loads, runs, and silently returns nothing is **not detectable** —
it is indistinguishable from a clean page. In that configuration leakage rises from 1
value to 2 on the ablation scene. See `eval/leakage/chaos.ts` and the table in
[`EVALUATION.md`](./EVALUATION.md). This is why fusion combines several independent
sources instead of trusting one.

**N2 — We do not guarantee non-inference.** A sanitized observation still carries
structure: page type, field counts, workflow position, quantized geometry. A determined
adversary may infer context from that. We do not claim differential privacy. We handle
the top of the extended-identifier distribution (order IDs, tracking numbers) and say
so; we do not claim to have handled all of it.

**N3 — We do not guarantee malicious-page immunity.** We **mitigate** prompt injection.
We do not prevent it, and this document will not say otherwise. A page controls its own
text and can try to steer the agent. What stands between it and harm is structure,
validation and human confirmation — see [Prompt injection](#prompt-injection-mitigation-not-prevention)
below, which is titled that way deliberately.

**N4 — We do not guarantee a benign reasoner.** If the remote model is adversarial it
can emit hostile actions. The action validator is the defence, and a validator is
defence-in-depth, not a proof.

**N5 — We do not address side channels.** Payload size, step counts and timing carry
information. Out of scope, documented, not mitigated.

---

## What we do guarantee, and where to check it

| | Guarantee | Enforced by | Verified by |
|---|---|---|---|
| **G1** | Raw HTML, raw DOM, raw screenshots, raw OCR text, cookies, storage and input values are never serialized outbound — because the outbound type has no field that can hold them | `packages/perception/src/observation-builder.ts` (allowlist projection) · `SanitizedObservationSchema` in `packages/schema/src/observation.ts`, `.strict()` at every level | `apps/extension/src/offscreen/pipeline/no-raw-leak.test.ts` (raw NER/OCR output never reaches the payload) · `packages/schema/src/schema.test.ts` (the strict schema rejects unknown keys) · the `schemaValid` assertion on all 44 chaos configurations |
| **G2** | No string in the session Secret Registry appears in an outbound payload, raw, normalized, or in any of nine encodings | `egressGate()` → `checkRegistryScan()`, `packages/privacy/src/egress-gate.ts:145` · encodings in `packages/privacy/src/registry/encodings.ts` | `packages/privacy/src/egress-gate.test.ts` (one test per check and per encoding) · `apps/extension/src/sidepanel/privacy/encodings.test.ts` |
| **G3** | All extension network activity goes to the pinned gateway origin, from exactly one call site | `apps/extension/src/background/net.ts` — the only `fetch` in the repo; `send()` accepts only `SafePayload` | `scripts/verify-boundary.sh` checks 1, 4, 5, 7 — **check 4 currently FAILS**, see [Residuals](#residuals) |
| **G4** | No code path exists from model output to `eval`, `Function`, `innerHTML`, `insertAdjacentHTML`, or a model-supplied selector | absence, enforced by lint + CI grep | `scripts/verify-boundary.sh` check 2 ✅ |
| **G5** | Every step emits an audit record with no field capable of holding a value | `buildAuditPrivacyFields()`, `packages/privacy/src/audit.ts:22` | `assertNoValuesInAudit()`, `packages/privacy/src/audit.ts:54`, asserted in `no-raw-leak.test.ts` |

---

## Threat model

| | Adversary | Capability | In scope | Our control | Where |
|---|---|---|---|---|---|
| **A1** | Curious or compromised model provider | Sees and may log everything we send | ✅ primary | Allowlist observation, tokenization, egress gate | `observation-builder.ts` · `tokenizer.ts` · `egress-gate.ts` |
| **A2** | Network observer | Sees payloads in transit | ✅ | TLS, plus a payload that contains nothing sensitive by construction | `net.ts` · G1 |
| **A3** | Malicious web page | Controls DOM text, attempts prompt injection, renders fake UI | ✅ | Structured observation (no raw HTML reaches the model), action validator, origin allowlist, confirmation on high risk | §[Prompt injection](#prompt-injection-mitigation-not-prevention) |
| **A4** | Buggy or adversarial agent output | Emits harmful or malformed actions | ✅ | Schema validation, freshness + identity-hash binding, risk classification, type-matched vault binding | `resolveForBinding()`, `packages/privacy/src/resolve.ts:71` · `checkVaultTypeMatch()`, `validator-hooks.ts:19` |
| **A5** | Our own code leaking by accident | A developer logs a raw value | ✅ | `Sensitive<T>` branding, single `fetch` call site, CI canary tests, `assertNoValuesInAudit()` | `sensitive.ts` · `verify-boundary.sh` · `eval/leakage/` |
| **A6** | Another extension reading our storage | Reads `chrome.storage.session` | ⚠️ partial | Session-lifetime vault, no persistence of values, wiped on session end | `vault-store.ts` — **residual, see below** |
| **A7** | Compromised OS or keylogger | Total device compromise | ❌ out of scope | None. Documented. | — |
| **A8** | Statistical re-identification from structure | Infers identity from page type, workflow and counts | ⚠️ acknowledged | Extended-identifier handling, URL templating, quantized geometry | **Explicitly not solved** — N2 |

### A6, stated plainly

The vault lives in `chrome.storage.session` (`packages/privacy/src/vault-store.ts`),
never `storage.local` and never IndexedDB — `verify-boundary.sh` check 6 greps for
both and passes. Session storage is not readable by web pages. It **is** readable by
another extension with the right permissions installed in the same profile. We do not
defend against that. The mitigation is lifetime, not access control: values exist only
while the session does.

---

## The three layers

> **Layer 1** — we never construct a payload containing sensitive data, because the
> builder is an allowlist projection.
> **Layer 2** — detectors tokenize whatever residual free text or pixels remain.
> **Layer 3** — the gate refuses to send anything that still matches a known secret,
> and the browser itself refuses to connect anywhere but our gateway.

Layer 1 is the one that does not depend on a model being right. Layers 2 and 3 exist
because Layer 1's input — what the extractor chose to emit — is still page-controlled.

### Layer 2, in the order it runs

Tier 1 short-circuits everything. `input[type=password]`, `autocomplete` tokens
(`cc-number`, `cc-csc`, `one-time-code`), OTP heuristics — these are decided by
deterministic rules in `packages/privacy/src/recognizers/element-rules.ts` and no ML
output is consulted. **A probabilistic score must never be what decides whether a
password is released.** Tier 1 emits `⟦PASSWORD⟧` with no index, so not even
cardinality leaks.

Below Tier 1: deterministic recognizers with checksums (Verhoeff for Aadhaar, Luhn for
cards, the PAN and IFSC and GSTIN and UPI shapes) → NER over DOM free text → OCR over
regions the DOM cannot explain → fusion by noisy-OR in `packages/privacy/src/fusion.ts:69`.

Noisy-OR is chosen for two properties. It is **monotone** — adding evidence never
lowers suspicion, asserted by a 500-case property test in `fusion.test.ts` — and it
**fails toward privacy**, since one strong signal suffices. A compromised vision model
can therefore only cause over-redaction, never a leak.

### Explain-or-redact

`explainOrRedact()` (`packages/privacy/src/coverage.ts:58`) unions the rects of
elements the extractor emitted with known-low sensitivity. Anything outside that union
is `unexplained` and takes `policy.unexplained_prior` — 0.8 under STRICT, 0.4 under
BALANCED. This converts *"we might have missed something"* into *"we withheld what we
could not account for"*, and it is what holds leakage flat when the vision model is
switched off entirely (ablation A8 = A7, `eval/reports/p11-ablation.md`).

A fix made during P14-B is worth naming here because it was a real hole: a fused region
used to redact **pixels** without touching the corresponding **text node**, so a text
node could be correctly marked unexplained, correctly masked in the screenshot, and
still ship verbatim in the payload. `sanitize()` now applies the region to the text as
well — but only for regions carrying no detection evidence, because replacing a whole
paragraph where a detector already fired would throw away the type-preserving
tokenization the system exists to provide.

### Layer 3, the egress gate

`egressGate()` — `packages/privacy/src/egress-gate.ts:263`. Pure, synchronous,
fail-closed. Seven checks in order, **six of which are implemented**:

| # | Check | Function | State |
|---|---|---|---|
| 1 | Schema conformance, `additionalProperties: false` at every level | `checkSchemaConformance()`:65 | ✅ |
| 2 | Type-brand: every released string came from the tokenizer | `checkTypeBrand()`:80 | ✅ |
| 3 | Registry scan, normalized + nine encoded forms + 8-gram overlap | `checkRegistryScan()`:145 | ✅ |
| 4 | Entropy heuristic for accidental key passthrough | `checkEntropyHeuristic()`:178 | ✅ |
| 5 | Payload size budget | `checkSizeBudget()`:210 | ✅ |
| 6 | Rate limit — steps/minute, session bytes | `checkRateLimit()`:223 | ❌ **stub, returns `null` unconditionally** |
| 7 | Destination origin equals the configured gateway | `checkDestinationPin()`:227 | ✅ |

Check 6 is not implemented. It is a resource-exhaustion control, not a disclosure
control, so its absence does not weaken G2 — but the gate is advertised as seven checks
and it is currently six, and that belongs here rather than in a commit message.

**On any failure the step aborts.** `fail_mode: CLOSED`. We do not strip the offending
field and retry, because silently repairing a violation hides the bug that caused it.
The UI names the violated check and an audit record is written.

---

## Prompt injection: mitigation, not prevention

We do not solve prompt injection. Saying otherwise would be the least credible sentence
in this repository.

What we actually do:

1. **No raw HTML or free-form page text reaches the model in instruction position.**
   Everything arrives inside typed JSON fields under an `untrusted_page_content` wrapper.
2. **Instruction/data separation** in the system prompt, restated every turn.
3. **The validator is the arbiter, not the model.** A fully hijacked model still cannot
   execute JavaScript (no code path exists — G4), navigate off-origin without
   confirmation, bind a mismatched vault handle (`resolveForBinding()` rejects it and
   logs a potential exfiltration attempt), act on a stale element, or exceed the budget.
4. **Origin allowlist** on `NAVIGATE`, with the destination shown to the user.
5. **Loop and anomaly detection** pauses the session on repetition or a spike in
   high-risk actions.

The honest summary: a hostile page can waste the agent's steps and can try to make it
ask the user for something. It cannot make the extension run code, and it cannot make
the extension send a value the registry knows about — those are structural, not
prompt-level, defences.

---

## Failure matrix

Every row names a file and a function you can open. "Fail-closed" throughout means the
failure produces *more* redaction and a smaller payload, never less and never larger.

| Failure | What happens | Direction | Code |
|---|---|---|---|
| NER model will not load | Every non-empty text node is marked unexplained and redacted | fail-closed | `unavailable()`, `apps/extension/src/offscreen/pipeline/ner.ts` |
| NER throws or hangs past its timeout | `sanitize()` reads the source's declared `coverage()` and marks the same regions unexplained | fail-closed | `PerceptionSource.coverage`, `packages/privacy/src/sanitize.ts` |
| NER returns nothing, silently | **Not detected.** Leakage rises. | **fail-open** | N1 — measured in `eval/leakage/chaos.ts` |
| OCR worker will not start | Crops and deferred regions reported unexplained, then masked | fail-closed | `unreadable()`, `apps/extension/src/offscreen/pipeline/ocr.ts` |
| OCR exceeds its recognition budget | Unread crops reported as `ocr_timeout` and masked | fail-closed | `runOcrOnCrops()`, `packages/inference/src/ocr/wrapper.ts` |
| More unexplained regions than the crop budget | Over-budget regions masked, not passed | fail-closed | `selectCrops()`, `packages/inference/src/ocr/crop-policy.ts` |
| Policy disables the screenshot (STRICT) | Pixel regions reported unexplained; the OCR engine is never loaded | fail-closed | `SCREENSHOT_DISABLED`, `ocr.ts` |
| Vision model compromised or wrong | Noisy-OR is monotone, so it can only raise suspicion | fail-closed by construction | `noisyOr()`, `packages/privacy/src/fusion.ts:52` |
| `sanitize()` itself throws | Returns a maximally-redacted observation with `degraded: ['sanitize_exception']` | fail-closed | `createMaximallyRedactedResult()`, `sanitize.ts` |
| Egress gate check fails | Step aborts, red banner names the check, audit record written. No strip-and-retry. | fail-closed | `egressGate()`, `egress-gate.ts:263` |
| Vault handle bound to a mismatched target | Rejected as `VAULT_TYPE_MISMATCH` and logged as a potential exfiltration attempt | fail-closed | `resolveForBinding()`, `resolve.ts:71` |
| Vault handle not found | `HANDLE_NOT_FOUND`; nothing is typed | fail-closed | `resolve.ts:77` |
| Warm-up fails at install | Swallowed and reported; the step pays the cold start instead | degrades, never fatal | `warmUpInference()`, `packages/inference/src/warmup.ts` |

The whole matrix is exercised, not asserted: `eval/leakage/chaos.test.ts` runs every
combination of failed sources under three failure modes across two profiles, and checks
that every configuration terminates, names what broke, redacts no less than healthy,
leaks no more than healthy, and exposes zero Tier-1 values.

---

## Residuals

Things that are true today and that we would rather you heard from us.

1. **`connect-src` is not pinned.** `apps/extension/manifest.json` has
   `connect-src 'self'` and no gateway origin. `verify-boundary.sh` check 4 fails on
   this. G3's manifest half is therefore *not* currently enforced; the single call site
   and the `SafePayload` brand still are. Logged in `docs/REQUESTS-TO-A.md`.
2. **The extractor reads `.value`.** `apps/extension/src/content/extractor/walk.ts:580`
   and `:591` read it to derive `value_state: 'empty' | 'filled'`. The string is
   discarded and never emitted, so this is not a live leak — but the Layer 1 invariant
   is meant to be *grep-provable*, and this makes it not. `verify-boundary.sh` check 8
   (added in P14-B) fails on exactly these two lines. Logged for A.
3. **The gate's rate limit is a stub.** See the check table above.
4. **Handles are not HMAC-derived.** `PLAN.md` §4.5 specifies
   `HMAC(session_salt, normalize(value))`. The implementation
   (`packages/privacy/src/tokenizer.ts`) uses a per-session insertion counter keyed on
   `salt \0 normalize(value)` in a map that never leaves the instance and is never
   serialized. The security properties asked for still hold — deterministic within a
   session, and carrying no value-derived material at all, which is strictly stronger
   than a truncated HMAC against a rainbow-table oracle — but it is not what the plan
   says, and the deviation is deliberate: the node-only `createHmac` broke the browser
   build and bought nothing.
5. **The gateway is `http://localhost:3000`.** Development only. `net.ts` hardcodes it.
   TLS in A2 is a claim about a deployment that does not exist yet.
6. **No vision detector.** P10 was a stretch item and was not built. This costs nothing
   measurable: ablation A8 (fusion + explain-or-redact, vision disabled) scores
   identically to A7 with it enabled, because coverage — not a detector — is what
   accounts for the pixel channel. A half-trained detector would have been worse than
   the designed degradation.
7. **No policy can release a checksum-verified value, and `PLAN.md` §11.4 says one
   can.** The deterministic recognizers in `sanitize()` tokenize their matches
   unconditionally — the policy decision is computed and recorded *after* the
   substitution has already happened. Measured while scripting the demo: STRICT,
   BALANCED, PERMISSIVE, and a hand-built profile with every source weight at 0 and
   Tiers 2/3/5 set to `PASS` all produce **identical leakage**. §11.4's table describes
   PERMISSIVE as passing Tier 3; the implementation does not, and cannot.
   This is a deviation in the safe direction and we are keeping it — "no configuration
   releases a value that passed a checksum" is a better property than the one specified.
   Two consequences worth stating: the PERMISSIVE row in the frontier is not the
   permissive configuration §11.4 describes, and the on-stage negative control cannot be
   produced by flipping a policy flag. It is produced instead by a silently-failing
   perception source, which is a real failure mode rather than a switch — see
   `docs/DEMO-B.md` beat 2.
8. **MailLite was never built.** `apps/bench-site/src/sites/maillite/` contains only a
   `.gitkeep`. The free-text and email surface it was meant to provide does not exist,
   so no measurement in this repository covers it. ClinicDesk carries the free-text and
   canvas channels instead.
9. **`packages/privacy` has 214 open ESLint errors.** Style and strictness, not
   correctness; the suite is green and typechecks clean. Pre-existing, tracked in
   `docs/PROGRESS-B.md`.

---

## Reporting

This is a hackathon project (SIH26171) and not deployed. If you find a way through any
of the above, the useful thing is a failing test in `eval/leakage/` — that is the form
in which we can act on it, and the form in which it stays fixed.
