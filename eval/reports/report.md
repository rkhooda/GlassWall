# P12-B — leakage evaluation and the privacy–utility frontier

![frontier](./frontier.svg)

**Measured 2026-09-01T06:12:22.123Z at `bd968d33d7483120936f8689951db95110fe6c29`.** Every number below is as measured.
No leakage figure is rounded toward zero.

## Environment

| | |
|---|---|
| Hardware | Apple M1 · 8 cores · 8 GB |
| OS | macOS 26.5 (arm64) |
| Runtime | Node v24.20.0 |
| Browser (Playwright chromium) | Google Chrome for Testing 151.0.7922.34 |
| Commit | `bd968d33d7483120936f8689951db95110fe6c29` |
| Seeds per point | 10 |
| Profile | BALANCED |

## The three points

| config | source(s) | leakage rate | σ | leaked values / run | unprotected PII | tier-1 exposed | PII recall | σ | redaction precision | σ | task utility | σ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A1** | DOM only (regex) | **2.0%** | 0.031 | 0.3 | 40.0% | 0 | 60.0% | 0.000 | 100.0% | 0.000 | 100.0% | 0.000 |
| **A6** | fusion, no coverage | **2.0%** | 0.031 | 0.3 | 13.3% | 0 | 86.7% | 0.000 | 100.0% | 0.000 | 80.0% | 0.000 |
| **A7** | fusion + explain-or-redact | **2.0%** | 0.031 | 0.3 | 0.0% | 0 | 100.0% | 0.000 | 100.0% | 0.000 | 60.0% | 0.000 |

*Task utility* — elements whose label survived verbatim **and** that still carry at
least one available action. `sanitize()` empties `available_actions` for anything a
fused region covers, so a redacted control is unclickable, not merely unlabelled.
*Redaction precision* — redacted rects that actually covered ground-truth PII. It
falls as coverage redacts regions that turn out to hold nothing, which is the
over-redaction cost explain-or-redact is paying for the recall it buys.

## Acceptance

- **A6 beats A1 on PII recall:** 86.7% vs 60.0% — ✅
- **A7 reaches leakage 0:** 2.0% — ❌ **not met, reported as measured**
- **Tier-1 exposure is 0 everywhere:** ✅
- **≥5 seeds per point with variance:** 10 seeds, σ in every column — ✅
- **Handle referential consistency:** ✅ every handle used in the payload is declared, carries one type, and reproduces across identical runs
- **Hardware, OS, browser and commit stated:** ✅ above

## The residual

A7 still leaks 2.0% — 0.3 values per run, of type **STREET_ADDRESS**, in every seed.

This is the P8 NER address gap, not a fusion defect: bare localities with no
road/street token sit in DOM free text the extractor legitimately accounted for, so
coverage does not reach them and no detector fires on them. No configuration in the
sweep moves it. It closes when NER address recall closes, and not before. The worst
configuration on this axis is A1 at 2.0%.

## What this does not measure

The utility axis is computed **in process**, on the sanitized payload — not through
A's Playwright harness in `eval/harness/`. The harness needs a loadable extension,
and `apps/extension/dist` currently ships no content script and no side panel
(`manifest.json` declares neither), so `waitForExtensionReady` cannot resolve and
no end-to-end task can execute. Logged in `docs/REQUESTS-TO-A.md`. When that lands,
the y-axis should be replaced with the harness's real task-completion rate; the
x-axis does not change, because leakage is measured on the payload either way.

Task success is therefore **not** claimed here. What is claimed is the shape of the
trade, and that shape is measured.
