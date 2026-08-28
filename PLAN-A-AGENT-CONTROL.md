# PLAN-A — Agent & Control Lane

### SIH26171 · GLASSWALL · Owner: **A** (repo owner, integrator, reviewer)

> **Companion document:** `PLAN-B-PERCEPTION-PRIVACY.md`
> **Master document:** `PLAN.md` (architecture is authoritative there; this file only assigns and sequences)
> **Rule:** if this file and `PLAN.md` disagree on architecture, `PLAN.md` wins. If they disagree on _who does what_, this file wins.

---

## 0. Your scope in one line

> **You own the browser: how the page is read into a structure, how a structure becomes an action, and how that action lands back in the page — plus the loop that repeats it, the backend that answers it, and the repo everyone works in.**

You are the **brain's interface and the hands**. B is the **eyes and the filter**.

You are also, because you own the repo:

- **Integrator** — `main` is your responsibility. It must build and demo at every commit.
- **Reviewer** — every PR from B goes through you, against the checklist in §9.
- **Contract owner** — `packages/schema` is yours. Both lanes code against it.

---

## 1. Correction to the split before you start (read this, it matters)

Your original diagram was:

```
BROWSER → [B: perception + privacy] → sanitized context → [A: agent + control] → action
```

That is right about _responsibility_ but wrong about _sequence_, and if B believes the diagram he will start writing a DOM extractor and you will both build the same thing.

The real per-step sequence is:

```
 ┌─ A ───────────────────────────────────────────────────────────────┐
 │ 1. content script extracts RawObservation (DOM + a11y + geometry) │
 │ 2. service worker captures the viewport frame                      │
 └────────────────────────────┬──────────────────────────────────────┘
                              ▼  C1 RawObservation + C2 CapturedFrame
 ┌─ B ───────────────────────────────────────────────────────────────┐
 │ 3. OCR · vision · NER · recognizers → fusion → explain-or-redact   │
 │ 4. policy → tokenize → vault → build SanitizedObservation          │
 │ 5. egressGate() → SafePayload                                      │
 └────────────────────────────┬──────────────────────────────────────┘
                              ▼  C5 SanitizedObservation (as C6 SafePayload)
 ┌─ A ───────────────────────────────────────────────────────────────┐
 │ 6. net.ts sends → gateway → model → ActionEnvelope                │
 │ 7. validation ladder (B owns rungs 7 & 8 only)                    │
 │ 8. resolve @vault refs via B's function, execute in the page       │
 │ 9. verify effect → re-observe → back to 1                          │
 └───────────────────────────────────────────────────────────────────┘
```

**B never touches the DOM.** He receives a structure you produced and pixels you captured. Say this to him on day one.

### The privacy work you cannot delegate

This is the second correction, and it is the one that will bite you in review if you forget it. From `PLAN.md` §6.3:

> _"The extractor is the security boundary, not the redactor."_

Your extractor is **Layer 1 of the privacy architecture** — the allowlist projection. Guarantee **G1** (structural containment) comes from your code, not B's. Concretely, in `src/content/extractor/**` you must never read:

`.value` · `.innerHTML` · `.outerHTML` · `document.cookie` · `localStorage` · `sessionStorage` · `indexedDB` · any attribute outside the emit allowlist

You write a unit test that greps your own extractor sources for those tokens and fails if they appear (`PLAN.md` §17 P2 → Security). Privacy is not "B's phase". B builds layers 2–5; **you build layer 1 and you own the two enforcement points (`net.ts`, the validator ladder) where his layers are actually applied.**

---

## 2. Reality check — 5–6 person plan, 2 people

`PLAN.md` §5.3 assumes _"Team: 5–6 students, ~15 days."_ You are 2. That is a ~3× gap and pretending otherwise is how this ends with a broken `main` on day 14.

**Decide this on day 1 and write it in the README.** Recommended pre-emptive scope (this is the §20.3 fallback ladder applied _up front_ instead of in panic):

