# PRIVACY

What GLASSWALL reads, what leaves your device, what is kept, and when it is erased.

Short version: the extension never reads what you typed, the only thing that leaves
the device is a step request built from a strict schema with no field able to hold a
value, and nothing is kept after a run ends.

## What leaves your device

One kind of request, to one place, from one function: a `StepRequest`
(`packages/schema/src/transport.ts`) to the gateway origin named in
`apps/extension/src/shared/config.ts`, sent by `send()` in
`apps/extension/src/background/net.ts`. That is the only `fetch` in the extension.

It carries:

- **Element structure**: tag, role, quantized rect, visible/enabled/focusable, a
  `value_state` (`empty | partial | filled | n/a`), available actions, and a sensitivity class
  (`EMAIL`, `PASSWORD`) so the planner knows what a field is for without seeing what
  is in it.
- **Labels and text** with every detected value replaced by a typed handle
  (`⟦EMAIL#1⟧`, `⟦PERSON_NAME#2⟧`). Tier-1 types (`⟦PASSWORD⟧`, `⟦CREDIT_CARD⟧`) carry
  no index, so not even their count is released. Placeholders that look like data are
  replaced by `[example email]`.
- **Page shape**: a URL template (`/orders/:id`, never `/orders/48812`), an origin
  class, a page-type hint, viewport geometry.
- **Handles**: type and tier only.
- **The last five actions** and the last executor result, with any blocked literal
  replaced by `[blocked]`.
- Under **BALANCED** only: a downscaled PNG of the visible tab with every detected or
  unexplained region blacked out on device before encoding.

The task you typed is sent as written when the session starts. The gate's recognizer
sweep refuses a task that contains an identifier (a card, Aadhaar or PAN number), but a
name or an address typed into the task box is sent; describe what you want done, not
the data.

## What never leaves your device

- **Values.** The extractor does not read `.value`, `innerHTML`, `outerHTML`, cookies,
  `localStorage`, `sessionStorage` or IndexedDB (`scripts/verify-boundary.sh` check 8).
  Values detected in page text go to a session vault and are replaced by handles. When
  the planner fills a field it emits `TYPE(e17, ⟦EMAIL#1⟧)`; the service worker resolves
  the handle locally and the content script types the value into the page. Vault → page,
  nowhere else.
- **Raw OCR text and raw NER output.** They feed the recognizers and the tokenizer in
  the offscreen document; only handles and rectangles come out.
- **Unredacted pixels.** Under STRICT no screenshot is taken. Under BALANCED the frame is
  held in the offscreen document, redacted there, and only the redacted PNG is handed
  to the gate.

## What is kept

- **Nothing on any server.** The gateway keeps sessions in memory for the run and
  writes nothing to disk. The model provider sees only what the gate released.
- **Nothing on disk locally.** The vault and registry are in memory and in
  `chrome.storage.session` (`packages/privacy/src/vault-store.ts`), never
  `storage.local` or IndexedDB (check 6).
- **An audit log** in `chrome.storage.session` and in the panel: per step, the action
  type, provider, latencies, element and handle counts, redaction rectangles and
  reasons, degraded sources, gate and validator verdicts, payload size. No field can
  hold a value (`assertNoValuesInAudit()` in `packages/privacy/src/audit.ts`). You can
  export it from the panel.

## When it is erased

- The vault is cleared when a run starts and again when it ends, however it ends
  (`orchestrator.ts`).
- `chrome.storage.session` is cleared by the browser when it closes.
- Starting a new run creates a new session id, a new registry and a new vault;
  handles from an earlier run mean nothing.

## What you control

| Control | Effect |
|---|---|
| **STRICT** (default) | No pixels captured, no OCR loaded; everything the DOM cannot explain is withheld (`unexplained_prior` 0.8). |
| **BALANCED** | Redacted screenshot sent; OCR reads canvas and image regions so their values become handles too (`unexplained_prior` 0.4). Needs a per-origin permission the panel asks for on Start. |
| **Abort** | Ends the run at the next check and clears the vault. |
| **Approve / Deny** | Payment, deletion and external navigation wait for you; no answer in 90 seconds counts as Deny. |

`PERMISSIVE` exists in `config/policies/` for ablations only; the panel does not offer it.

## The inspector

The **Privacy** tab shows the local observation and the outbound payload side by side,
lists every redaction with its reason, and has a search box: type any value and it
reports whether that value is present in the outbound payload in any of the nine
encodings the gate protects against (literal, URL, double-URL, base64, base64url, hex,
HTML numeric and named entities, JSON escapes). A product name that legitimately left
the device comes back *present*; the test suite asserts both directions.

The handles panel shows types and counts only, never a value, not in a tooltip.

## Where this is not the whole truth

1. Names and places in free prose depend on a statistical model; see `SECURITY.md` N1.
2. Structure is information: field counts and page type are released.
3. Another extension in the same profile with storage access could read the vault
   during a run.
4. The gateway is `http://localhost:3000` without TLS in this build.
5. What you type into the task box is sent as written.

## Contact

This project does not operate a hosted GlassWall service or collect telemetry. In a
deployment that adds hosted storage or analytics, those data flows would need to be
documented separately. For the local build, ending the run clears the session vault.
