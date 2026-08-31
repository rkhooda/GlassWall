import {
  RawObservation,
  CapturedFrame,
  SanitizedObservation,
  Handle,
  Budget,
} from '@glasswall/schema/observation';
import {
  RedactionReason,
  AuditPrivacyFields,
  SanitizeResult,
  Detection,
  PolicyDecision,
  EgressCheck,
  Timings,
} from '@glasswall/schema/audit';
import { PolicyConfig, PiiType } from '@glasswall/schema/policy';
import { SafePayload, Violation, SecretRegistry, Result, ok, err } from '@glasswall/schema/branded';

import { recognizeAll } from './recognizers';
import { createTokenizer, getHandleForValue, tokenizeAndRegister, type Tokenizer } from './tokenizer';
import { buildSanitizedObservation, deriveAvailableActions, classifySensitivityFromRules } from '@glasswall/perception/observation-builder';

export interface PerceptionSource {
  id: string;
  timeout_ms: number;
  run(ctx: PerceptionContext): Promise<SourceOutput>;
}

/**
 * What one perception source reports back.
 *
 * `unexplained` is the fail-closed channel: a source that could not read a region —
 * because its model would not load, it ran out of time, or the crop budget excluded
 * the region — names that region here and it is masked. A source may never make a
 * region look clean by failing on it.
 */
export interface SourceOutput {
  evidence: Evidence[];
  /** Degradation reasons surfaced to the trace UI, e.g. 'ner_unavailable'. */
  degraded?: string[];
  unexplained?: Array<{ rect: [number, number, number, number]; reason: string }>;
}

export interface PerceptionContext {
  raw: RawObservation;
  frame: CapturedFrame | null;
  registry: SecretRegistry;
  tokenizer: Tokenizer;
}

export interface Evidence {
  sourceId: string;
  type: 'regex' | 'ner' | 'ocr' | 'vision' | 'deterministic';
  piiType: PiiType;
  confidence: number;
  rect?: [number, number, number, number];
  /**
   * The raw matched text. `sanitize` tokenizes it into the session registry and
   * keeps only the handle, so the value lands where the egress gate can catch it
   * and never in a detection record. Sources must not pre-tokenize.
   */
  textSpan?: string;
  elementId?: string;
}

export interface FusionResult {
  regions: Array<{
    rect: [number, number, number, number];
    sensitivity: number;
    evidence: Detection[];
    action: 'PASS' | 'GENERALIZE' | 'TOKENIZE' | 'MASK' | 'DROP' | 'VAULT_ONLY';
    source: string;
  }>;
  unexplainedRegions: Array<{ rect: [number, number, number, number]; reason: string }>;
}

function createEmptySanitizeResult(raw: RawObservation, policyProfile: PolicyConfig['name']): SanitizeResult {
  const budget: Budget = { steps_left: 20, ms_left: 5 * 60 * 1000 };
  const observation = buildSanitizedObservation({
    raw,
    tokenizedElements: raw.elements.map(el => ({
      rawElement: el,
      tokenizedLabel: el.label_raw,
      tokenizedPlaceholder: el.placeholder_raw,
      sensitivityClass: classifySensitivityFromRules(el, { ...policyProfile === 'STRICT' ? { name: 'STRICT' } : {} } as PolicyConfig),
      availableActions: deriveAvailableActions(el),
    })),
    tokenizedTextNodes: raw.text_nodes.map(tn => ({
      rawTextNode: tn,
      tokenizedText: tn.text,
    })),
    handles: [],
    budget,
  });

  return {
    observation,
    redactions: [],
    audit: {
      detections: [],
      policy: [],
      egress: [],
      timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
      degraded: ['sanitize_exception'],
    },
    timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
    degraded: ['sanitize_exception'],
  };
}