| Item                                                | Master plan                                   | Your call                                                   | Why                                                                                         |
| --------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Bench sites                                         | 4 (ShopLite, GovPortal, MailLite, ClinicDesk) | **2 + 1 stretch** — ShopLite, GovPortal, ClinicDesk if time | ClinicDesk earns its place only because it is B's canvas/OCR proof                          |
| Vision detector (P10)                               | full datagen + training                       | **Stretch only.** Cut by default                            | 3 days of B's time; explain-or-redact keeps leakage at 0 without it (`PLAN.md` §28, cut #6) |
| NER (P8)                                            | fine-tune DistilBERT                          | **Off-the-shelf ONNX NER**, no training                     | Training is 2.5 days B does not have                                                        |
| OCR (P9)                                            | PP-OCRv5 via raw ORT-Web                      | **tesseract.js first**, PP-OCRv5 as upgrade                 | Integration in hours instead of days                                                        |
| Ablations                                           | A1–A7                                         | **A1, A6, A7**                                              | §20.1 already sanctions this                                                                |
| Real-site suite                                     | 2–3 public pages                              | **Cut**                                                     | Pure risk, zero demo value                                                                  |
| Full-page stitch, per-site memory, signed audit log | stretch                                       | **Cut, do not discuss again**                               |                                                                                             |

**Never cut** (§20.3): egress gate, canary harness, deferred value binding, leakage-zero. Those four _are_ the project.

Put this table in `README.md` under "Scope". Judges reward a team that scoped honestly far more than one that shipped six broken things.

---

## 3. Directory ownership map

This is the anti-collision mechanism. **If a path is not yours, you do not commit to it — you open an issue.** Same rule binds B.

| Path                                                                 | Owner | Notes                                                                      |
| -------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| `packages/schema/**`                                                 | **A** | The contract. B proposes changes via the §7 protocol                       |
| `packages/perception/geometry.ts`                                    | **A** | Rect ops, IoU, quantization, coordinate transforms. B imports, never edits |
| `packages/perception/spatial-index.ts`                               | B     |                                                                            |
| `packages/perception/observation-builder.ts`                         | B     | The allowlist projection into `SanitizedObservation`                       |
| `packages/privacy/**`                                                | B     | Entirely his. You read it in review, you do not edit it                    |
| `packages/inference/**`                                              | B     | ORT-Web wrappers, EP selection, OCR/NER/vision pre+post                    |
| `apps/extension/manifest.json`                                       | **A** | Including the `connect-src` CSP pin. B requests changes in writing         |
| `apps/extension/src/shared/**`                                       | **A** | Typed message bus                                                          |
| `apps/extension/src/background/**`                                   | **A** | Orchestrator, step loop, capture, `net.ts`, validator, session             |
| `apps/extension/src/background/privacy/**`                           | B     | `vault-store.ts`, registry persistence in `storage.session`                |
| `apps/extension/src/content/**`                                      | **A** | Extractor, executor, overlay, stability watcher — **all of it**            |
| `apps/extension/src/offscreen/{offscreen.html,host.ts,sandbox.html}` | **A** | Document lifecycle + RPC transport only                                    |
| `apps/extension/src/offscreen/pipeline/**`                           | B     | `image/`, `ocr.ts`, `ner.ts`, `vision.ts` — every handler                  |
| `apps/extension/src/sidepanel/**`                                    | **A** | Shell, task input, `Trace.tsx`, `Confirm.tsx`, `ErrorState.tsx`            |
| `apps/extension/src/sidepanel/privacy/**`                            | B     | `Inspector.tsx`, `Handles.tsx`                                             |
| `apps/backend/**`                                                    | **A** | Gateway, prompt, providers, guard                                          |
| `apps/bench-site/src/sites/{shoplite,govportal}/**`                  | **A** | You need them by day 3 to test extraction                                  |
| `apps/bench-site/src/sites/{clinicdesk,maillite}/**`                 | B     | Canvas / image / free-text PII — his test surface                          |
| `apps/bench-site/src/{app,router,layout}`                            | **A** |                                                                            |
| `apps/bench-site/src/data/generator.ts`                              | B     | Seeded PII generator — drives canaries and labels                          |
| `apps/bench-site/src/instrument.ts`                                  | B     | `data-glasswall-*` helper. **Spec due day 1** (contract C10)               |
| `eval/harness/**`, `eval/tasks/**`                                   | **A** | Playwright driver, task YAML, success predicates                           |
| `eval/leakage/**`, `eval/ablations/**`                               | B     |                                                                            |
| `eval/metrics/{utility,performance}.ts`                              | **A** |                                                                            |
| `eval/metrics/{privacy,detection}.ts`                                | B     |                                                                            |
| `ml/**`                                                              | B     |                                                                            |
| `config/policies/*.json`                                             | B     |                                                                            |
| `scripts/{bootstrap,build-all,run-bench}.sh`                         | **A** |                                                                            |
| `scripts/verify-boundary.sh`                                         | B     |                                                                            |
| `README.md`, `ARCHITECTURE.md`, `DEMO.md`, `CHANGELOG.md`            | **A** |                                                                            |
| `SECURITY.md`, `PRIVACY.md`, `MODEL_CARD.md`, `EVALUATION.md`        | B     | You review for honesty, he writes                                          |

