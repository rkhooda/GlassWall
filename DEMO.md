# DEMO — the rehearsed script (about 7 minutes)

Every beat below runs on this repository as committed. Nothing is staged that the
code does not do. Judges supply their own use case at the finale, so the last beat
runs on a page we have not rehearsed.

## Setup (before the judges arrive)

```bash
pnpm install && bash ml/fetch-models.sh && pnpm build && pnpm build:eval
pnpm dev                     # bench sites :5173, gateway :3000
```

1. `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`.
2. Pin the GLASSWALL icon. Click it: the side panel opens. The header chips must read
   **gateway · scripted** (or the configured provider) and **local · WASM** (or WebGPU).
3. Optional: `apps/backend/.env` with an Ollama or Anthropic key so the planner chip
   shows a real model. Without it the scripted planner runs every beat.
4. Open `http://localhost:5173/shoplite/checkout?seed=1337`. Open DevTools → Network,
   filter `localhost:3000`.
5. Run beat 2 once so the models are warm (the chip shows **NER warm**).

## Beats

| # | Beat | Time | Where | What they see |
|---|---|---|---|---|
| 1 | The problem | 0:30 | slide or the raw page | A checkout page holds a name, email, phone, address, card fields. Any agent that screenshots it uploads all of that. |
| 2 | Perception on device | 1:00 | ShopLite checkout, STRICT | Type the task, press **Start**. The page shows numbered element boxes and red redaction boxes; the panel's **Run** tab lists each step with local vs network timings. |
| 3 | The boundary | 1:30 | panel → **Privacy** tab | Left: what the extension saw. Right: what left the device, handles only. Type the persona's email from the page into *Is a value in the outbound payload?* → not present in any of nine encodings. Type a product name → present. |
| 4 | The form fills anyway | 1:00 | page + Network tab | Fields populate with the real values while the request bodies to `localhost:3000` contain `⟦EMAIL#1⟧`, `⟦PHONE#2⟧`. The trace shows `TYPE ← ⟦EMAIL#1⟧` with the target field's label. Order placement asks for confirmation; approve. Order confirmed. |
| 5 | Pixels, redacted | 0:45 | ClinicDesk, BALANCED | `http://localhost:5173/clinicdesk/`, task *Open the first patient's record*, policy BALANCED. Accept the per-origin prompt. The lab report is a canvas: OCR reads the Aadhaar and phone off the pixels, both become handles, and the screenshot on the wire has black boxes over them. |
| 6 | The attack | 0:45 | ShopLite injection page | Restart the gateway with `GLASSWALL_DEMO_HIJACKED=1`. Open `/shoplite/injection`, task *Add this product to my cart*. The hijacked planner tries to type the Aadhaar handle into the search box. Red banner: **Blocked: VAULT_TYPE_MISMATCH**. The audit entry records it. Restart the gateway normally. |
| 7 | The proof | 1:00 | terminal | `pnpm bench:leakage`: the safe build shows 0 findings; then the UNSAFE build (sanitizer and gate compiled out) runs and the same harness goes red with the persona's values on the wire. A test that can fail. |
| 8 | The numbers | 0:30 | `eval/reports/summary.md` | The five PS metrics from the last `pnpm bench:all`: visual-context recall/precision, PII recall/precision, redaction precision, local ms per step and payload size, step latency p50/p95. |
| 9 | Unseen page | 0:45 | judge's choice | Any http(s) page they name with a form or a search box. Same panel, same task box. The scripted planner fills by field semantics; a configured LLM handles the rest. |
| 10 | Close | 0:15 | slide | What is ours, what is prior work, what we do not claim (`SECURITY.md`). |

## Exact click paths

**Beat 2.** Panel: task *Fill the shipping form with my saved details and place the
order*, policy **STRICT**, **Start**. Watch the overlay appear on the page. In the
**Run** tab, the summary shows observed elements, redactions and the planner in use.

**Beat 3.** Panel → **Privacy**. The inspector shows *Local observation vs. outbound
payload* side by side and *Why each region was withheld*. In *Is a value in the
outbound payload?* paste the email shown on the page's saved-details card (for seed
1337 it is on screen). Result: not present. Paste `Wireless Earbuds`: present.

**Beat 4.** DevTools → Network → the latest `step` request → Payload. Point at
`sensitivity_class: "EMAIL"` on the field and the `handles` list. When the modal
*Approve / Deny* appears for **Place order**, press **Approve**. The page navigates to
the confirmation. Panel: **Export audit log** downloads the content-free record.

**Beat 5.** Switch policy to **BALANCED** before pressing Start. Chrome asks for
permission on `localhost:5173`; allow. The `step` request now carries
`screenshot.data_base64`; decode it with any base64-to-image tool, or trust the
redaction count and the *Why each region was withheld* list, which names the OCR hits.

**Beat 6.** In the gateway terminal: Ctrl-C, then
`GLASSWALL_DEMO_HIJACKED=1 pnpm --filter @glasswall/backend start`. The planner chip
reads **demo-hijacked**. Run the task. After the block, restart the gateway without
the variable.

**Beat 7.** `pnpm bench:leakage` (about two minutes). Read the two tables aloud.

**Beat 9.** Ask for a URL. Navigate, open the panel, type what they want done. If the
page is a login or payment page, STRICT shows the fields as `PASSWORD` / `CREDIT_CARD`
classes with no values, and the planner asks for confirmation before submitting.

## Reset between runs

- ShopLite: the **Reset demo** button in the page footer clears the cart and order.
- Panel: **Abort** if a run is in progress; the next **Start** begins a fresh session
  (new session id, new handles, empty vault).
- Gateway: sessions are in memory; restart it to clear everything.

## If something goes wrong

| Symptom | Do |
|---|---|
| Header chip says **gateway offline** | `pnpm dev` is not running, or the port moved. Restart it. |
| "GLASSWALL works on http(s) pages only" | The active tab is `chrome://`. Click the bench-site tab, then Start. |
| Screenshot missing under BALANCED | Accept the permission prompt, or reload the page and Start again. |
| NER/OCR chip says cold and steps are slow | First step loads the models (a few seconds); later steps are fast. Warm up before the judges arrive. |
| The planner gives up on the judge's page | Say so. Show the trace: the observation is still handles-only, and nothing left the device that should not have. |
| Provider key expired | Nothing to do: the chain falls back to the scripted planner automatically and the chip shows which one answered. |

## Checklist

- [ ] Fresh clone builds and `pnpm verify:boundary` passes
- [ ] Extension loads with no errors in the service worker console
- [ ] Beats 2 to 7 run once on this machine before the session
- [ ] `pnpm bench:smoke` green, `pnpm bench:leakage` green with the negative control red
- [ ] `eval/reports/summary.md` is from the current commit
- [ ] A second laptop holds the same state