function createMaximallyRedactedResult(raw: RawObservation, degraded: string[]): SanitizeResult {
  const budget: Budget = { steps_left: 0, ms_left: 0 };
  const observation = buildSanitizedObservation({
    raw,
    tokenizedElements: raw.elements.map(el => ({
      rawElement: el,
      tokenizedLabel: '[REDACTED]',
      tokenizedPlaceholder: '[REDACTED]',
      sensitivityClass: 'PERSONAL',
      availableActions: [],
    })),
    tokenizedTextNodes: raw.text_nodes.map(tn => ({
      rawTextNode: tn,
      tokenizedText: '[REDACTED]',
    })),
    handles: [],
    budget,
  });

  return {
    observation,
    redactions: [],
    audit: {
      detections: [],
      policy: [],
      egress: [],
      timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
      degraded,
    },
    timings: { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 },
    degraded,
  };
}

async function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  sourceId: string
): Promise<{ ok: true; value: T } | { ok: false; error: Error; sourceId: string }> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${sourceId} timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    const value = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return { ok: true, value };
  } catch (e) {
    clearTimeout(timeoutId!);
    return { ok: false, error: e as Error, sourceId };
  }
}

export async function sanitize(input: {
  raw: RawObservation;
  frame: CapturedFrame | null;
  task: string;
  step: number;
  session: { session_id: string; policy_profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE' };
  perceptionSources?: PerceptionSource[];
}): Promise<SanitizeResult> {
  const startTime = Date.now();
  const { raw, frame, task, step, session, perceptionSources = [] } = input;
  const policyProfile = session.policy_profile;
  const policy = getPolicyConfig(policyProfile);

  const degraded: string[] = [];
  const timings: Timings = { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 };
  const allDetections: Detection[] = [];
  const allPolicyDecisions: PolicyDecision[] = [];
  const allRedactions: RedactionReason[] = [];

  const registry: SecretRegistry = new Map();
  const tokenizer = createTokenizer(session.session_id);

  try {
    const rulesStart = Date.now();
    const recognizerResults = recognizeAll(raw, frame);
    timings.rules = Date.now() - rulesStart;

    for (const result of recognizerResults) {
      const piiType = toPiiType(result.piiType);
      const handle = tokenizeAndRegister(tokenizer, registry, result.value, piiType, result.tier);
      allDetections.push({
        type: 'regex',
        pii_type: piiType,
        confidence: 1.0,
        rect: result.rect,
        text_span: handle,
        source_id: 'recognizers',
      });
      allPolicyDecisions.push({
        pii_type: piiType,
        action: result.tier === 1 ? 'VAULT_ONLY' : 'TOKENIZE',
        threshold_matched: 'tier1' as const,
      });
    }

    for (const source of perceptionSources) {
      const sourceStart = Date.now();
      const ctx: PerceptionContext = { raw, frame, registry, tokenizer };
      const result = await runWithTimeout(source.run(ctx), source.timeout_ms, source.id);

      if (!result.ok) {
        degraded.push(`${source.id}_${result.error.message.includes('timeout') ? 'timeout' : 'error'}`);
        continue;
      }

      switch (source.id) {
        case 'ner':
          timings.ner += Date.now() - sourceStart;
          break;
        case 'ocr':
          timings.ocr += Date.now() - sourceStart;
          break;
        case 'vision':
          timings.vision += Date.now() - sourceStart;
          break;
      }

      const output = result.value;
      degraded.push(...(output.degraded ?? []));
      for (const region of output.unexplained ?? []) {
        allRedactions.push({ rect: region.rect, reason: region.reason, source: redactionSource(source.id), score: 1 });
      }

      for (const evidence of output.evidence) {
        const handle = tokenizeAndRegister(tokenizer, registry, evidence.textSpan || '', evidence.piiType, getTierForType(evidence.piiType));
        allDetections.push({
          type: evidence.type,
          pii_type: evidence.piiType,
          confidence: evidence.confidence,
          rect: evidence.rect,
          text_span: handle,
          source_id: source.id,
        });
        allPolicyDecisions.push({
          pii_type: evidence.piiType,
          action: getPolicyAction(policy, evidence.piiType, evidence.confidence),
          threshold_matched: `${evidence.type}_${evidence.confidence.toFixed(2)}`,
        });
      }
    }

    const fuseStart = Date.now();
    const fusionResult = fuseEvidence(raw, allDetections, policy);
    timings.fuse = Date.now() - fuseStart;

    for (const region of fusionResult.regions) {
      allRedactions.push({
        rect: region.rect,
        reason: region.action,
        source: redactionSource(region.source),
        score: Math.min(1, region.sensitivity),
      });
    }

    // Anything the DOM could not account for is masked, not passed. This is the
    // clause that turns "we might have missed something" into "we withheld it".
    for (const region of fusionResult.unexplainedRegions) {
      allRedactions.push({ rect: region.rect, reason: region.reason, source: 'deterministic', score: 1 });
    }

    const buildStart = Date.now();
    const tokenizedElements = raw.elements.map(el => {
      const elementDetections = allDetections.filter(d => d.rect && rectsOverlap(d.rect!, el.rect));
      const sensitivityClass = elementDetections.length > 0
        ? elementDetections.reduce((max, d) => d.confidence > max.confidence ? d : max).pii_type
        : classifySensitivityFromRules(el, policy);
      const tokenizedLabel = sensitivityClass && sensitivityClass !== 'NONE'
        ? getHandleForValue(tokenizer, registry, el.label_raw, sensitivityClass) || '[REDACTED]'
        : el.label_raw;
      const tokenizedPlaceholder = el.placeholder_raw && sensitivityClass && sensitivityClass !== 'NONE'
        ? getHandleForValue(tokenizer, registry, el.placeholder_raw, sensitivityClass) || '[REDACTED]'
        : el.placeholder_raw;

      return {
        rawElement: el,
        tokenizedLabel,
        tokenizedPlaceholder,
        sensitivityClass,
        availableActions: sensitivityClass && sensitivityClass !== 'NONE' ? [] : deriveAvailableActions(el),
      };
    });

    const tokenizedTextNodes = raw.text_nodes.map(tn => {
      const textDetections = allDetections.filter(d => d.text_span && tn.text.includes(d.text_span.replace(/⟦|⟧/g, '')));
      let tokenizedText = tn.text;
      for (const detection of textDetections) {
        if (detection.text_span) {
          tokenizedText = tokenizedText.replace(detection.text_span, detection.text_span);
        }
      }
      return { rawTextNode: tn, tokenizedText };
    });

    const handles = Array.from(registry.values()).map(entry => ({
      handle: entry.handle,
      type: entry.pii_type,
      tier: entry.tier,
      occurrences: 1,
      first_seen_step: step,
    }));

    const observation = buildSanitizedObservation({
      raw,
      tokenizedElements,
      tokenizedTextNodes,
      handles,
      budget: { steps_left: 20 - step, ms_left: 5 * 60 * 1000 },
    });

    timings.build = Date.now() - buildStart;

    return {
      observation,
      redactions: allRedactions,
      audit: {
        detections: allDetections,
        policy: allPolicyDecisions,
        egress: [],
        timings,
        degraded,
      },
      timings,
      degraded,
    };
  } catch (e) {
    return createMaximallyRedactedResult(raw, [...degraded, 'sanitize_exception']);
  }
}

function getPolicyConfig(profile: 'STRICT' | 'BALANCED' | 'PERMISSIVE'): PolicyConfig {
  switch (profile) {
    case 'STRICT':
      return {
        name: 'STRICT',
        unexplained_prior: 0.8,
        screenshot: { enabled: false },
        thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
        tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'TOKENIZE', T4: 'ANNOTATE', T5: 'TOKENIZE' },
        url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
        text_block_max_chars: 400,
        fail_mode: 'CLOSED',
        high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
        require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
        max_elements: 400,
      };
    case 'BALANCED':
      return {
        name: 'BALANCED',
        unexplained_prior: 0.4,
        screenshot: { enabled: true },
        thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
        tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'GENERALIZE', T4: 'ANNOTATE', T5: 'TOKENIZE' },
        url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
        text_block_max_chars: 400,
        fail_mode: 'CLOSED',
        high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
        require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
        max_elements: 400,
      };
    case 'PERMISSIVE':
      return {
        name: 'PERMISSIVE',
        unexplained_prior: 0.1,
        screenshot: { enabled: true },
        thresholds: { tokenize: 0.6, mask: 0.8, drop: 0.95 },
        tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'PASS', T4: 'ANNOTATE', T5: 'TOKENIZE' },
        url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
        text_block_max_chars: 400,
        fail_mode: 'CLOSED',
        high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
        require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
        max_elements: 400,
      };
  }
}