**One rule that removes 90% of merge pain:** no file has two owners. If you find yourselves both needing to edit one file, that file is in the wrong place — split it, do not coordinate around it.

---

## 4. THE CONTRACT SURFACE

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

## 5. The stub that de-risks integration

Write this on **day 1**, before anything else that matters:

```ts
// apps/extension/src/background/sanitize.stub.ts   ← A owns. Deleted on day 7.
export async function sanitize(input): Promise<SanitizeResult> {
  console.warn('UNSAFE MODE — sanitization not enabled');
  return {
    observation: identityProjection(input.raw),
    redactions: [],
    audit: EMPTY_AUDIT,
    timings: ZERO,
    degraded: ['stub'],
  };
}
```

Import it behind a single flag. Day 7 you flip the flag to B's real `sanitize()` and delete the stub. This is why you are never blocked on B and he is never blocked on you.

**Guard it** (`PLAN.md` §17 P5 → Security): while the stub is live, a red banner in the side panel and a startup console warning reading `UNSAFE MODE — sanitization not yet enabled`. **Do not demo this build. Do not record video of it.**

---

## 6. Your phases

Phase IDs match `PLAN.md` §17 so you can read the full detail there. Only your slice is restated.

### P0 — Foundation · half a day, do not gold-plate

pnpm workspace + turbo · TS strict · ESLint with `no-restricted-globals: fetch` outside `net.ts` · Prettier · Vitest · Playwright · GitHub Actions (typecheck → lint → unit → build) · `packages/schema` with Zod → JSON Schema emit · branch protection on `main` · `docs/CONTRACTS.md` from §4 · `.nvmrc`.
**Accept:** `pnpm i && pnpm build && pnpm test` green from a clean clone **on both machines**. Schema regeneration idempotent.
**Tag:** `v0.0.1-foundation`

### P1-A — Extension skeleton · day 1–2

`manifest.json` (MV3; `activeTab`, `scripting`, `storage`, `sidePanel`, `offscreen`; `host_permissions` limited to gateway + `http://localhost:5173/*`; **`content_security_policy.extension_pages` with `connect-src 'self' <gateway>`**) · typed message bus · content script ping · side panel React shell · offscreen document bootstrap + RPC transport.
**You do not implement inference.** You provide the room; B furnishes it. **Pair with B on the spike** — `PLAN.md` §19.3 names this one of the two items worth two sets of eyes, and if it fails on day 2 the architecture changes.
**Accept:** loads unpacked, zero console errors, SW ↔ content ↔ offscreen ↔ sidepanel round-trip works.
**Tag:** `v0.1.0-extension-skeleton`

### P2 — DOM extraction · day 3–4 · **your highest-value phase**

