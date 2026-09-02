# DEMO-B — the privacy half, delivered alone

Two beats, 2:40 total, and I can run both without A on stage.

Each beat has **Path A (live browser)** and **Path B (terminal)**. Path A is the better
demo and depends on things that are not true yet — they are listed, with the request
that unblocks each. **Path B runs today, on this commit, from a clean clone.** Rehearse
Path B. Switch to Path A only if the preconditions are green on the morning.

Nothing in either path is staged output. Every number that appears on screen is
computed live from the code in the repository.

---

## Before we walk on

```bash
pnpm install
bash ml/fetch-models.sh          # ~150MB, once per clone. Do this the night before.
pnpm test                        # 449 green across the workspace
cd eval && npx vitest run        # 33 more. eval is not a workspace member yet, so
                                 # turbo does not reach it. 482 total. If red, do not demo.
```

Terminal at **18pt or larger**, two tabs open and `cd`'d:

| tab | directory | pre-typed command |
|---|---|---|
| 1 | `apps/extension` | `npx vitest run src/sidepanel/privacy/inspector.test.tsx` |
| 2 | `eval` | `npx tsx leakage/chaos.ts` |

Both commands finish in **under 1.5 seconds**. Neither touches the network.

### Path A preconditions

| needed | state | unblocked by |
|---|---|---|
| `manifest.json` declares a content script and a side panel | ❌ missing | `docs/REQUESTS-TO-A.md`, entry of 2026-09-01 |
| `<Inspector />` mounted in `App.tsx` | ❌ not mounted | same file, the two-line import + JSX entry |
| `orchestrator.ts` posts `extension:privacy-inspect` per step | ❌ not sent | same |
| `orchestrator.ts` passes `perceptionSources` and a real `frame` | ❌ omitted | same |
| `connect-src` pinned to the gateway | ❌ `'self'` | same |

Five things, all A's, all logged. If any is red on the morning, run Path B and say so
in one sentence — *"the inspector is built and tested; it is not mounted yet, so I am
showing you the same assertion from the test suite"* — and move on. Do not apologise
twice.

---

## Beat 1 — deferred value binding · 0:00 → 1:20

**The claim.** The form gets filled correctly, and the network log contains none of the
patient's identifiers. The value goes vault → page. It never transits the network or
the model.

*A note on the canary.* `PLAN.md` §4.5 phrases this beat around an email address.
ClinicDesk does not render one — the identifiers it shows are a phone number and an
Aadhaar — and MailLite, which would have had emails, was never built. So the canary is
the **Aadhaar**, which is a strictly better demo: it is Tier 1, so it is vault-only
under every profile and its handle carries no index at all. The property being shown is
identical; only the value type differs. Do not say "email" on stage out of habit.

### Path A — live browser · 80s

| t | action | what to say |
|---|---|---|
| 0:00 | ClinicDesk patient detail is open. DevTools **Network** tab open and filtered to `localhost:3000`. Side panel open on **BALANCED**. | *"Left is the page. Right is everything the model will ever see."* |
| 0:10 | Type `Fill the insurance claim form for this patient` and press **Start Task**. | *"That form is in a cross-origin iframe, which is the hard case."* |
| 0:20 | Point at the **OUTBOUND** pane as it populates. | *"Every value is a handle. The Aadhaar is `⟦AADHAAR⟧` — Tier 1, so it does not even get an index. The model cannot tell whether there is one of them or nine."* |
| 0:35 | The claim form fills. The Aadhaar lands in its field, correctly. | *"It filled. Correctly. The content script resolved the handle locally and typed it."* |
| 0:45 | Click the one request in the Network tab → **Payload**. Ctrl-F the Aadhaar. **0 results.** | *"That is the entire request. The number is not in it, and it never was."* |
| 0:55 | **Hand the laptop to a judge.** Point at the inspector's search box. | *"Type any value you can see on that page."* |
| 1:05 | They type it. **NOT PRESENT**, and the list of nine encodings it checked. | *"Nine encodings, because a base64'd secret is still a secret."* |
| 1:12 | Scroll to **Near-Miss Decoys**, copy the **PAN-shaped SKU**, search it. **FOUND.** | *"That one looks exactly like a PAN and fails its checksum, so we deliberately did not redact it — and the search says so. It answers yes when the answer is yes."* |

That last ten seconds is the most important part of the beat, and the decoy is why. It
proves the search is not a green light that is always on **and** that we do not redact
every product code in sight — both in one keystroke.

### Path B — terminal · 80s

Tab 1, run the pre-typed command.

| t | action | what to say |
|---|---|---|
| 0:00 | Run `npx vitest run src/sidepanel/privacy/inspector.test.tsx`. 7 tests, ~26 ms. | *"This is the demo, as a test. It runs the real `sanitize()`."* |
| 0:15 | `open apps/extension/src/sidepanel/privacy/inspector.test.tsx`, scroll to `buildRaw()`. | *"A card number and an email go onto the page. `Aeron Chair` goes on too — that one is public."* |
| 0:35 | Scroll to *reports NOT PRESENT for a canary that was on the page*. | *"Run a step. Search the canary in the payload that would go on the wire. Not present, in every encoding."* |
| 0:50 | Scroll to *reports FOUND for a value that legitimately is in the payload*. | *"And the product name comes back FOUND. Both directions, or the search proves nothing."* |
| 1:05 | Scroll to *Handles renders no value, in any encoding*. | *"The handle panel is asserted against the serialized DOM. Not the props — the DOM. No value, no tooltip, no `title` attribute for one to hide in."* |
| 1:15 | `npx vitest run src/resolve` in `packages/privacy`. | *"And this is the binding itself: an Aadhaar handle aimed at a search box is refused, `VAULT_TYPE_MISMATCH`, without the value appearing in the error."* |

