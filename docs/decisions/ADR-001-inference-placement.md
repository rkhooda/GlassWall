# ADR-001: Inference Placement — Offscreen Document (Direct)

**Status:** Accepted
**Date:** 2026-08-29
**Deciders:** GlassWall maintainers
**Consulted:** Extension and inference modules

---

## Context

MV3 service workers cannot create Web Workers. ONNX Runtime Web's multithreaded WASM and WebGPU execution providers internally create Web Workers. The documented workaround is to run inference in an **offscreen document** (reason: `WORKERS`).

Even inside an offscreen document, the extension CSP may block worker creation, requiring a **sandboxed iframe** as a second fallback.

The inference spike resolved this early because **if ORT-Web could not run in the offscreen document, the entire architecture would need a Native Messaging host or `localhost` Node sidecar**.

---

## Decision

**Run all inference directly in the MV3 offscreen document. No sandboxed iframe. No sidecar.**

- WebGPU EP works natively in the offscreen document (tested on Chrome 128, macOS).
- Single-threaded WASM EP works natively (WASM threads unavailable due to `crossOriginIsolated: false`).
- Model weights load via `chrome.runtime.getURL()` — no network, no CDN.
- The `InferenceHost` RPC interface (contract C3) hides all placement details from the orchestrator.

---

## Alternatives Considered

| Alternative | Pros | Cons | Verdict |
|-------------|------|------|---------|
| **Sandboxed iframe inside offscreen** | Bypasses CSP worker restrictions | Adds complexity; extra RPC hop; iframe lifecycle management | Not needed — direct works |
| **Native Messaging host** | Full Node.js environment, `onnxruntime-node`, threads, any model | Requires separate install; not "in-browser"; breaks offline demo story | Fallback only |
| **`localhost` Node sidecar** | Same as above, easier to develop | Requires localhost server running; firewall/port issues; not zero-config | Fallback only |
| **Service worker + WASM (no threads)** | Simplest | No WebGPU; slow for vision/OCR; SW cannot create workers anyway | Rejected — no WebGPU |

---

## Consequences

### Positive
- **Simplest working architecture** — single offscreen document, single RPC interface.
- **WebGPU acceleration** available on supported hardware (major speedup for vision/OCR/NER).
- **Zero network dependency** for inference — models bundled, loaded via `chrome.runtime.getURL()`.
- **Offscreen document lifecycle** is managed by the extension host; inference modules only implement handlers.
- **CSP unchanged** — no `worker-src` or `child-src` directives needed.

### Negative
- **No WASM threads** — WASM inference is single-threaded. Acceptable for spike model; real models (PP-OCRv5, NER) will be slower on CPU-only machines. Mitigation: WebGPU preferred when available; WASM is fallback.
- **Offscreen document keep-alive** — must be managed carefully to avoid Chrome killing it.

---

## Verification

Spike results in `docs/SPIKE-INFERENCE.md` confirm:
- WebGPU EP: ✅ functional
- WASM EP (single-threaded): ✅ functional
- Numerical parity: ✅ within 1e-2 (bitwise identical)
- Model loading: ✅ via `chrome.runtime.getURL()`, no fetch
- Capability probe: ✅ captures all required signals

---

## Related

- `docs/SPIKE-INFERENCE.md` (detailed results)
