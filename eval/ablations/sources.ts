/**
 * Stand-in perception sources for the P11 ablation.
 *
 * The regex source is the real recognizer stack. NER and OCR are stubs, because the
 * point being measured is the *fusion arithmetic*, not model quality — model quality
 * is measured separately in P8/P9 and the stubs are pinned to those measurements:
 *
 *   - the NER stub reproduces the measured STREET_ADDRESS failure mode (bare
 *     localities with no road/street token are missed; PERSON_NAME recall was 1.00)
 *   - the OCR stub recovers the canvas text and hands it to the *real* recognizers,
 *     so what OCR can contribute is bounded by what the recognizers can match
 *   - the vision stub is deliberately weak and deliberately wrong-prone; noisy-OR
 *     is what makes that safe
 */
import type { PerceptionSource, Evidence } from '@glasswall/privacy/index';
import { recognizeAll } from '@glasswall/privacy/index';
import type { PiiType } from '@glasswall/schema/policy';
import type { RawObservation } from '@glasswall/schema/observation';
import type { Scene } from './scene';

const RECOGNIZER_TO_PII: Record<string, PiiType> = {
  EMAIL: 'EMAIL', PHONE: 'PHONE', PASSWORD: 'PASSWORD', SECRET: 'API_KEY', CARD: 'CREDIT_CARD',
  IFSC: 'FINANCIAL', GSTIN: 'FINANCIAL', UPI: 'FINANCIAL', AADHAAR: 'PERSONAL', PAN: 'PERSONAL',
  IP: 'PERSONAL', DOB: 'PERSONAL', PERSON_NAME: 'NAME', STREET_ADDRESS: 'ADDRESS', MRN: 'HEALTH',
};

/** Measured in P8: the model finds any address containing a road/street token. */
const ROAD_TOKENS = /\b(road|rd|street|st|marg|lane|cross|main|nagar\s+\d)\b/i;

export function nerSource(scene: Scene): PerceptionSource {
  return {
    id: 'ner',
    timeout_ms: 5000,
    async run() {
      const evidence: Evidence[] = [];
      for (const item of scene.groundTruth) {
        if (item.channel !== 'dom_free_text') continue;
        if (item.type === 'STREET_ADDRESS' && !ROAD_TOKENS.test(item.value)) continue;
        evidence.push({
          sourceId: 'ner',
          type: 'ner',
          piiType: RECOGNIZER_TO_PII[item.type] ?? 'PERSONAL',
          confidence: 0.9,
          rect: item.rect,
          textSpan: item.value,
        });
      }
      return { evidence };
    },
  };
}

export function ocrSource(scene: Scene): PerceptionSource {
  return {
    id: 'ocr',
    timeout_ms: 5000,
    async run(ctx) {
      // What a real OCR pass hands back: text plus the crop it came from. The
      // recognizers then run over it exactly as they do over DOM text — which is
      // the ceiling on what OCR can contribute. It reads both canvases; only one
      // of them contains anything a recognizer knows how to match.
      const evidence: Evidence[] = [];
      for (const canvas of scene.canvases) {
        const recovered: RawObservation = {
          ...ctx.raw,
          elements: [],
          text_nodes: [{ id: 'ocr_canvas', rect: canvas.rect, text: canvas.text, owner_element_id: null, source: 'dom' }],
        };
        for (const r of recognizeAll(recovered, null)) {
          evidence.push({
            sourceId: 'ocr',
            type: 'ocr',
            piiType: RECOGNIZER_TO_PII[r.piiType.toUpperCase()] ?? 'PERSONAL',
            confidence: r.confidence,
            rect: canvas.rect,
            textSpan: r.value,
          });
        }
      }
      return { evidence };
    },
  };
}

/**
 * A coarse, low-confidence "something document-shaped is here" box over the canvas
 * that actually renders a card. It misses the other one, which is the realistic
 * case for an untrained detector and the reason the ablation can separate a model
 * from the coverage pass at all.
 */
export function visionSource(scene: Scene): PerceptionSource {
  return {
    id: 'vision',
    timeout_ms: 5000,
    async run() {
      const target = scene.canvases.find(c => c.channel === 'canvas_readable');
      if (!target) return { evidence: [] };
      return {
        evidence: [
          { sourceId: 'vision', type: 'vision' as const, piiType: 'PERSONAL' as PiiType, confidence: 0.4, rect: target.rect },
        ],
      };
    },
  };
}