function getTierForType(piiType: PiiType): number {
  if (piiType === 'PASSWORD' || piiType === 'CREDIT_CARD' || piiType === 'SSN') return 1;
  if (piiType === 'EMAIL' || piiType === 'PHONE' || piiType === 'ADDRESS' || piiType === 'NAME') return 2;
  return 3;
}

function getPolicyAction(policy: PolicyConfig, piiType: PiiType, confidence: number): 'PASS' | 'GENERALIZE' | 'TOKENIZE' | 'MASK' | 'DROP' | 'VAULT_ONLY' {
  const tier = getTierForType(piiType);
  const tierKey = `T${tier}` as keyof typeof policy.tiers;
  const tierPolicy = policy.tiers[tierKey];

  if (tierPolicy === 'VAULT_ONLY') return 'VAULT_ONLY';
  if (confidence >= policy.thresholds.drop) return 'DROP';
  if (confidence >= policy.thresholds.mask) return 'MASK';
  if (confidence >= policy.thresholds.tokenize) return 'TOKENIZE';
  return tierPolicy as 'PASS' | 'GENERALIZE' | 'TOKENIZE' | 'MASK' | 'DROP' | 'VAULT_ONLY';
}

function fuseEvidence(raw: RawObservation, detections: Detection[], policy: PolicyConfig): FusionResult {
  const regions: FusionResult['regions'] = [];
  const unexplainedRegions: FusionResult['unexplainedRegions'] = [];

  const explainedRects = raw.elements
    .filter(el => !el.unexplained && el.visible)
    .map(el => el.rect);

  for (const detection of detections) {
    if (detection.rect) {
      const sensitivity = detection.confidence;
      const action = getPolicyAction(policy, detection.pii_type, detection.confidence);
      regions.push({
        rect: detection.rect,
        sensitivity,
        evidence: [detection],
        action,
        source: detection.source_id,
      });
    }
  }

  for (const element of raw.elements) {
    if (element.unexplained) {
      unexplainedRegions.push({
        rect: element.rect,
        reason: 'cross_origin_iframe',
      });
    }
  }

  if (raw.frames.some(f => f.origin === 'cross')) {
    for (const frame of raw.frames) {
      if (frame.origin === 'cross') {
        unexplainedRegions.push({
          rect: frame.rect,
          reason: 'cross_origin_iframe',
        });
      }
    }
  }

  return { regions, unexplainedRegions };
}

function rectsOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

/** Redaction `source` is a fixed enum; anything else is attributed to the DOM pass. */
function redactionSource(sourceId: string): RedactionReason['source'] {
  return sourceId === 'ner' || sourceId === 'ocr' || sourceId === 'vision' ? sourceId : 'deterministic';
}

/**
 * The recognizers detect India-specific types (AADHAAR, PAN, IFSC, GSTIN, UPI, MRN)
 * that the frozen schema PiiType enum does not name. They are folded into the
 * nearest schema class here rather than widened inline — see docs/REQUESTS-TO-A.md
 * for the proposed contract change that would let them keep their own identity.
 */
const RECOGNIZER_TO_PII: Record<string, PiiType> = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  PASSWORD: 'PASSWORD',
  SECRET: 'API_KEY',
  API_KEY: 'API_KEY',
  TOKEN: 'TOKEN',
  CARD: 'CREDIT_CARD',
  CREDIT_CARD: 'CREDIT_CARD',
  IFSC: 'FINANCIAL',
  GSTIN: 'FINANCIAL',
  UPI: 'FINANCIAL',
  PERSON_NAME: 'NAME',
  NAME: 'NAME',
  STREET_ADDRESS: 'ADDRESS',
  ADDRESS: 'ADDRESS',
  MRN: 'HEALTH',
  SSN: 'SSN',
  USERNAME: 'USERNAME',
};

function toPiiType(recognizerType: string): PiiType {
  return RECOGNIZER_TO_PII[recognizerType.toUpperCase()] ?? 'PERSONAL';
}