`TreeWalker` with open-shadow-root recursion · same-origin iframes (`all_frames:true`, frame-prefixed IDs, coordinate translation) · accessible-name computation (vendor `dom-accessibility-api`, do not write it yourself) · visibility + occlusion via `elementFromPoint` at centre + 4 inset corners · `identity_hash` · `value_state` · `group_path` · `WAIT_STABLE` (MutationObserver + IntersectionObserver + fetch/XHR patch) · numbered debug overlay · `packages/perception/geometry.ts`.
**Accept:** ≥95% of interactive elements on both bench sites · rects within 2px of DevTools · occluded elements `visible:false` with a modal open · shadow DOM + same-origin iframe elements present · p50 ≤120ms on a 500-element page · overlay boxes align.
**Test that matters:** grep your own extractor sources for `.value`, `.innerHTML`, `document.cookie`, `localStorage` — assert absent. Crude, effective, stays true as code evolves.
**Perf trap:** batch every `getBoundingClientRect()` before any DOM write. Layout thrash will otherwise dominate your budget.
**Freeze `RawElement` at the end of day 3.**
**Tag:** `v0.2.0-dom-extraction`

### P3-A — Capture · day 4

`chrome.tabs.captureVisibleTab` in the SW · transfer `ImageBitmap` to offscreen as a transferable · throttle handling (reuse last frame, set `stale:true`) · `chrome://` refusal with a clear message · degrade to DOM-only when capture is unavailable and **keep the loop running**.
Everything after the transfer is B's (`PLAN-B` P3-B).
**Accept:** frame reaches B's pipeline with correct `dpr`; throttle path exercised; DOM-only fallback verified.

### P4 — Action protocol, validator, executor · day 5

`Action` + `ActionEnvelope` Zod schemas · the 12-rung ladder, rungs 1–6 and 9–12 now (7–8 stubbed until day 8) · executor with correct event ordering · effect verification · `ActionResult` error taxonomy · `Confirm.tsx` for high-risk actions.

Event ordering (`PLAN.md` §14.4) — get this exactly right the first time:

```
CLICK: pointerdown → mousedown → focus → pointerup → mouseup → click
TYPE : focus → (select-all + Delete if clear_first) → per-char keydown/keypress/input/keyup → change → blur
```

**Use the native value setter** — `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set` — or React/Vue controlled components silently ignore every `TYPE`. This is the single most common failure in DOM agents. Write it as a named regression test on day 5 and never remove it.
**Accept:** every action type works on both bench sites · React controlled input updates state · stale `observation_id` rejected · `id_hash` mismatch rejected · invisible/disabled targets rejected · high-risk prompts for confirmation · effect verification distinguishes success from no-op.
**Test:** a rejection-matrix test, one case per validator failure code.
**Security CI:** grep the executor sources for `eval`, `Function`, `innerHTML`, `insertAdjacentHTML` — assert absent. Model output must have no path to any of them.
**Freeze `Action`/`ActionEnvelope` end of day 5.**
**Tag:** `v0.4.0-action-protocol`

### P5 — Closed loop ★ MVP ★ · day 6–7

Orchestrator step loop with step/time budgets, abort, and `consecutive_failures ≥ 3` termination · Fastify gateway (`/v1/session`, `/v1/step`, `/v1/health`) · provider abstraction with **`scripted` first** (finite-state, no network) then one real provider · prompt assembly wrapping all page-derived strings in `<untrusted_page_content>` · structured output constrained to the action schema · one repair retry then `AGENT_ERROR` · `Trace.tsx` · loop/oscillation detector · locally-computed `progress` object · SW-restart state persistence to `storage.session` after every step.
**Accept:** **T1 completes end-to-end with the scripted planner and zero network.** T1 and T3 complete with a real model. Abort works mid-step. Budget exhaustion terminates cleanly. Loop detector fires on a deliberately-looping fixture.
**DoD:** screen recording of T1 completing. **This recording is your demo-day insurance policy** — record it the day it works, not later.
**Tag:** `v0.5.0-mvp-closed-loop` ⭐

### P5.5 — Wiring B's lane in · day 7–8

