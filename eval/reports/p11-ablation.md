# P11 ablation — fusion vs. every single source

10 generator seeds (1–10) · node v24.20.0 · 2026-09-02

Every row is the same build with a different `source_weights` object from
`config/policies/*.json`. Nothing is recompiled and no branch is taken on the
configuration name — an ablation here is literally setting `w_i` to 0.

## BALANCED

| config | source(s) | PII recall | σ | dom_structured | dom_free_text | canvas_readable | canvas_opaque | leaked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | DOM only (regex) | **0.600** | 0.000 | 1.00 | 0.00 | 0.00 | 0.00 | 5 |
| A2 | NER only | **0.133** | 0.000 | 0.00 | 1.00 | 0.00 | 0.00 | 5 |
| A3 | OCR only | **0.133** | 0.000 | 0.00 | 0.00 | 1.00 | 0.00 | 5 |
| A4 | vision only | **0.000** | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 | 5 |
| A5 | explain-or-redact only | **0.267** | 0.000 | 0.00 | 0.00 | 1.00 | 1.00 | 5 |
| A6 | fusion, no coverage | **0.867** | 0.000 | 1.00 | 1.00 | 1.00 | 0.00 | 5 |
| A7 | fusion + explain-or-redact | **1.000** | 0.000 | 1.00 | 1.00 | 1.00 | 1.00 | 5 |
| A8 | fusion + explain-or-redact, vision disabled | **1.000** | 0.000 | 1.00 | 1.00 | 1.00 | 1.00 | 5 |
| A9 | fusion, no coverage, vision disabled | **0.867** | 0.000 | 1.00 | 1.00 | 1.00 | 0.00 | 5 |

## STRICT

| config | source(s) | PII recall | σ | dom_structured | dom_free_text | canvas_readable | canvas_opaque | leaked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | DOM only (regex) | **0.600** | 0.000 | 1.00 | 0.00 | 0.00 | 0.00 | 5 |
| A2 | NER only | **0.133** | 0.000 | 0.00 | 1.00 | 0.00 | 0.00 | 5 |
| A3 | OCR only | **0.133** | 0.000 | 0.00 | 0.00 | 1.00 | 0.00 | 5 |
| A4 | vision only | **0.000** | 0.000 | 0.00 | 0.00 | 0.00 | 0.00 | 5 |
| A5 | explain-or-redact only | **0.267** | 0.000 | 0.00 | 0.00 | 1.00 | 1.00 | 5 |
| A6 | fusion, no coverage | **0.867** | 0.000 | 1.00 | 1.00 | 1.00 | 0.00 | 5 |
| A7 | fusion + explain-or-redact | **1.000** | 0.000 | 1.00 | 1.00 | 1.00 | 1.00 | 5 |
| A8 | fusion + explain-or-redact, vision disabled | **1.000** | 0.000 | 1.00 | 1.00 | 1.00 | 1.00 | 5 |
| A9 | fusion, no coverage, vision disabled | **0.867** | 0.000 | 1.00 | 1.00 | 1.00 | 0.00 | 5 |

## Reading it

- `canvas_opaque` holds an MRN and a postal code rendered to pixels. No recognizer
  matches either and no model is trained on them, so every detection-based row
  scores 0 there. Only explain-or-redact reaches it — which is the difference
  between A6 and A7, and between A9 and A8.
- A8 equals A7: removing the vision model costs nothing, because coverage, not a
  detector, is what accounts for the pixel channel.
- `leaked` is identical across every row. It is the measured P8 STREET_ADDRESS
  gap in DOM free text (bare localities with no road token), which is orthogonal
  to fusion — no configuration here moves it.
- STRICT and BALANCED score the same recall. They differ in *transformation*
  (DROP vs TOKENIZE on an unexplained region), which a binary recall metric
  cannot see. The privacy–utility frontier in P12-B is where that shows up.
