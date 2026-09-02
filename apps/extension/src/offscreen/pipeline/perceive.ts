// Phase 1 placeholder: no local models are run yet. Every source reports itself
// degraded so sanitize() masks its regions (fail-closed). Phase 5 replaces this
// with the OCR/NER sources and the image redaction pipeline.
import type { PerceiveRequest, PerceiveResponse } from '../../shared/perceive';

export async function perceive(request: PerceiveRequest): Promise<PerceiveResponse> {
  const started = performance.now();
  return {
    ok: true,
    sources: request.sources.map(id => ({ id, evidence: [], degraded: [`${id}_unavailable`], unexplained: [], ms: 0 })),
    redactedImage: null,
    timings: { total: performance.now() - started },
  };
}