Swap the stub for B's `sanitize()` · refactor `net.ts` so `send()` accepts only `SafePayload` · wire rungs 7–8 to B's functions · vault resolution in the `TYPE` path via C7 · surface `degraded[]` and `redactions[]` in the trace · delete `sanitize.stub.ts` and the UNSAFE banner.
**Accept:** T1 completes with every form field filled via `@vault:` refs and **no page value in any request body.** Type-mismatched binding rejected and visibly logged.
This is the moment the project stops being a browser agent. Treat the day it lands as a milestone, not a chore.

### P12-A — Utility & performance evaluation · day 12

`eval/harness/` Playwright driver loading the unpacked extension in a persistent context · task runner reading YAML · success predicates · utility + performance + resource metrics via CDP · 3 retries per seed with flake rate reported as a metric, not hidden.
**Headless note:** use headed or `--headless=new`. Classic headless does not load extensions reliably. This will cost you an afternoon if you learn it on day 12.

### P13-A / P14-A — Performance & hardening · day 13

Yours: incremental extraction (MutationObserver-driven subtree diff) · observation caching keyed by origin **and** DOM revision · message-bus payload minimization · recovery ladder · circuit breakers · SW-restart recovery · error taxonomy with actionable copy.
**Cache rule:** never cache a sanitized payload across pages. Key must include origin + DOM revision. A stale-cache leak is a real leak.

### P15-A — Demo · day 14–15

Demo script with exact click paths and timings · reset-demo button restoring known state · **backup video of every beat** · `README.md` a cold clone can follow · `ARCHITECTURE.md` · `DEMO.md`.
**Two full dress rehearsals on the actual demo machine, with a stopwatch.** §20.1 says cut a beat rather than skip a rehearsal. Believe it.
**Tag:** `v1.0.0` 🎉

---

## 7. Your 15 days

| Day | Your critical path                                                                                    | Depends on B              | Deliverable                                              | Tag                  |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- | -------------------- |
| 1   | P0 · schema v1 (C1, Action) · extension loads · `sanitize.stub` · ShopLite skeleton                   | C10 attribute spec by EOD | Repo builds, CI green, extension loads                   | `v0.0.1`             |
| 2   | P1-A bus + offscreen shell · **pair on the inference spike** ⚠️ · GovPortal skeleton                  | Spike go/no-go            | **Go/no-go on browser inference. Escalate today if red** | `v0.1.0`             |
| 3   | P2 extraction · overlay · **freeze `RawElement`**                                                     | —                         | Overlay boxes correct on both sites                      | `v0.2.0`             |
| 4   | P2 finish (shadow, iframes, WAIT_STABLE) · P3-A capture · `geometry.ts`                               | B consumes your frame     | Frame lands in offscreen; alignment testable             | `v0.3.0`             |
| 5   | P4 schema + ladder + executor · **freeze `Action`**                                                   | —                         | First CLICK and TYPE execute; rejection matrix green     | `v0.4.0`             |
| 6   | P5 loop + gateway + scripted planner                                                                  | —                         | **T1 completes end-to-end. RECORD IT**                   | —                    |
| 7   | P5 real provider + prompts + trace · **swap in B's `sanitize()`** · **freeze `SanitizedObservation`** | C4 ready                  | T1 with a real model; sanitized observation flowing      | `v0.5.0` ⭐          |
| 8   | `net.ts` → `SafePayload` · rungs 7–8 · vault binding in executor                                      | C6, C7, C8 ready          | **Form fills via vault refs; zero values in payload**    | `v0.6.0` `v0.7.0` ⭐ |
| 9   | Task YAMLs T1–T3 · harness skeleton · confirmation dialog · loop detector                             | —                         | 3 tasks runnable end-to-end                              | `v0.8.0`             |
| 10  | Executor hardening · recovery ladder · SW-restart persistence                                         | —                         | Loop survives SW kill mid-task                           | —                    |
| 11  | `available_actions` derivation · `progress` object · consume `redactions[]` in overlay                | C4 stable                 | Agent's action space visibly narrowed                    | `v0.11.0` ⭐         |
| 12  | P12-A utility + perf metrics · flake handling                                                         | B's ablation configs      | Full task suite runs unattended                          | `v0.12.0`            |
| 13  | P13-A perf · P14-A chaos on your subsystems                                                           | Chaos leakage assertions  | NFRs met; loop degrades cleanly                          | `v0.13/14.0`         |
| 14  | P15-A demo polish · **dress rehearsal #1** · backup video                                             | B rehearses his beats     | Demo in ≤7 min, twice                                    | —                    |
| 15  | **Buffer.** Rehearsal #2. Fix only what rehearsal exposed                                             | —                         | **Ship**                                                 | `v1.0.0` 🎉          |

