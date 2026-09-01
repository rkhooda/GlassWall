import type { Evidence, PerceptionContext, PerceptionSource, SourceOutput } from '@glasswall/privacy';
import {
  joinTextNodes,
  loadNerModel,
  mapSpansToRanges,
  nerTypeToPii,
  runNer,
} from '@glasswall/inference/ner';

/**
 * P8 — local NER as a perception source.
 *
 * The model is advisory evidence for fusion. It reads already-extracted text
 * blocks and never a value, and it cannot promote anything to a Tier 1 type.
 *
 * Failure path (the pattern every perception source follows): if the model will
 * not load or the run throws, we emit no evidence and mark every text block we
 * would have read as unexplained, so they are masked. Failing makes the payload
 * smaller, never larger.
 */

const TIMEOUT_MS = 5000;

/** Confidence floor per policy profile. Stricter profiles admit weaker evidence,
 *  because evidence here only ever causes redaction. */
const THRESHOLD_BY_PROFILE: Record<string, number> = {
  STRICT: 0.35,
  BALANCED: 0.5,
  PERMISSIVE: 0.7,
};

export const NER_UNAVAILABLE = 'ner_unavailable';

let loadFailed = false;

export const nerSource: PerceptionSource = {
  id: 'ner',
  timeout_ms: TIMEOUT_MS,

  coverage: (ctx: PerceptionContext) => textCoverage(ctx, NER_UNAVAILABLE),

  async run(ctx: PerceptionContext): Promise<SourceOutput> {
    const { text, ranges } = joinTextNodes(ctx.raw.text_nodes);
    if (!text.trim()) return { evidence: [] };

    if (loadFailed) return unavailable(ctx);

    try {
      await loadNerModel();
    } catch {
      loadFailed = true;
      return unavailable(ctx);
    }

    try {
      const threshold = THRESHOLD_BY_PROFILE[ctx.policyProfile] ?? 0.5;
      const { spans } = await runNer(text, threshold);

      const evidence: Evidence[] = [];
      for (const node of mapSpansToRanges(spans, ranges)) {
        const nodeText = ctx.raw.text_nodes.find(tn => tn.id === node.id)?.text ?? '';
        for (const span of node.spans) {
          evidence.push({
            sourceId: 'ner',
            type: 'ner',
            piiType: nerTypeToPii(span.type),
            confidence: span.confidence,
            rect: node.rect,
            // The matched text. sanitize() tokenizes it into the session registry
            // and keeps only the handle, so the gate can catch it if it escapes.
            textSpan: nodeText.slice(span.start, span.end),
            elementId: node.id,
          });
        }
      }
      return { evidence };
    } catch {
      return unavailable(ctx);
    }
  },
};

/**
 * Free text is what NER is the account for. If it is gone, none of it is accounted
 * for. Used by both failure paths: the one this source handles itself, and the one
 * sanitize() handles when this source throws or hangs and never returns anything.
 */
function textCoverage(ctx: PerceptionContext, reason: string) {
  return ctx.raw.text_nodes
    .filter(node => node.text.trim().length > 0)
    .map(node => ({ rect: node.rect, reason }));
}

/** No NER means no account of what the text says, so every text block is masked. */
function unavailable(ctx: PerceptionContext): SourceOutput {
  return {
    evidence: [],
    degraded: [NER_UNAVAILABLE],
    unexplained: textCoverage(ctx, NER_UNAVAILABLE),
  };
}

/** Test seam: forget a previous load failure. */
export function resetNerState(): void {
  loadFailed = false;
}
