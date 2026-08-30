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
import { SecretRegistry as SecretRegistryImpl } from './registry/registry';
import { normalize } from './registry/normalize';
import { encodeAllForms } from './registry/encodings';
import { tokenizeAndRegister, getHandleForValue, type Tokenizer } from './tokenizer';
import { Vault } from './vault';
import { buildSanitizedObservation, deriveAvailableActions, classifySensitivityFromRules } from '@glasswall/perception/observation-builder';

export interface PerceptionSource {
  id: string;
  timeout_ms: number;
  run(ctx: PerceptionContext): Promise<Evidence[]>;
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
  textSpan?: string;
  elementId?: string;
}

export interface FusionResult {
  regions: Array<{
    rect: [number, number, number, number];
    sensitivity: number;
    evidence: Evidence[];
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

  const registry = new SecretRegistryImpl();
  const tokenizer = createTokenizer(session.session_id);

  try {
    const rulesStart = Date.now();
    const recognizerResults = recognizeAll(raw, frame);
    timings.rules = Date.now() - rulesStart;

    for (const result of recognizerResults) {
      const handle = tokenizeAndRegister(tokenizer, registry, result.value, result.piiType, result.tier);
      allDetections.push({
        type: 'regex',
        pii_type: result.piiType,
        confidence: 1.0,
        rect: result.rect,
        text_span: handle,
        source_id: 'recognizers',
      });
      allPolicyDecisions.push({
        pii_type: result.piiType,
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

      for (const evidence of result.value) {
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
        source: region.source,
        score: region.sensitivity,
      });
    }

    const buildStart = Date.now();
    const tokenizedElements = raw.elements.map(el => {
      const elementDetections = allDetections.filter(d => d.rect && rectsOverlap(d.rect!, el.rect));
      const sensitivityClass = elementDetections.length > 0
        ? elementDetections.reduce((max, d) => d.confidence > max.confidence ? d : max).pii_type
        : classifySensitivityFromRules(el, policy);
      const tokenizedLabel = sensitivityClass && sensitivityClass !== 'NONE'
        ? getHandleForValue(tokenizer, el.label_raw, sensitivityClass) || '[REDACTED]'
        : el.label_raw;
      const tokenizedPlaceholder = el.placeholder_raw && sensitivityClass && sensitivityClass !== 'NONE'
        ? getHandleForValue(tokenizer, el.placeholder_raw, sensitivityClass) || '[REDACTED]'
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

    const handles = Array.from(registry.entries()).map(([handle, entry]) => ({
      handle,
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

function createTokenizer(sessionSalt: string): Tokenizer {
  return {
    sessionSalt,
    tokenize(value: string, piiType: PiiType, tier: number): string {
      const normalized = normalize(value);
      const handleId = simpleHash(sessionSalt + normalized).toString(16).slice(0, 8);
      return tier === 1 ? `⟦${piiType}⟧` : `⟦${piiType}#${handleId}⟧`;
    },
  };
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function recognizeAll(raw: RawObservation, frame: CapturedFrame | null): Array<{ value: string; piiType: PiiType; tier: number; rect?: [number, number, number, number] }> {
  const results: Array<{ value: string; piiType: PiiType; tier: number; rect?: [number, number, number, number] }> = [];

  for (const element of raw.elements) {
    if (element.type === 'password' || element.autocomplete?.includes('cc-') || element.autocomplete?.includes('password')) {
      results.push({ value: '[PASSWORD]', piiType: 'PASSWORD', tier: 1, rect: element.rect });
    }
    if (element.type === 'email' || element.autocomplete?.includes('email')) {
      results.push({ value: element.label_raw, piiType: 'EMAIL', tier: 2, rect: element.rect });
    }
    if (element.type === 'tel' || element.autocomplete?.includes('tel')) {
      results.push({ value: element.label_raw, piiType: 'PHONE', tier: 2, rect: element.rect });
    }
  }

  for (const textNode of raw.text_nodes) {
    const text = textNode.text;
    if (text.includes('@') && text.includes('.')) {
      results.push({ value: text, piiType: 'EMAIL', tier: 2, rect: textNode.rect });
    }
    if (/\d{10,}/.test(text.replace(/\D/g, ''))) {
      results.push({ value: text, piiType: 'PHONE', tier: 2, rect: textNode.rect });
    }
  }

  return results;
}