**Milestones that must not slip** (§20.1): inference spike **day 2** · closed loop **day 5–6** · vault binding **day 7–8** · egress gate + zero leakage **day 8**. If the gate has not landed by day 8, _stop everything else_ until it has.

---

## 8. Git workflow you enforce

```
main                          ← protected, always buildable, always demoable
 ├── feat/a-p2-dom-extraction  ← yours, ≤2 days alive, squash-merged
 └── feat/b-p6-vault           ← his, PR only, you review
```

**Branch naming:** `feat/{a|b}-{phase}-{slug}` · `fix/…` · `contract:` for schema PRs · `exp/…` for B's training experiments (never merged directly).

**Branch protection on `main`:** CI must pass · **`bench:leakage` and `verify:boundary` are required checks** from day 8 onward · no force-push, ever.

**Commit format:** `type(scope): imperative summary`, ≤50 chars. Types `feat fix perf refactor test docs chore build ci sec data model`. Scopes `extension content background offscreen sidepanel privacy perception inference ocr vision ner agent backend schema eval bench-site ml docs`. Banned: `wip`, `update code`, `fixed stuff`, `final2`.

**Daily rituals — non-negotiable with two people:**

- 15-minute standup: yesterday / today / blockers. Every blocker leaves the meeting with an owner and a deadline.
- Both push at least once daily. Offline work is invisible work and invisible work cannot be integrated.
- Evening integration checkpoint: everything merges, `main` runs the smoke demo.
- If a feature is not ready by end of day, **flag it off** rather than leaving `main` broken.

**Feature flags:** vision, OCR and NER each have an on/off switch in policy config. Turning one off must never require a code change. One mechanism, two purposes — it is also exactly what the ablation harness needs.

---

## 9. Your PR review checklist for B

Run this on every PR. It is short on purpose so you actually run it. **Reject fast and specifically** — a 5-minute rejection is kinder than a 2-hour merge you regret.

**Blocking — reject immediately:**

- [ ] Touches any A-owned path (§3)? → reject, ask him to split it out
- [ ] Adds a `fetch`, `XMLHttpRequest`, `sendBeacon`, or `WebSocket` anywhere? → **reject, no discussion.** Only `net.ts` sends
- [ ] Adds `eval`, `Function`, `innerHTML`, `insertAdjacentHTML`? → reject
- [ ] Modifies `packages/schema` in a non-`contract:` PR? → reject, split
- [ ] Reads `.value`, `document.cookie`, `localStorage`, or `indexedDB`? → reject
- [ ] Logs, traces, or returns a raw value anywhere outside the vault? → reject
- [ ] Persists a vault value outside `chrome.storage.session`? → reject
- [ ] `main` would stop building or demoing? → reject

**Required to merge:**

- [ ] `pnpm build && pnpm test` green in CI
- [ ] `verify:boundary` green (day 8 onward)
- [ ] `bench:leakage` green (day 8 onward)
- [ ] Includes the specific tests named in that phase's acceptance criteria in `PLAN-B` — not "some tests"
- [ ] Conventional commit title, one sentence, no "and"
- [ ] Branch ≤2 days old. Older means it should have been split

**Judgement, not blocking:**

- [ ] Does a failure in this code fail _toward_ privacy? (`sanitize()` degrading to more redaction, not less)
- [ ] Would you be able to explain this module to a judge in 30 seconds?

