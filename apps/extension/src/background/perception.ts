// Perception sources for the live loop.
//
// The service worker cannot host WASM models or canvases, so each source is an
// adapter: the first adapter that runs in a step sends the raw observation (and,
// under a policy that allows pixels, the screenshot) to the offscreen document
// once; every adapter then reads its own slice of the result. A dead offscreen
// document costs utility, never privacy: each adapter declares the regions it is
// the account for, and sanitize() masks them when the adapter reports failure.
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { RawObservation } from '@glasswall/schema/observation';
import type { RedactionReason } from '@glasswall/schema/audit';
import type { RedactedImagePayload } from '@glasswall/schema/transport';
import { PROFILES, type PerceptionSource, type PerceptionContext, type SourceOutput } from '@glasswall/privacy';
import { findUnexplainedRegions } from '@glasswall/inference/ocr/crop-policy';
import { perceiveInOffscreen, redactInOffscreen } from './capture';
import type { PerceiveResponse, SourceId } from '../shared/perceive';

export interface StepPerception {
  sources: PerceptionSource[];
  /** Per-source and decode timings from the offscreen document, once it has run. */
  timings(): Record<string, number>;
  /** Black out the fused regions on the held frame. null when no frame was captured or redaction failed. */
  redact(redactions: RedactionReason[]): Promise<RedactedImagePayload | null>;
  frameCaptured: boolean;
}

const SOURCE_TIMEOUT_MS: Record<SourceId, number> = { ocr: 12_000, ner: 8_000 };

export function sourcesFor(policy: PolicyProfile): SourceId[] {
  // NER reads DOM text under every profile; OCR needs pixels, which STRICT never captures.
  return PROFILES[policy].policy.screenshot.enabled ? ['ocr', 'ner'] : ['ner'];
}

export function createStepPerception(input: {
  observationId: string;
  raw: RawObservation;
  frameDataUrl: string | null;
  policy: PolicyProfile;
}): StepPerception {
  const policy = PROFILES[input.policy].policy;
  const ids = sourcesFor(input.policy);
  let pending: Promise<PerceiveResponse> | null = null;
  let timings: Record<string, number> = {};

  const run = (): Promise<PerceiveResponse> => {
    if (!pending) {
      pending = perceiveInOffscreen({
        observationId: input.observationId,
        raw: input.raw,
        frameDataUrl: policy.screenshot.enabled ? input.frameDataUrl : null,
        viewport: { w: input.raw.viewport.w, h: input.raw.viewport.h, dpr: input.raw.viewport.dpr },
        policyProfile: input.policy,
        screenshotEnabled: policy.screenshot.enabled,
        sources: ids,
      }).then(r => {
        if (r.ok) timings = r.timings;
        return r;
      });
    }
    return pending;
  };

  const coverageOf = (id: SourceId, ctx: PerceptionContext) =>
    id === 'ner'
      ? ctx.raw.text_nodes.filter(t => t.text.trim().length > 0).map(t => ({ rect: t.rect, reason: 'ner_unavailable' }))
      : findUnexplainedRegions(ctx.raw).map(r => ({ rect: r.rect, reason: 'ocr_unavailable' }));

  const sources: PerceptionSource[] = ids.map(id => ({
    id,
    timeout_ms: SOURCE_TIMEOUT_MS[id],
    coverage: ctx => coverageOf(id, ctx),
    async run(): Promise<SourceOutput> {
      const response = await run();
      if (!response.ok) throw new Error(response.error);
      const out = response.sources.find(s => s.id === id);
      if (!out || out.failed) throw new Error(out?.degraded[0] ?? `${id} produced no output`);
      return { evidence: out.evidence.map(e => ({ ...e, piiType: e.piiType as never })), degraded: out.degraded, unexplained: out.unexplained };
    },
  }));

  return {
    sources,
    frameCaptured: policy.screenshot.enabled && !!input.frameDataUrl,
    timings: () => timings,
    async redact(redactions) {
      if (!policy.screenshot.enabled || !input.frameDataUrl) return null;
      try {
        await run(); // the frame must be held offscreen before it can be redacted
        const r = await redactInOffscreen({ observationId: input.observationId, rects: redactions.map(x => ({ rect: x.rect, reason: x.reason, source: x.source })) });
        return r.ok ? r.image : null;
      } catch {
        return null;
      }
    },
  };
}
