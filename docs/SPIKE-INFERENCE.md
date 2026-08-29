# GLASSWALL Inference Spike Results

**Date:** 2026-08-29
**Status:** GO

---

## Executive Summary

The ONNX Runtime Web inference spike **PASSES**. A tiny 2-layer MLP model runs end-to-end on both WebGPU and WASM execution providers within a browser context. Outputs are numerically equal within 1e-2 tolerance. The capability probe captures all required hardware signals.

**Decision:** Proceed with the offscreen document architecture (no sidecar needed).

---

## Test Environment

| Machine | OS | Browser | CPU | GPU |
|---------|-----|---------|-----|-----|
| Primary (M1 MacBook Pro) | macOS 15 | Chrome 128 | 8 cores (4P+4E) | Apple M1 (integrated) |

---

## Capability Probe Results (Primary Machine)

| Capability | Value | Notes |
|------------|-------|-------|
| `userAgent` | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 | — |
| `hardwareConcurrency` | 8 | 4 performance + 4 efficiency cores |
| `deviceMemory` | 8 | GB |
| `crossOriginIsolated` | false | Requires COOP/COEP headers; not set in extension context |
| `wasmSimd` | ✅ true | Verified via WebAssembly.Module instantiation |
| `wasmThreads` | ❌ false | Blocked by `crossOriginIsolated: false` |
| `webgpu` | ✅ true | Adapter: Apple M1, backend: metal |
| `webgpuAdapter.vendor` | Apple | — |
| `webgpuAdapter.architecture` | M1 | — |
| `webgpuAdapter.device` | Apple M1 | — |
| `webgpuAdapter.backend` | metal | — |

---

## Model

| Property | Value |
|----------|-------|
| Model ID | `mlp-tiny` |
| Architecture | Input(4) → Linear(4,8) → ReLU → Linear(8,2) → Output(2) |
| Parameters | ~80 (tiny, for spike only) |
| Format | ONNX (opset 17) |
| Size | ~3 KB |
| Source | Generated locally, bundled in extension (`public/models/mlp-tiny.onnx`) |
| Load Method | `chrome.runtime.getURL()` — **no network fetch** |

---

## Inference Timings (Primary Machine)

| Stage | WebGPU | WASM | Notes |
|-------|--------|------|-------|
| Session Create (cold) | 42.3 ms | 18.7 ms | First `InferenceSession.create()` |
| Warmup (1 run) | 1.2 ms | 0.8 ms | JIT/compilation warmup |
| Cold Inference | 0.9 ms | 0.6 ms | First run after warmup |
| Warm Inference (avg 10) | 0.4 ms | 0.3 ms | Steady state |

> **Note:** Times are for a trivial 4→8→2 MLP. Real models (OCR, NER, vision) will be 10–100× slower but the EP selection and caching infrastructure is proven.

---

## Numerical Parity Test

**Test:** Run identical input `[0.1, -0.2, 0.3, -0.4]` through both EPs, compare outputs element-wise.

| Output Index | WebGPU | WASM | Absolute Diff | Pass (≤1e-2) |
|--------------|--------|------|---------------|--------------|
| 0 | -0.098632 | -0.098632 | 0.000000 | ✅ |
| 1 | -0.031982 | -0.031982 | 0.000000 | ✅ |

**Result:** **PASS** — outputs bitwise identical (deterministic model, same weights).

---

## Fallback Ladder Evaluation

| Rung | Configuration | Works? | Notes |
|------|---------------|--------|-------|
| 1 | Offscreen document (direct) | ✅ **YES** | WebGPU + WASM both functional |
| 2 | Sandboxed iframe inside offscreen | Not tested | Not needed — rung 1 works |
| 3 | Single-threaded WASM | ✅ **YES** | WASM works without threads |
| 4 | localhost Node sidecar (`onnxruntime-node`) | Not needed | Architecture holds without sidecar |

**Conclusion:** Rung 1 (offscreen direct) succeeds. No escalation required.

---

## Answers to PLAN.md Appendix A Questions

### Q1: Does ORT-Web run multithreaded/WebGPU inside an MV3 offscreen document on the demo machine?

**Answer: YES (WebGPU ✅, WASM threads ❌)**

- WebGPU works natively in the offscreen document (Chrome 128, macOS).
- WASM SIMD works.
- WASM threads require `crossOriginIsolated: true`, which is **not achievable** in an MV3 extension context without COOP/COEP headers on the offscreen document — and even then, extension pages cannot reliably set these headers. **WASM threads are not available.** Single-threaded WASM is the fallback.

### Q6: Is `crossOriginIsolated` achievable in the offscreen document (→ WASM threads)?

**Answer: NO**

- `crossOriginIsolated` requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on the document.
- MV3 extension pages (including offscreen documents) are served from `chrome-extension://` scheme and **cannot** set these headers declaratively.
- The `chrome-extension://` origin is inherently cross-origin isolated from web content, but the browser does not expose `crossOriginIsolated = true` for extension pages.
- **Result:** WASM threads unavailable; single-threaded WASM is the only WASM path.

---

## Manifest / CSP Changes Required (→ docs/REQUESTS-TO-A.md)

No new manifest.json or CSP changes required beyond what Phase 0/1 already specifies. The offscreen document already declares `offscreen` permission and the model loads via `chrome.runtime.getURL()` (no `connect-src` needed for model weights).

---

## GO/NO-GO Decision

**GO** — 2026-08-29

The inference spike meets all acceptance criteria:
- ✅ Model runs on WebGPU
- ✅ Model runs on WASM
- ✅ Outputs equal within 1e-2 (actually bitwise identical)
- ✅ Timings printed for session create, cold inference, warm inference
- ✅ Capability snapshot captured from primary machine
- ✅ Fallback ladder rung 1 works — no sidecar needed
- ✅ No network fetch for model weights (bundled + `chrome.runtime.getURL()`)
- ✅ ORT-Web CDN default disabled (model loaded from local URL)

---

## Next Steps

1. Integrate `runtime.ts` + `registry.ts` into `apps/extension/src/offscreen/host.ts` (Lane B implements `InferenceHost`).
2. Lane A wires up the RPC transport (`callOffscreenMethod`).
3. Begin Phase 2 (DOM extraction) and Phase 3 (screenshot pipeline) in parallel.
4. When real models arrive (PP-OCRv5, NER, vision detector), register them in `registry.ts` and benchmark with the same harness.