---

## Beat 2 — the negative control · 1:20 → 2:40

**The claim.** The canary harness can go red. I will make it go red, now, on purpose.

**Read this before rehearsing.** The obvious version of this beat — *"I switch the
policy to PERMISSIVE and the email leaks"* — **does not work, and should not.** The
deterministic recognizers in `sanitize()` tokenize a checksum-verified value
unconditionally; no policy setting reaches that code path. I tried all three profiles
plus a hand-built profile with every source weight at 0 and Tier 2/3/5 set to `PASS`:
leakage stayed at 1 in every one of them.

That is a deviation from `PLAN.md` §11.4, which describes PERMISSIVE as passing Tier 3.
It is a deviation in the safe direction and it is recorded in `SECURITY.md`. **Say this
on stage — it is a better line than the one it replaces:** *"I could not weaken it with
a config flag. No policy setting can release a value that passed a checksum. So I broke
it properly instead."*

### What actually goes red

A perception source that loads, runs, and silently returns nothing. Not a crash — a
crash is **detected**, and a detected failure makes the system redact *more*. A silent
one is indistinguishable from a clean page, and it is the one real fail-open path in
the system. Measured, not staged: `eval/reports/chaos.md`.

| t | action | what to say |
|---|---|---|
| 1:20 | Tab 2: `npx tsx leakage/chaos.ts`. 1.5 s. The table fills the screen. | *"Every perception source, force-failed, alone and in every combination, three ways. 22 configurations."* |
| 1:35 | Point at the `healthy` row: **12 redactions, 1 leaked**. | *"Healthy. One leak — a street address our NER model cannot see. That number is in the report and on the chart. We publish the residual."* |
| 1:50 | Point at `ner throw` and `ner timeout`: **12 redactions, 0 leaked**. | *"Now I kill NER. Leakage goes **down**. Losing the detector means nothing accounts for that text, so it gets withheld wholesale — and it catches the address the working model missed."* |
| 2:05 | Point at `ner+ocr+vision throw`: **0 leaked**. | *"Every source dead is the safest configuration in the table. That is what fail-closed means, and it is measured, not asserted."* |
| 2:15 | **Now the red.** Point at `ner silent`: **11 redactions, 2 leaked — `PERSON_NAME`, `STREET_ADDRESS`.** | *"And here is the one that beats us. A model that loads, runs, and returns nothing. We cannot tell that from a clean page. Redaction drops, and a name ships."* |
| 2:30 | Point at the summary line: `silent failures that leaked more than healthy: 4/7`. | *"Four of seven. It is in `SECURITY.md` as non-guarantee N1, with that number next to it. It is why we fuse several independent sources instead of trusting one — and it is why this test exists rather than a screenshot of a green tick."* |

### If a judge asks "did you find that, or write the test around it?"

The honest answer, and it is the strongest thing in the demo:

> *"We found it. The suite was written against the code as it stood and failed
> immediately, on two separate fail-open paths. A source that threw contributed nothing
> at all — no evidence and no unexplained regions — so losing NER **raised** leakage
> from 1 to 2. And a fused region was redacting the pixels of a text node while its text
> shipped verbatim. Both are fixed, both fixes are in this table, and both are in
> commit `cdd1c80` — `git show cdd1c80` if you want to read them."*

---

## Timing

| beat | budget | measured |
|---|---|---|
| 1 — deferred binding | 80 s | Path B commands: 1.24 s of compute, the rest is talking |
| 2 — negative control | 80 s | Path B command: 1.49 s of compute |
| **total** | **2:40** | under the 3:00 cap with 20 s of slack |

The slack is deliberate. It is for the judge in beat 1 typing their own value, which is
the moment the whole demo exists for and must not be rushed.

---

## Three sentences, if I am cut to thirty seconds

> Layer 1: we never construct a payload containing sensitive data, because the builder
> is an allowlist projection.
> Layer 2: detectors tokenize whatever residual free text or pixels remain.
> Layer 3: the gate refuses to send anything that still matches a known secret, and the
> browser itself refuses to connect anywhere but our gateway.

And the counterpart, which is what makes the first three believable:

> We do not guarantee perfect recall, non-inference from structure, immunity to
> malicious pages, or protection against a malicious reasoner. We mitigate. We measure.
> We publish the residual — it is 2.0%, it is street addresses, and it is on the chart.

---

## What not to do

- **Do not claim leakage is zero.** It is 2.0% and it is on the chart. Somebody will
  read the chart.
- **Do not demo the vision detector.** There isn't one. If asked: *"cut on day 11.
  Ablation A8 shows it costs nothing — coverage, not a detector, is what accounts for
  the pixel channel. A half-trained model would have been worse than a designed
  degradation."*
- **Do not open the frontier chart without explaining the bar.** The three leakage dots
  coincide. The bar next to each is unprotected PII, and that is the axis that separates
  them.
- **Do not run `pnpm build`.** It is red in `apps/bench-site` (A's, logged). Nothing in
  either path needs it.
- **Do not say the extension is running** if Path B is what is on screen.
