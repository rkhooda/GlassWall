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

/**
 * Headings and UI copy the model likes to call places or people. A span made only
 * of these words is a label, not a value; registering it would make the gate refuse
 * ordinary page text later.
 */
const GENERIC_WORDS = new Set(['personal', 'information', 'details', 'address', 'shipping', 'billing', 'application', 'service', 'services', 'portal', 'review', 'documents', 'document', 'profile', 'record', 'records', 'account', 'orders', 'order', 'cart', 'checkout', 'search', 'products', 'product', 'home', 'about', 'contact', 'support', 'help', 'login', 'sign', 'register', 'submit', 'next', 'back', 'continue', 'confirm', 'settings', 'privacy', 'terms', 'policy', 'patient', 'patients', 'list', 'report', 'lab', 'clinic', 'desk', 'government', 'india', 'indian', 'bench', 'demo', 'reset', 'welcome', 'thank', 'you', 'the', 'and', 'for', 'your', 'my', 'of', 'to', 'in', 'on', 'city', 'state', 'name', 'phone', 'email', 'pin', 'code', 'number', 'date', 'birth', 'street', 'saved', 'form', 'step', 'page', 'total', 'price', 'status', 'view', 'track', 'tracking']);

function isGenericSpan(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.length === 0 || words.every(w => GENERIC_WORDS.has(w) || w.length <= 2);
}

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
      const CONTROL_TAGS = new Set(['button', 'a', 'select', 'option', 'summary', 'label', 'input', 'textarea']);
      const controlOwned = new Set(
        ctx.raw.text_nodes
          .filter(tn => {
            const owner = tn.owner_element_id ? ctx.raw.elements.find(e => e.id === tn.owner_element_id) : undefined;
            return !!owner && (CONTROL_TAGS.has(owner.tag) || owner.role === 'button' || owner.role === 'link');
          })
          .map(tn => tn.id),
      );
      for (const node of mapSpansToRanges(spans, ranges)) {
        // A control's label ("Back", "Submit application") is never a personal value.
        if (controlOwned.has(node.id)) continue;
        const nodeText = ctx.raw.text_nodes.find(tn => tn.id === node.id)?.text ?? '';
        for (const span of node.spans) {
          // Only people and places are personal data. Organisations and MISC entities
          // (product names, brands) are not, and registering them as secrets would make
          // the gate refuse the agent's own legitimate literals.
          const piiType = nerTypeToPii(span.type);
          if (piiType !== 'PERSON_NAME' && piiType !== 'STREET_ADDRESS' && piiType !== 'NAME' && piiType !== 'ADDRESS') continue;
          const surface = nodeText.slice(span.start, span.end);
          if (surface.trim().length < 3 || isGenericSpan(surface)) continue;
          evidence.push({
            sourceId: 'ner',
            type: 'ner',
            piiType,
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