**On rejection, always say which line and which rule.** "Rejected: `ocr.ts:88` calls `fetch` to pull the model — model bytes ship in the bundle or load via `chrome.runtime.getURL`. See contract C6." That is reviewable. "Looks off" is not.

---

## 10. Risks in your lane

| Risk                                              | Signal                                          | Mitigation                                                        | Fallback                                                                                                                   |
| ------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Inference spike fails on day 2**                | ORT-Web will not run in offscreen under MV3 CSP | Pair with B; try the sandboxed-iframe variant same day            | `localhost` Node sidecar (`onnxruntime-node`); announce the tradeoff in the deck, do not hide it (§17 P1)                  |
| **Synthetic events rejected** (`isTrusted:false`) | TYPE succeeds but the site ignores it           | Native value setter; verify effect every action                   | Documented limitation. **Do not reach for `chrome.debugger`** — the permission prompt and debug banner will wreck the demo |
| **Element identity churn**                        | Agent clicks the wrong row after a re-render    | `id_hash` recomputed at execution time, reject on mismatch        | `IDENTITY_MISMATCH` → re-observe                                                                                           |
| **MV3 service worker killed mid-task**            | Loop dies silently between steps                | Persist step state to `storage.session` after _every_ step        | Session recovery on SW restart                                                                                             |
| **Contract drift with B**                         | Merge conflicts in `packages/schema`            | Freeze dates + `contract:` PR protocol                            | `schema_version` bump; both regenerate                                                                                     |
| **You become the bottleneck as reviewer**         | B's PRs queue >12h                              | Review twice daily at fixed times; `contract:` PRs jump the queue | Give B write access to a `staging` branch, batch-merge to `main` daily                                                     |
| **`main` breaks near demo day**                   | Smoke demo fails at the evening checkpoint      | Feature flags; tagged releases as recovery points                 | `git checkout v0.7.0` must always produce a working demo                                                                   |
| **Two-person scope creep**                        | "we could also…" after day 10                   | §2 scope table is a written decision, not a suggestion            | Days 13–15 hold ~2.5 days of buffer _by design_. Do not fill them                                                          |

---

## 11. If you fall behind

Apply in this order (§20.3). Every one of these is a decision you can defend on stage.

1. Drop the vision detector — explain-or-redact keeps **leakage at 0**; utility drops on canvas tasks. Present it as designed degradation, not failure.
2. Drop OCR — unexplained regions get masked. Same argument, larger masked area. Say so out loud.
3. Drop NER — deterministic recognizers still cover all Tier-1 and most Tier-2.
4. Drop ClinicDesk and MailLite — demo on ShopLite + GovPortal.
5. Drop the real LLM, scripted planner only — **acceptable only if labelled honestly**, and show the `v0.5.0` recording as evidence it worked.
6. Drop ablations to A1, A6, A7 — three points still make a frontier.

**Never drop:** egress gate · canary harness · deferred value binding · leakage-zero. From §28: _"a working closed-loop browser agent that provably transmits no sensitive values, with a test that can fail"_ is still the strongest version of this problem statement most teams will show.

---

## 12. Definition of done for your lane

- [ ] `main` builds and passes the smoke demo at every commit for the last 5 days
- [ ] T1 completes end-to-end, scripted **and** with a real model, both recorded
- [ ] Every form field fills via `@vault:` references; no value appears in any payload
- [ ] `send()` is uncallable without a `SafePayload` — verified by deleting the gate call and confirming a compile error
- [ ] Exactly one `fetch` in the repo; `verify:boundary` green in CI
- [ ] Rejection matrix green: one passing test per validator failure code
- [ ] Extractor contains no `.value` / `.innerHTML` / cookie / storage access, asserted by test
- [ ] Executor contains no `eval` / `Function` / `innerHTML`, asserted by CI grep
- [ ] Loop survives: SW restart · network loss · capture unavailable · every B subsystem disabled individually
- [ ] Demo runs in ≤7 minutes with zero network, twice, on the real machine
- [ ] Backup video covers every beat
- [ ] `README.md` gets a cold clone running, including the honest scope statement from §2
