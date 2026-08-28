# PLAN-B — Local Perception & Privacy Lane

### SIH26171 · GLASSWALL · Owner: **B**

> **Companion document:** `PLAN-A-AGENT-CONTROL.md` (A's lane)
> **Master document:** `PLAN.md` — the full architecture. Read §4, §6, §11 and §12 before writing code.
> **Working mode:** you work on branches and open PRs. A reviews and merges. Nothing goes to `main` directly.

---

## 0. Your scope in one line

> **You own what the agent is allowed to know: everything between "here is a page structure and some pixels" and "here is a sanitized observation that provably contains no secret."**

You are the **eyes and the filter**. A is the **hands and the loop**.

Concretely, you own five things:

1. **Local perception** — OCR, the visual sensitive-region detector, local NER. All running in-browser, no network.
2. **Sensitivity determination** — deterministic recognizers, Tier-1 rules, fusion, explain-or-redact coverage.
3. **The vault** — tokenization, handles, the secret registry, type-matched resolution.
4. **The egress gate** — the single fail-closed choke point, plus the canary harness that proves it works.
5. **The proof** — leakage evaluation, ablations, `SECURITY.md`, `PRIVACY.md`, `MODEL_CARD.md`.

Items 3, 4 and 5 are the ones that make this project win. `PLAN.md` §20.3 lists four things that may **never** be cut — three of them are yours.

---

## 1. What you do _not_ own (read this first)

The most likely way you and A waste a week is by both building a DOM extractor. So, explicitly:

**You never touch the DOM.** A's content script extracts the page into a `RawObservation` (contract C1) and captures the viewport into a `CapturedFrame` (contract C2). Both arrive at your pipeline. You analyse them. You never query, read, or modify a live page.

**You never execute an action.** The validator ladder and executor are A's. You contribute exactly two rungs of the ladder as pure functions (contract C8) and one resolution function (C7). That is your entire involvement in control.

**You never call `fetch`.** There is exactly one network call site in the repo and it is A's `net.ts`. A PR from you containing `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket` is rejected on sight — including for downloading model weights. Models ship in the bundle or load via `chrome.runtime.getURL`.

The corrected per-step sequence — note that A runs _before_ you, not after:

```
A: extract RawObservation + capture frame
        ↓  C1 + C2
B: OCR · vision · NER · recognizers → fusion → explain-or-redact
   → policy → tokenize → vault → SanitizedObservation → egressGate()
        ↓  C5 as C6 SafePayload
A: send → model → action → validate (your rungs 7-8) → resolve vault (your C7) → execute
        ↓
A: re-observe → loop
```

---

## 2. Why your lane is the good one

Two facts worth internalising on day 1:

**You are almost never blocked.** `packages/privacy/**` is pure TypeScript with **zero browser dependencies** — deliberately, so it unit-tests in Node in milliseconds (`PLAN.md` §10.1). Recognizers, tokenizer, vault, registry, fusion, coverage, policy engine and the egress gate — roughly 60% of your lane — you can build and fully test on day 1 with nothing but Vitest, before A's extension even loads. Use that. Front-load the pure work.

**Your phases are the ones judges remember.** The deferred-value-binding demo (a form fills correctly while the network log contains no email address) and the negative control (deliberately weakening the policy and watching the canary harness go red) are the two moments the room actually understands. `PLAN.md` §1.3 calls these differentiators I2 and I3.

---

## 3. Reality check — this plan was written for 5–6 people

`PLAN.md` §5.3 assumes a team of 5–6. There are two of you. A has already scoped the project down; here is what that means for your lane:

| Item                      | Master plan                                                          | Your version                                                     | Why                                                                                         |
| ------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **NER (P8)**              | fine-tune DistilBERT on ai4privacy, export ONNX, quantize            | **Off-the-shelf ONNX NER via Transformers.js. No training.**     | Training is 2.5 days you do not have. Report the model you used honestly in `MODEL_CARD.md` |
| **OCR (P9)**              | PP-OCRv5 mobile det+rec via raw ORT-Web with hand-written CTC decode | **tesseract.js first.** PP-OCRv5 only if you are ahead by day 11 | CTC decode + DB post-processing is a multi-day rabbit hole                                  |
| **Vision detector (P10)** | Playwright datagen + YOLOv8n training + export                       | **Stretch. Cut by default.**                                     | 3 days. Explain-or-redact holds leakage at 0 without it — that is the whole point of I1     |
| **Bench sites**           | MailLite + ClinicDesk                                                | **ClinicDesk only** (canvas + image PII), MailLite if ahead      | ClinicDesk is what proves OCR earns its place                                               |
| **Ablations**             | A1–A7                                                                | **A1 (DOM-only), A6 (fusion), A7 (+explain-or-redact)**          | §20.1 sanctions this. Three points still make a frontier                                    |

If you finish the pure-TS core early — genuinely possible — spend the surplus on the **vision detector**, in that order, not on polishing OCR.

---

## 4. Directory ownership map

**If a path is not yours, you do not commit to it — you open an issue or ask in standup.** The same rule binds A.

| Path                                                                 | Owner | Notes                                                                                                        |
| -------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `packages/privacy/**`                                                | **B** | Entirely yours. Pure TS, zero browser APIs                                                                   |
| `packages/inference/**`                                              | **B** | ORT-Web wrappers, EP selection, OCR/NER/vision pre+post                                                      |
| `packages/perception/spatial-index.ts`                               | **B** |                                                                                                              |
| `packages/perception/observation-builder.ts`                         | **B** | Allowlist projection into `SanitizedObservation`                                                             |
| `packages/perception/geometry.ts`                                    | A     | Rect ops, IoU, quantization, coordinate transforms. **Import it, never edit it.** Need a new function? Ask A |
| `packages/schema/**`                                                 | A     | The contract. You propose changes via the §5 protocol                                                        |
| `apps/extension/src/offscreen/pipeline/**`                           | **B** | `image/`, `ocr.ts`, `ner.ts`, `vision.ts` — every handler body                                               |
| `apps/extension/src/offscreen/{offscreen.html,host.ts,sandbox.html}` | A     | Document lifecycle + RPC transport only                                                                      |
| `apps/extension/src/background/privacy/**`                           | **B** | `vault-store.ts`, registry persistence in `storage.session`                                                  |
| `apps/extension/src/background/**` (rest)                            | A     | Orchestrator, capture, `net.ts`, validator, session                                                          |
| `apps/extension/src/content/**`                                      | A     | **All of it.** Extractor, executor, overlay                                                                  |
| `apps/extension/src/sidepanel/privacy/**`                            | **B** | `Inspector.tsx`, `Handles.tsx`                                                                               |
| `apps/extension/src/sidepanel/**` (rest)                             | A     | Shell, trace, confirm, error states                                                                          |
| `apps/extension/manifest.json`                                       | A     | Need a CSP change for WASM? **Ask in writing, do not edit**                                                  |
| `apps/bench-site/src/sites/{clinicdesk,maillite}/**`                 | **B** | Canvas / image / free-text PII — your test surface                                                           |
| `apps/bench-site/src/sites/{shoplite,govportal}/**`                  | A     | A needs these on day 3 to test extraction                                                                    |
| `apps/bench-site/src/data/generator.ts`                              | **B** | Seeded PII generator — drives canaries and labels                                                            |
| `apps/bench-site/src/instrument.ts`                                  | **B** | `data-glasswall-*` helper. **Spec due end of day 1** (contract C10)                                          |
| `eval/leakage/**`, `eval/ablations/**`                               | **B** |                                                                                                              |
| `eval/metrics/{privacy,detection}.ts`                                | **B** |                                                                                                              |
| `eval/harness/**`, `eval/tasks/**`                                   | A     |                                                                                                              |
| `ml/**`                                                              | **B** |                                                                                                              |
| `config/policies/*.json`                                             | **B** |                                                                                                              |
| `scripts/verify-boundary.sh`                                         | **B** |                                                                                                              |
| `SECURITY.md`, `PRIVACY.md`, `MODEL_CARD.md`, `EVALUATION.md`        | **B** | You write, A reviews for honesty                                                                             |
| `README.md`, `ARCHITECTURE.md`, `DEMO.md`                            | A     |                                                                                                              |

---

## 5. THE CONTRACT SURFACE

> **⚠️ MIRRORED SECTION — this text is identical in `PLAN-A` and `PLAN-B`.**
> Copy it to `docs/CONTRACTS.md` on day 1 and make that the canonical version. Neither person edits it alone; see the change protocol at the end of this section.

These ten contracts are the _entire_ seam between the two lanes. If both sides honour them, the code cannot collide.

### C1 — `RawObservation` · A produces → B consumes

Defined in `packages/schema/observation.ts`. **Owner: A.** Never leaves the device.

```ts
interface RawObservation {
  observation_id: string;
  session_id: string;
  step: number;
  page: {
    origin_class: 'internal' | 'external' | 'benchmark';
    url_template: string; // path with ids generalized; query+fragment already dropped by A
    title_raw: string; // RAW — B tokenizes it
    type_hint: 'form' | 'list' | 'detail' | 'auth' | 'checkout' | 'search' | 'other';
    modal_active: boolean;
    stability: 'stable' | 'timeout';
  };
  viewport: { w: number; h: number; scroll_y_pct: number; doc_h_ratio: number; dpr: number };
  elements: RawElement[]; // ≤ policy.max_elements, A truncates by interactivity + proximity
  text_nodes: RawTextNode[]; // RAW text — local only
  frames: { id: number; origin: 'same' | 'cross'; rect: Rect }[];
  truncated: boolean;
  list_virtualized: boolean;
}

interface RawElement {
  id: string; // "e17" — sequential within this observation
  id_hash: string; // identity binding, see PLAN.md §12.2
  tag: string;
  role: string;
  type?: string;
  label_raw: string; // accessible name, RAW — B tokenizes
  placeholder_raw?: string;
  rect: [number, number, number, number]; // CSS px, quantized to 4px grid
  visible: boolean;
  enabled: boolean;
  focusable: boolean;
  value_state: 'empty' | 'partial' | 'filled' | 'n/a'; // A NEVER reads the value itself
  options_count?: number;
  group: string; // "form#shipping > fieldset#address"
  frame: number; // 0 = top
  unexplained?: boolean; // cross-origin iframe, closed shadow root, tainted canvas
  autocomplete?: string; // raw token — B's Tier-1 rules need it
  input_type?: string; // raw — B's Tier-1 rules need it
}

interface RawTextNode {
  id: string;
  rect: Rect;
  text: string; // RAW — local only
  owner_element_id: string | null; // null ⇒ B treats as unexplained
  source: 'dom';
}
```

**A's obligations:** rects in CSS px normalized for DPR; `value_state` derived without reading the value; `unexplained:true` set for every region A could not read; `owner_element_id` populated wherever possible (it is what makes explain-or-redact work).
**B's obligations:** treat every `*_raw` field as untrusted and sensitive; never persist a `RawObservation`; never send it anywhere.

### C2 — `CapturedFrame` · A produces → B consumes

```ts
interface CapturedFrame {
  bitmap: ImageBitmap; // transferred, not copied
  dpr: number;
  viewport_w: number;
  viewport_h: number;
  captured_at: number;
  stale: boolean; // true if captureVisibleTab was throttled and A reused the last frame
}
```

**A's obligations:** capture in the service worker, transfer to the offscreen document as a transferable, never base64 across the bus, never persist. If capture is unavailable (`chrome://`, throttle, missing permission) A passes `null` and **the loop must still run**.
**B's obligations:** own everything downstream — decode, downscale, DPR normalization, redaction. **Unredacted pixels never leave the offscreen document.** `.close()` every bitmap.

### C3 — `InferenceHost` RPC · A hosts → B implements

```ts
interface InferenceHost {
  init(cfg: { preferredEP: 'webgpu' | 'wasm' | 'auto' }): Promise<Capability>;
  load(modelId: string): Promise<{ ms: number; ep: string }>;
  run(modelId: string, inputs: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  bench(modelId: string, n: number): Promise<BenchResult>;
}
```

**A owns:** `offscreen.html`, document lifecycle (create/keepalive/teardown), the RPC transport, the sandboxed-iframe fallback shell if CSP requires it.
**B owns:** every handler body, EP selection, session cache, warmup, model registry.
**Message namespaces on A's bus:** B registers only under `perception:*` and `privacy:*`. A guarantees delivery and ordering per namespace.

### C4 — `sanitize()` · B's single entry point → A calls it

```ts
async function sanitize(input: {
  raw: RawObservation;
  frame: CapturedFrame | null;
  task: string;
  step: number;
  session: { session_id: string; policy_profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' };
}): Promise<SanitizeResult>;

interface SanitizeResult {
  observation: SanitizedObservation; // schema-valid, gate-ready
  redactions: RedactionReason[]; // {rect, reason, source, score} — A draws these
  audit: AuditPrivacyFields; // C9
  timings: { rules: number; ner: number; ocr: number; vision: number; fuse: number; build: number };
  degraded: string[]; // e.g. ['ocr_timeout','vision_disabled']
}
```

**Hard rule: `sanitize()` never throws and never returns a _less_ redacted result on failure.** If a source dies, its regions become `unexplained` and get masked. Failure moves toward privacy, always (`PLAN.md` §17 P8 → Failure cases).
**A's obligation:** surface `degraded[]` in the trace UI. **Never retry a step by bypassing sanitization.** There is no unsanitized path after day 7.

### C5 — `SanitizedObservation` · B produces → A transmits

Defined in `packages/schema/observation.ts` (**owner: A**), shape driven by B's needs. Full field list: `PLAN.md` §12.7. `additionalProperties: false` at every level. Only fields on the §7.2 allowlist may exist.

### C6 — `egressGate()` · B's function → A's single call site

```ts
function egressGate(
  payload: unknown,
  registry: SecretRegistry,
  policy: Policy
): Result<SafePayload, Violation>;
```

`SafePayload` is a **branded type** producible only by the gate.

**A's `net.ts` signature is `send(p: SafePayload): Promise<Response>`.** This is the enforcement: not being able to call `send()` without a gate result is a _compile error_, not a code-review note. `net.ts` is the only `fetch` in the repo, enforced by ESLint `no-restricted-globals` plus a CI grep.
**`fail_mode: CLOSED`.** On violation the step aborts, a red banner names the failed check, an audit record is written. **Never strip-and-retry.**

### C7 — `resolveForBinding()` · B's function → A calls before executing `TYPE`

```ts
function resolveForBinding(
  handle: string,
  target: { element_id: string; sensitivity_class: PiiType | 'none'; accepts: PiiType[] }
): Result<Sensitive<string>, Violation>;
```

`Sensitive<string>` is branded; its `toString()` returns `"[redacted]"` so an accidental `console.log` is harmless.
**A's obligation:** pass it straight to the content script for typing. Never log it, never put it in the trace, never echo it into history, never send it. It goes vault → page and nowhere else.

### C8 — Validator rungs 7 & 8 · B's functions → inside A's ladder

```ts
function checkVaultTypeMatch(action: Action, obs: SanitizedObservation): Result<void, Violation>;
function scanLiteralAgainstRegistry(
  text: string,
  registry: SecretRegistry
): Result<void, Violation>;
```

A owns the 12-rung ladder (`PLAN.md` §14.2) and calls these two in position. A `VAULT_TYPE_MISMATCH` is logged as a **potential exfiltration attempt** — that is a demo beat, wire it to the UI.

### C9 — `AuditRecord` · split fields, A assembles

B fills `observation`, `detections`, `policy`, `egress`. A fills `session_id`, `step`, `ts`, `action`, `latency_ms`. A writes and exports. Shape: `PLAN.md` §11.8. **No field in this record is capable of holding a value.** Keep it that way in review.

### C10 — Bench-site instrumentation · B specifies → A applies

B publishes the attribute spec **by end of day 1**; A applies it while building ShopLite and GovPortal.

```html
<span data-glasswall-pii="EMAIL" data-glasswall-tier="2" data-glasswall-value-id="v_17"
  >rahul@example.com</span
>
```

**CI gate (B owns the check):** the extension bundle must contain zero references to `data-glasswall-`. If it does, every evaluation number is worthless.

### Contract change protocol

1. Changes land in a PR that touches **only** `packages/schema` (plus a fixture). Title prefix `contract:`.
2. **Additive-only after the freeze date.** New optional field: fine. Renamed or removed field: needs both people in the same conversation and a `schema_version` bump.
3. A reviews and merges `contract:` PRs **same day** — B is blocked while one is open, so these jump the queue.
4. Both run `pnpm gen:schema` after merge. CI fails if generated JSON is stale.

**Freeze dates — put them in the repo:**

| Type                                 | Frozen after     |
| ------------------------------------ | ---------------- |
| `RawElement` / `RawObservation` (C1) | **end of day 3** |
| `Action` / `ActionEnvelope`          | **end of day 5** |
| `SanitizedObservation` (C5)          | **end of day 6** |
| `Policy` config schema               | end of day 11    |

`PLAN.md` §19.2 flags this as hard blocking dependency #3: _"changes after that ripple into four packages."_ With two people it ripples into all of them.

> **END OF MIRRORED SECTION**

---

## 6. Your phases

Phase IDs match `PLAN.md` §17 — read the full detail there. Only your slice is restated, with the two-person scope from §3 applied.

### P0-B — Instrumentation spec & seeded generator · day 1 · **A is blocked on this**

The `data-glasswall-*` attribute spec (contract C10) and `generator.ts`, the seeded PII generator. A applies your attributes while building ShopLite and GovPortal on days 1–3, so the spec must land **end of day 1**. It does not need to be perfect; it needs to exist.
The generator is load-bearing well beyond day 1: it produces your **canaries**, your **detector ground truth**, and your **evaluation labels**. Seeded, so runs are reproducible. `PLAN.md` §10.1 warns that under-investing in the bench site is the most common way this project fails.
**Accept:** A can instrument a page from your spec without asking you a question. Same seed → identical PII across runs.

### P1-B — Inference spike ⚠️ **HIGHEST RISK IN THE PROJECT** · day 1–2

**Pair with A on this.** `PLAN.md` §17 P1 exists because MV3 imposes a hard constraint chain: service workers cannot create Web Workers → offscreen documents are the workaround → CSP may still force a sandboxed iframe. **If ONNX Runtime Web cannot run inside the offscreen document, the entire architecture changes.** Finding that out on day 10 ends the project.

Build: `packages/inference/{runtime.ts, capability.ts}` · EP selection · session cache · capability probe (`navigator.gpu`, WASM SIMD/threads, `crossOriginIsolated`, memory, cores) · a tiny ONNX model (MobileNet-v2 int8 or a 2-layer MLP) running end to end.
**Accept:** the model runs on **WebGPU and on WASM**, timings printed, outputs numerically equal within 1e-2. Capability probe snapshot from both machines, including the weaker one.
**Escalation:** if none of the fallbacks work by **end of day 2**, pivot to a `localhost` Node sidecar (`onnxruntime-node`) and say so in the deck. Do not spend day 3 hoping.
**Answer these while you are in there** (`PLAN.md` Appendix A): Q1 (ORT-Web multithreaded/WebGPU in offscreen?), Q6 (`crossOriginIsolated` achievable → WASM threads?).

### P6-a — Deterministic recognizers · days 1, 3 · **pure TS, start immediately**

Email · phone (E.164 + Indian formats) · **Aadhaar-shaped 12-digit with Verhoeff checksum** · PAN · IFSC · GSTIN · UPI VPA · credit card with Luhn · IPv4/6 · DOB patterns · high-entropy API-key shapes.
Plus **Tier-1 deterministic element rules**: `input[type=password]`, `autocomplete` tokens (`cc-number`, `cc-csc`, `one-time-code`, `street-address`, `postal-code`, `bday`), OTP heuristics.
**Tier 1 short-circuits everything** (`PLAN.md` §11.3): _"we must never be in a position where a probabilistic score decides whether a password is released."_ No ML output goes near that decision.
**Accept:** precision ≥0.98, recall ≥0.95 against bench-site ground truth.
**Tests:** table tests with positive, negative **and near-miss** cases for every type — a 12-digit number that fails Verhoeff, a card number that fails Luhn, a PAN-shaped string that is not a PAN. The near-misses are what stop you over-redacting product SKUs.
**Perf:** compile regexes once at module load, not per call. Sub-10ms over 50KB of text.

### P6-b — Tokenizer, vault, registry · day 4

`handle = "⟦" + type + "#" + idx + "⟧"` where `idx` is insertion order of `HMAC(session_salt, normalize(value))`. Per-session salt so handles are not a rainbow-table oracle; deterministic within a session so referential consistency holds; unlinkable across sessions.
`normalize()` = NFKC + lowercase + collapse whitespace + strip separators for numeric identifiers. **`PLAN.md` §11.5: normalization is the difference between a registry that works and one that misses `rahul @ x.com`.**
**Secret Registry** = every normalized secret seen this session, plus generated encoded forms (URL, base64, hex, HTML entities). Consumed only by the gate.
**Vault** lives in `chrome.storage.session` only. Never `storage.local`, never IndexedDB. Wiped on session end, tab close, browser close, or the user's Clear button.
**Type-matched resolution (C7)** — `@vault:EMAIL#1` binds only into an email-compatible element. Attempting to bind `AADHAAR` into a public search box is a validation failure logged as a **potential exfiltration attempt**. This is one of the more interesting security properties in the system; make sure it is visible in the UI.
**Tier 1 carries no index** — `⟦PASSWORD⟧`, not `⟦PASSWORD#1⟧`. Even cardinality leaks.
**Tests:** tokenizer determinism within a session; cross-session unlinkability; vault type-mismatch rejection.

### P3-B — Image pipeline & redaction · day 5

Decode `ImageBitmap` → `OffscreenCanvas` → downscale to 640px long side, keeping the scale factor `s` in both directions · **normalize DPR to CSS pixels immediately** · `redact(image, rects)` returning a branded `RedactedImage` · alignment debug view.
**`PLAN.md` §7.3, critical ordering rule:** redaction is applied to the pixel buffer _inside_ the offscreen document and the original bitmap is dropped before the redacted version is handed out. `offscreen/pipeline/image/redact.ts` is the **only** module that returns image bytes to the orchestrator, and its return type is `RedactedImage`.
**Accept:** alignment error ≤2px at `dpr=1` **and** `dpr=2`. Painted rects exactly cover their targets. Original bitmap unreachable after `redact()` returns.
**Why the DPR test is not optional:** a misaligned redaction box does not merely look wrong — it blacks out the wrong region and leaves the sensitive one visible. On a HiDPI demo laptop this is a silent, total failure.

### P6-c — Observation builder & `sanitize()` · day 6 · **A integrates it day 7**

`packages/perception/observation-builder.ts` — the allowlist projection producing `SanitizedObservation`, plus the `sanitize()` entry point (C4).
The builder is **the** structural guarantee (G1): the output type has no field capable of holding raw HTML, a `.value`, a cookie, or a raw OCR string. `PLAN.md` §7.2: _"Type systems are cheaper than vigilance."_
Emit the `handles[]` inventory (type + cardinality, never value) and `value_state` per element. Together those are what let an agent plan a form fill it cannot read — anticipatory shielding, obtained free from the DOM.
**Accept:** T1's observation contains zero real values; handles are referentially consistent (the same name in shipping and billing yields the same handle); Tier-1 values appear nowhere, not even as an indexed handle.

### P7 — Egress gate & canary harness ★ **THE PROJECT** ★ · day 8

This is `PLAN.md` differentiator **I3**, and §20.1 is explicit: _"Nothing else matters until this lands. Stop all other work."_

`egressGate()` as a **pure, synchronous function** with all seven checks (§11.6):

1. Schema conformance, `additionalProperties:false` — unknown key rejects
2. Type-brand check — every string must be `Sanitized<string>` from the tokenizer
3. Registry scan — normalized, plus URL/base64/hex/HTML-entity encodings, plus 8-gram overlap for partial leakage
4. Entropy heuristic — Shannon >3.5 bits/char and length >12 and not a known handle
5. Size budget
6. Rate limit
7. Destination pin — target origin must equal the configured gateway

Plus the **canary harness** (`eval/leakage/`): Playwright request interception, five-location synthetic secret injection, encoded-form scanning, and — critically — the **negative control**.

**The negative control is the most important test you will write.** Set policy to PERMISSIVE with detectors off, and assert the harness **reports leaks**. A test that cannot fail proves nothing, and a judge who watches you deliberately turn it red will believe the green run.

**Accept:** leakage rate **0.000** across all tasks × 5 seeds × STRICT and BALANCED · all five synthetic-secret locations blocked · negative control goes red · no request to any origin but the gateway · gate adds ≤15ms p95 · `verify:boundary` passes (manifest CSP correct, exactly one `fetch`, no `eval`, no `data-glasswall-` in the bundle).
**Perf:** build an Aho-Corasick automaton over the registry once per step, not N substring scans. Rebuild only when the registry changes.
**False-positive guard:** minimum secret length 6, token-boundary matching for short values — otherwise a legitimate word collides with a short secret and blocks a valid step.
**Code review on this phase is mandatory, not optional.** Ask A to read it line by line.

### P8 — Local NER · day 9 · _off-the-shelf, no training_

Transformers.js `token-classification` in the offscreen host · chunking with 64-token overlap · span merging across boundaries · confidence thresholding · span → DOM-node mapping.
**Accept:** F1 ≥0.85 on your held-out text set; recall ≥0.90 for `PERSON_NAME` and `STREET_ADDRESS`. ≤250ms p50 WebGPU / ≤700ms WASM for ≤2000 tokens. Model ≤30MB.
**Failure path — this is the pattern for every perception source:** if the model fails to load, **skip NER and mark all affected text blocks `unexplained` → they get redacted.** Fail closed, never open.
**Tests:** fixed-input regression (same text → same spans); **chunk-boundary test** (an entity straddling a boundary must still be found); EP parity WebGPU vs WASM.
**Security:** NER output is advisory input to fusion, never authoritative for Tier 1. It runs on already-extracted text blocks, never on values.
**Document in `MODEL_CARD.md`:** which model, its license, its training data, and its known gaps — Indian names especially. An honest gap is worth more than a hidden one.

### P9 — Local OCR · day 10 · _tesseract.js first_

**Targeted, never full-page.** Run only on regions the DOM cannot explain: `<canvas>`, `<img>` rects, `<svg>` with unreadable text, cross-origin iframe rects, video posters. **Budget: ≤6 crops per step, ≤512px longest side each. Enforce the budget in code, not by convention.**
`PLAN.md` §27 D6 makes this a headline claim: WebPII measured Tesseract at 453ms per _full image_; you sidestep that for the ~90% of steps with nothing unexplained. **Instrument how often OCR is skipped and report it** — `ocr_skipped_reason: "no_unexplained_crops"` is itself a result worth showing.
**Accept:** character accuracy ≥0.90 on bench-site canvas/image text · ≤500ms p50 for 3 crops (WebGPU) / ≤1200ms (WASM) · boxes map back to viewport coords within 3px · **timeout path leaves the region unexplained and masked, never unmasked**.
**Tests:** fixture images with known text → CER/WER; coordinate round-trip; timeout test asserting the safe fallback.
**Security:** raw OCR text stays local, feeds the recognizers and NER, and **is never released** — only its tokenized derivative reaches `text_blocks`.

### P11 — Fusion, explain-or-redact, policy engine ★ · day 11

`PLAN.md` differentiator **I1** and the intellectual centre of the system.

**Fusion** — spatial join in viewport coordinates via a uniform grid index, then noisy-OR:

```
S(region) = 1 − Π_i (1 − w_i · c_i)
```

Noisy-OR is chosen deliberately: it is **monotone** (adding evidence never decreases suspicion) and it **fails toward privacy** (one strong signal suffices). Ties break toward redaction. A compromised vision model can therefore only cause over-redaction, never a leak — **say that on stage, it is a genuinely good architectural property.**

**Explain-or-redact coverage** — union the rects of elements the extractor emitted with known-low sensitivity. Anything outside that union is `unexplained` and takes `S = policy.unexplained_prior` (0.8 STRICT / 0.4 BALANCED). This is the mechanism that converts _"we might have missed something"_ into _"we withheld what we could not account for."_

**Policy engine** — declarative JSON, three profiles (STRICT / BALANCED / PERMISSIVE), so the ablation harness flips them without a rebuild. Transformations: PASS · GENERALIZE · TOKENIZE · MASK · DROP · VAULT_ONLY.

**Accept:** **fusion beats every single source on PII recall** — this is _the_ ablation result · explain-or-redact drives leakage to 0 **even with the vision model deliberately disabled** · profile switching needs no rebuild · fusion ≤20ms for 400 elements + 100 regions · every redaction carries a human-readable reason in the audit record.
**Tests:** synthetic-evidence unit tests (one weak source; three weak sources); coverage test with a known-unexplained canvas region; policy snapshot test (same input, three profiles, three expected outputs); **monotonicity property test** (adding evidence never decreases `S`).
**Do not "fix" over-redaction under STRICT by weakening STRICT.** That is what the privacy–utility frontier is for. Ship BALANCED as the default operating point and show the curve.

### P12-B — Leakage evaluation & ablations · day 12

Ablation configs A1 (DOM-only), A6 (fusion), A7 (+explain-or-redact) · privacy and detection metrics · the privacy–utility frontier plot · `Inspector.tsx` (payload viewer side-by-side with the raw observation) · `Handles.tsx` (handle inventory, types and counts, never values).
**The inspector is load-bearing for the demo** (§28 cut #11 keeps it even when everything else is cut). A judge picks a secret; you show it is absent from the payload. Build it to be readable from three metres away.
**Accept:** ≥5 seeds per task with variance reported; report includes hardware and browser version.

### P13-B / P14-B — Perf & chaos · day 13

Yours: session warm-up at install (pre-create ORT sessions, dummy inference) · lazy model loading by policy (STRICT skips the screenshot path entirely → no vision, no OCR) · skip OCR when nothing is unexplained · quantization sweeps with **verified** accuracy deltas.
**Chaos, and this is the most important test in the suite:** for each perception source, force-fail it and assert the loop terminates cleanly, degrades correctly, **and leakage is still 0**. Every degraded path must remain fail-closed. Not just the happy path — _every_ configuration.
**Memory:** always `.close()` your `ImageBitmap`s. Retaining them across steps is a classic leak.

### P15-B — Docs & demo support · day 14–15

`SECURITY.md` (threat model A1–A8, failure matrix mapped to real code paths, prompt injection framed as **mitigation not prevention**) · `PRIVACY.md` (zero retention, stated plainly) · `MODEL_CARD.md` (every model: size, license, training data, metrics, known gaps) · `EVALUATION.md` (real numbers, variance, hardware).
**Write the non-guarantees N1–N5 prominently** (`PLAN.md` §4.4). Stating clearly what you cannot do is what makes the rest believable, and judges notice.

### P10 — Vision detector · **STRETCH, only if ahead by day 11**

Playwright datagen against your instrumented bench sites (pixel-accurate boxes for free, no annotation cost) → YOLOv8n or RT-DETR-nano at 640×640 → ONNX → INT8 → browser wrapper with letterbox / NMS / un-letterbox.
**Record the license decision in an ADR before you start** (`PLAN.md` Appendix A, Q3: Ultralytics is AGPL).
If you do not get to this: **say so, and explain why it does not matter.** Leakage stays 0 because explain-or-redact masks unexplained regions. That is a designed degradation, and presenting it as one is stronger than presenting a half-trained detector.

---

## 7. Your 15 days

| Day | Your critical path                                                                                           | Blocks / blocked by                   | Deliverable                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------ |
| 1   | **C10 attribute spec** (A is blocked) · `generator.ts` v0 · recognizers: email, phone, PAN                   | **You block A**                       | Spec published; 3 recognizers with table tests         |
| 2   | **Inference spike with A** ⚠️ · capability probe                                                             | Blocks all your browser ML            | **Go/no-go by EOD. Escalate if red**                   |
| 3   | Recognizers complete (Aadhaar+Verhoeff, IFSC, GSTIN, UPI, Luhn, IP, DOB, secrets) · registry + normalization | Pure TS, unblocked                    | Recognizer suite ≥0.98 precision                       |
| 4   | Tokenizer · vault · type-matched resolve · ClinicDesk site                                                   | Pure TS, unblocked                    | Handle minting deterministic + unlinkable              |
| 5   | P3-B image pipeline · downscale · DPR · `redact()` · alignment test                                          | Needs A's C2 frame                    | Alignment ≤2px at both DPRs                            |
| 6   | Observation builder · `sanitize()` entry point (C4)                                                          | **A integrates day 7**                | `SanitizedObservation` validates; zero real values     |
| 7   | Support A's integration · fix what integration exposes · C7 + C8 functions                                   | Joint day                             | **Form fills via vault refs, no values in payload** ⭐ |
| 8   | **P7 egress gate + canary harness + negative control** ⭐                                                    | **Everything stops until this lands** | **Leakage = 0; negative control goes red** ⭐          |
| 9   | P8 NER integrated, chunking, span mapping                                                                    | Needs spike                           | NER finds names in free-text bodies                    |
| 10  | P9 OCR, crop policy, coordinate round-trip                                                                   | Needs P3-B                            | ClinicDesk canvas PII detected                         |
| 11  | **P11 fusion + coverage + policy profiles** ⭐                                                               | Needs P8, P9                          | **Fusion beats every single source** ⭐                |
| 12  | Ablations A1/A6/A7 · privacy metrics · `Inspector.tsx` · `Handles.tsx`                                       | Needs A's harness                     | **Privacy–utility frontier chart exists**              |
| 13  | P13-B warmup/lazy-load · **chaos: leakage=0 in every degraded config**                                       | —                                     | Chaos suite green                                      |
| 14  | `SECURITY.md` · `PRIVACY.md` · `MODEL_CARD.md` · `EVALUATION.md` · rehearse your beats                       | —                                     | Docs complete; you can deliver the privacy demo solo   |
| 15  | **Buffer.** Rehearsal #2                                                                                     | —                                     | **Ship**                                               |

**Two dates that cannot move:** the inference spike resolves **day 2**; the egress gate lands **day 8**. Everything else has slack. These do not.

---

## 8. How you work: branches and PRs

You do not push to `main`. Ever. A reviews and merges.

**Branch naming:** `feat/b-{phase}-{slug}` — e.g. `feat/b-p6-vault`, `feat/b-p7-egress-gate`, `fix/b-verhoeff-edge-case`. Schema changes: `contract:` prefix. Training experiments: `exp/vision-training` — messy is fine, never merged directly.

**Branch lifetime ≤2 days.** Longer means the feature was too big and should have been split. `PLAN.md` §18.4: a feature is a change that is independently testable, leaves `main` buildable, has an acceptance criterion from the plan, and is describable in one sentence **without the word "and"**. _"Add Verhoeff checksum validation to the Aadhaar recognizer"_ is a feature. _"Add PII detection"_ is a phase.

**Push at least once daily**, even mid-feature. Offline work is invisible work and invisible work cannot be integrated.

### PR template — put this in `.github/pull_request_template.md`

```markdown
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
```

### What A will reject on sight

A `fetch` anywhere · `eval`/`Function`/`innerHTML` · edits to A-owned paths · schema changes bundled into a feature PR · reading `.value`/`cookie`/`localStorage` · a raw value in a log or trace · a vault value outside `storage.session` · anything that leaves `main` unbuildable.

None of these are personal. They are the guarantees the project is sold on — if any one of them slips, the headline claim is false.

**Commit format:** `type(scope): imperative summary`, ≤50 chars.

```
feat(privacy): mint session-salted handles for tier-2 PII
feat(privacy): reject vault binding on type mismatch
test(privacy): add encoded-form canary cases to egress gate
perf(inference): reuse ORT sessions across steps, cut cold start 2.1s
model(ner): integrate onnx ner-base int8, F1 0.87
```

Banned: `wip` · `update code` · `fixed stuff` · `final2`.

---

## 9. Risks in your lane

| Risk                                 | Signal                                               | Mitigation                                                                                                  | Fallback                                                             |
| ------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Inference spike fails (day 2)** ⚠️ | ORT-Web will not run in offscreen under MV3 CSP      | Sandboxed iframe inside the offscreen page; single-threaded WASM if no `crossOriginIsolated`                | `localhost` Node sidecar. **Decide day 2, not day 5**                |
| **Over-detection kills utility**     | Product SKUs tokenized as IDs; task completion drops | Near-miss test cases; negative lookarounds; context windows; measure redaction _precision_, not just recall | Ship BALANCED as default; present the frontier                       |
| **DPR misalignment**                 | Redaction boxes offset on HiDPI                      | Normalize to CSS px immediately; assert in a unit test at dpr=1 and dpr=2                                   | Blocks the demo until fixed — this is not cosmetic                   |
| **OCR blows the latency budget**     | Steps take seconds                                   | Crop budget enforced in code; skip when nothing is unexplained                                              | Disable OCR; regions get masked. **Utility drops, privacy does not** |
| **NER model won't load**             | Silent empty spans                                   | Text blocks → `unexplained` → redacted                                                                      | Deterministic recognizers still cover all Tier-1 and most Tier-2     |
| **Gate false positives**             | Legitimate steps blocked                             | Minimum secret length 6; token-boundary matching for short values                                           | Log and tune; never loosen `fail_mode`                               |
| **Vision training doesn't converge** | Day 13 with no usable weights                        | It is a stretch item — cut it                                                                               | Run ablations without A2/A5 and **say why on stage**                 |
| **You block A on day 1**             | Attribute spec not published                         | Publish something rough by EOD; iterate                                                                     | A cannot instrument the bench sites without it                       |
| **PR queue stalls you**              | Branch >2 days old waiting on review                 | Split into smaller PRs; `contract:` PRs jump the queue                                                      | Agree fixed review times with A                                      |

---

## 10. Definition of done for your lane

- [ ] Recognizer suite: precision ≥0.98, recall ≥0.95, with near-miss tests for every type
- [ ] Handles referentially consistent within a session, unlinkable across sessions — both asserted by test
- [ ] Tier-1 values never appear in an observation, **not even as an indexed handle**
- [ ] Vault type-mismatch rejected and logged as a potential exfiltration attempt
- [ ] `egressGate()` is pure, synchronous, fail-closed, with one passing test per check **and per encoding**
- [ ] **Leakage 0.000 across all tasks × 5 seeds × STRICT and BALANCED**
- [ ] **Negative control goes red** — the test can fail, and you have a recording of it failing
- [ ] Gate adds ≤15ms p95
- [ ] `verify:boundary` green in CI: manifest CSP correct, exactly one `fetch`, no `eval`, no `data-glasswall-` in the bundle
- [ ] `redact()` is the only module returning image bytes; the original bitmap is unreachable after it returns
- [ ] Alignment ≤2px at dpr=1 **and** dpr=2
- [ ] Fusion beats every single source on PII recall — chart committed to `eval/reports/`
- [ ] Explain-or-redact holds leakage at 0 **with vision disabled**
- [ ] Chaos suite: every perception source force-failed individually, **leakage still 0 in every configuration**
- [ ] `SECURITY.md`, `PRIVACY.md`, `MODEL_CARD.md`, `EVALUATION.md` complete, with N1–N5 non-guarantees stated plainly
- [ ] You can deliver the privacy half of the demo alone, including the deliberate failure

---

## 11. The three sentences you should be able to say from memory

From `PLAN.md` §11.6, the defense-in-depth summary. If you can say this cleanly on stage, the room understands the project:

> **Layer 1:** we never construct a payload containing sensitive data, because the builder is an allowlist projection.
> **Layer 2:** detectors tokenize whatever residual free text or pixels remain.
> **Layer 3:** the gate refuses to send anything that still matches a known secret, and the browser itself refuses to connect anywhere but our gateway.

And the honest counterpart, which earns more credibility than any claim: we do **not** guarantee perfect recall, non-inference from structure, immunity to malicious pages, or protection against a malicious reasoner. We mitigate. We measure. We publish the residual.
