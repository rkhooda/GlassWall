# CONTRACTS — The Ten Interface Contracts (C1–C10)

> **⚠️ CANONICAL COPY — MIRRORED IN BOTH PLAN FILES**
>
> This document is the single source of truth for the contract surface between Lane A (Agent & Control) and Lane B (Perception & Privacy). It is mirrored verbatim in `PLAN-A-AGENT-CONTROL.md` §4 and `PLAN-B-PERCEPTION-PRIVACY.md` §4.
>
> **Neither person edits this unilaterally.** All changes follow the Contract Change Protocol at the end of this document: a PR titled `contract:` touching _only_ `packages/schema` (plus a fixture), reviewed and merged by A same day.

---

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
