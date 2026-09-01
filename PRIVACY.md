# PRIVACY

What GLASSWALL collects, what leaves your device, what is kept, and how to erase it.

Short version: **nothing is retained, and the only thing that leaves your device is a
payload built from a fixed schema that has no field capable of holding a value.** The
long version is below, with the file that implements each claim, and with the places
where the short version is not the whole truth.

---

## What leaves your device

One thing, to one place: a `SanitizedObservation`, to the reasoning gateway, from a
single function — `send()` in `apps/extension/src/background/net.ts`. That is the only
`fetch` in the repository and CI greps for a second one.

The payload is defined by `SanitizedObservationSchema`
(`packages/schema/src/observation.ts`) with `additionalProperties: false` at every
level. It carries:

- **Element structure** — tag, ARIA role, quantized rect, visible/enabled/focusable,
  `value_state` as `empty | partial | filled | n/a`, available actions.
- **Labels and text**, with every detected value replaced by a typed handle:
  `⟦EMAIL#1⟧`, `⟦PERSON_NAME#2⟧`. Tier-1 types get `⟦PASSWORD⟧` with **no index**, so
  not even how many of them there are is released.
- **Page shape** — a URL *template* (`/orders/:id`, never `/orders/48812`), an
  origin class, a page-type hint.
- **Viewport geometry** and a redacted screenshot, when the profile enables one.
- **Handles** — type, tier and count. Never a value.

It cannot carry raw HTML, a DOM serialization, an unredacted screenshot, raw OCR text,
cookies, `localStorage`, `sessionStorage`, IndexedDB, or the contents of a form field.
Not because those are filtered out, but because **the outbound type has no field they
would fit in**. The builder is an allowlist projection
(`packages/perception/src/observation-builder.ts`): it starts empty and copies in the
fields it is allowed to, rather than starting from the page and removing things.

---

## What never leaves your device

- **Values.** Every detected value goes into a session vault and is replaced by a
  handle. When the agent fills a form it emits `TYPE(target=e17, value=@vault:EMAIL#1)`,
  and the content script resolves the handle locally and types the real value into the
  page. **The value goes vault → page. It never transits the network or the model.**
- **Raw OCR text.** OCR reads regions the DOM cannot explain. What it recovers feeds
  the recognizers and the tokenizer and is never released; only the handle is.
- **Screenshots, unredacted.** Redaction happens in the offscreen document before any
  image bytes are returned; `redact()` is the only module that returns image bytes.
- **Passwords, OTPs, CVVs, card numbers, Aadhaar, PAN, API keys.** Tier 1 is vault-only
  under every policy. No policy setting can downgrade it, and no ML score is consulted
  — the decision is made by deterministic rules on `input[type=password]` and
  `autocomplete` tokens (`packages/privacy/src/recognizers/element-rules.ts`).

---

## What is retained

**Nothing.**

- **No server-side retention.** The gateway is zero-retention by design; it is a relay
  to the model provider and writes nothing to disk.
- **No local persistence of values.** The vault lives in `chrome.storage.session`
  (`packages/privacy/src/vault-store.ts`). Never `storage.local`, never IndexedDB —
  `scripts/verify-boundary.sh` check 6 greps for both and passes.
- **No history, no profile, no analytics, no telemetry.** There is no code that sends
  anything except the one `send()` call site, and it sends only the step payload.

The audit log is the one thing written, and it is **content-free by construction**
(`packages/privacy/src/audit.ts`): detector counts, policy decisions, timings, a
payload hash. There is no field in it that can hold a value, and
`assertNoValuesInAudit()` is run against it in tests.

---

## When it is erased

The vault and the secret registry live for exactly one session and are erased on:

- the task ending,
- the tab closing,
- the browser closing,
- **Clear** in the side panel.

`chrome.storage.session` is cleared by the browser itself when the browser closes, so
this is not only our promise — it is the platform's.

---

## What you control

| Setting | Effect |
|---|---|
| **STRICT** (default) | No screenshot at all. Anything the DOM cannot account for is dropped rather than tokenized (`unexplained_prior` 0.8). The OCR engine is never even loaded. Highest privacy, lowest utility. |
| **BALANCED** | Redacted screenshot on. Unaccounted regions are tokenized (`unexplained_prior` 0.4). Our measured best operating point — see the frontier chart in [`EVALUATION.md`](./EVALUATION.md). |
| **PERMISSIVE** | Ablation and demo only. Used on stage to make the canary harness go red on purpose. Not a setting anyone should run. |
| **Clear** | Wipes the vault and registry immediately. |
| **Confirmation** | Payment, deletion and off-origin navigation always ask, in every profile. |

The profiles are JSON (`config/policies/*.json`), not code. You can read exactly what
each one does without reading TypeScript, and switching profiles needs no rebuild.

---

## The inspector

You do not have to take any of this on faith while the extension is running. The side
panel has a payload inspector (`apps/extension/src/sidepanel/privacy/Inspector.tsx`)
showing the local observation and the outbound payload side by side, with a search box:
type any value and it tells you whether that value is present in what would be sent, in
**every encoding the egress gate protects against** — literal, URL, double-URL, base64,
base64url, hex, HTML numeric and named entities, and JSON escapes — and names each
encoding it checked.

The search is not a rubber stamp. Searching a value that genuinely *is* in the payload
— a product name, a page title — returns FOUND, and there is a test that asserts both
directions (`inspector.test.tsx`).

The handle panel next to it shows types and counts only. Never a value, not on hover,
not in a tooltip, not in a `title` attribute. That is asserted against the *serialized
DOM*, not against the props.

---

## Where this is not the whole truth

1. **We do not guarantee perfect detection.** Measured residual leakage on our
   benchmark is **2.0%**, all of it street addresses of a particular shape that our NER
   model misses entirely. It is published, plotted, and not rounded down. See
   [`SECURITY.md`](./SECURITY.md) N1 and [`EVALUATION.md`](./EVALUATION.md).
2. **Structure is still information.** A payload with no values still says you were on
   a checkout page with nine fields, three filled. We do not claim differential privacy.
3. **Another extension in your profile could read the vault.** `chrome.storage.session`
   is not readable by web pages, but it is readable by an extension with the right
   permissions. Our mitigation is lifetime, not access control.
4. **The gateway is `http://localhost:3000` today.** This is a hackathon build
   (SIH26171). There is no hosted service, no account, and no TLS, because there is
   nothing deployed to have them.
5. **The extractor reads `.value`** to decide whether a field is empty or filled
   (`content/extractor/walk.ts:580`). The string is discarded immediately and never
   emitted. It is on the list to remove, because a boundary you can prove by `grep` is
   worth more than one you have to read the code to believe.

---

## Contact

SIH26171. No data is collected, so there is nothing to request, export or delete beyond
pressing **Clear**.
