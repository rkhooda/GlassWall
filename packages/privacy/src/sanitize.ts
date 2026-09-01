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
import { PROFILES, decide, tierForType, type Profile, type Transformation } from './policy';
import { fuse, type FusedRegion } from './fusion';
import { explainOrRedact, partitionByExplanation } from './coverage';

export interface PerceptionSource {
  id: string;
  timeout_ms: number;
  run(ctx: PerceptionContext): Promise<SourceOutput>;
  /**
   * The regions this source is the account for — what nobody else is looking at.
   *
   * `run()` handles its own failures and reports them as `unexplained`. This exists
   * for the failures `run()` cannot report: it threw, or it never returned. In that
   * case `sanitize()` has no output to read, and without this it would silently drop
   * the source's whole domain — which is fail-OPEN, and was a measured leak before
   * P14-B's chaos suite caught it (NER throwing raised leakage from 1 to 2 on the
   * ablation scene while *lowering* the redaction count).
   *
   * A source that omits this cannot be compensated for when it dies. Implement it.
   */
  coverage?(ctx: PerceptionContext): Array<{ rect: [number, number, number, number]; reason: string }>;
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
  /** Sources threshold their own confidence against the active profile. */
  policyProfile: PolicyConfig['name'];
  /**
   * Whether the active policy captures a screenshot at all. A pixel source must
   * gate on this rather than on `frame !== null`: an absent frame is an accident,
   * a disabled screenshot is a decision, and only the second one means "do not
   * load the model". STRICT sets it false and never pays for OCR or vision.
   */
  screenshotEnabled: boolean;
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

/** Below this length a "value" is noise; replacing it would shred unrelated text. */
const MIN_SUBSTITUTION_LENGTH = 3;

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
  /**
   * A profile parsed from `config/policies/*.json` rather than the embedded default.
   * This is how the ablation harness sweeps source weights and thresholds without
   * a rebuild; the extension leaves it unset and gets `PROFILES[policy_profile]`.
   */
  profile?: Profile;
}): Promise<SanitizeResult> {
  const startTime = Date.now();
  const { raw, frame, task, step, session, perceptionSources = [] } = input;
  const policyProfile = session.policy_profile;
  const profile: Profile = input.profile ?? PROFILES[policyProfile];
  const policy = profile.policy;

  const degraded: string[] = [];
  const timings: Timings = { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 };
  const allDetections: Detection[] = [];
  const allPolicyDecisions: PolicyDecision[] = [];
  const allRedactions: RedactionReason[] = [];
  /** value -> handle, for rewriting detected text in place. Values stay local. */
  const substitutions: Array<{ value: string; handle: string }> = [];
  /** Regions a perception source reported it could not read. */
  const sourceUnexplained: Array<{ rect: [number, number, number, number]; reason: string }> = [];

  const registry: SecretRegistry = new Map();
  const tokenizer = createTokenizer(session.session_id);

  try {
    const rulesStart = Date.now();
    const recognizerResults = recognizeAll(raw, frame);
    timings.rules = Date.now() - rulesStart;

    for (const result of recognizerResults) {
      const piiType = toPiiType(result.piiType);
      const handle = tokenizeAndRegister(tokenizer, registry, result.value, piiType, result.tier);
      substitutions.push({ value: result.value, handle });
      allDetections.push({
        type: 'regex',
        pii_type: piiType,
        confidence: result.confidence,
        rect: result.rect,
        text_span: handle,
        source_id: 'recognizers',
      });
      const decision = decide(profile, {
        sensitivity: result.confidence,
        piiType,
        tier: result.tier,
        cause: `${piiType} matched by recognizer`,
      });
      allPolicyDecisions.push({
        pii_type: piiType,
        action: decision.action,
        threshold_matched: decision.threshold_matched,
      });
    }

    for (const source of perceptionSources) {
      const sourceStart = Date.now();
      const ctx: PerceptionContext = {
        raw, frame, registry, tokenizer, policyProfile,
        screenshotEnabled: policy.screenshot.enabled,
      };
      const result = await runWithTimeout(source.run(ctx), source.timeout_ms, source.id);

      if (!result.ok) {
        const reason = `${source.id}_${result.error.message.includes('timeout') ? 'timeout' : 'error'}`;
        degraded.push(reason);
        // A source that threw or hung produced no output at all, so it cannot mark
        // its own regions unexplained the way its internal failure paths do. We do
        // it for it: whatever it was the account for is now unaccounted for. Losing
        // a source must cost utility, never privacy.
        for (const region of source.coverage?.(ctx) ?? []) {
          sourceUnexplained.push({ rect: region.rect, reason: `${source.id}: ${reason}` });
        }
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
      // A source that could not read a region does not get to make it look clean:
      // its own unexplained list joins the coverage candidates and takes the prior.
      for (const region of output.unexplained ?? []) {
        sourceUnexplained.push({ rect: region.rect, reason: `${source.id}: ${region.reason}` });
      }

      for (const evidence of output.evidence) {
        const handle = tokenizeAndRegister(tokenizer, registry, evidence.textSpan ?? '', evidence.piiType, tierForType(evidence.piiType));
        if (evidence.textSpan) substitutions.push({ value: evidence.textSpan, handle });
        allDetections.push({
          type: evidence.type,
          pii_type: evidence.piiType,
          confidence: evidence.confidence,
          rect: evidence.rect,
          text_span: handle,
          source_id: source.id,
        });
        const decision = decide(profile, {
          sensitivity: evidence.confidence,
          piiType: evidence.piiType,
          tier: tierForType(evidence.piiType),
          cause: `${evidence.piiType} from ${source.id}`,
        });
        allPolicyDecisions.push({
          pii_type: evidence.piiType,
          action: decision.action,
          threshold_matched: decision.threshold_matched,
        });
      }
    }

    const fuseStart = Date.now();

    // Explain-or-redact first: anything the DOM cannot account for becomes another
    // piece of evidence, so it goes through the same noisy-OR as every detector.
    const sensitiveIds = new Set(
      raw.elements
        .filter(el => allDetections.some(d => d.rect && rectsOverlap(d.rect, el.rect)))
        .map(el => el.id)
    );
    const { candidates, explained } = partitionByExplanation(raw, sensitiveIds);
    const unexplained = [
      ...explainOrRedact({ candidates, explained, minCoverage: profile.fusion.min_coverage }),
      ...sourceUnexplained,
    ];
    const fusedRegions = fuse({ detections: allDetections, unexplained, profile });
    timings.fuse = Date.now() - fuseStart;

    // Only actual redactions land in the redaction list. A region that passes is
    // a decision, not a redaction, and the inspector must not claim otherwise.
    for (const region of fusedRegions.filter(r => !PASSES_THROUGH.has(r.action))) {
      allRedactions.push({
        rect: region.rect,
        reason: region.reason,
        source: region.source,
        score: Math.min(1, region.sensitivity),
      });
    }

    const buildStart = Date.now();
    const redactingRegions = fusedRegions.filter(r => !PASSES_THROUGH.has(r.action));
    const tokenizedElements = raw.elements.map(el => {
      // An element is sensitive if a *fused* region says so. Fusion's S is never below
      // any single source's contribution, so this can only redact more than the
      // per-detection view it replaced, never less.
      const covering = redactingRegions.filter(r => rectsOverlap(r.rect, el.rect));
      const elementDetections = covering.flatMap(r => r.evidence);
      const sensitivityClass = covering.length > 0
        ? (elementDetections.length > 0
            ? elementDetections.reduce((max, d) => (d.confidence > max.confidence ? d : max)).pii_type
            : 'PERSONAL')
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

    // Rewrite every detected value in the text with its handle. Longest first, so a
    // value contained inside another is not half-replaced.
    const ordered = [...substitutions]
      .filter(sub => sub.value.length >= MIN_SUBSTITUTION_LENGTH)
      .sort((a, b) => b.value.length - a.value.length);

    const tokenizedTextNodes = raw.text_nodes.map(tn => {
      let tokenizedText = tn.text;
      for (const { value, handle } of ordered) {
        if (tokenizedText.includes(value)) tokenizedText = tokenizedText.split(value).join(handle);
      }

      // Substitution only rewrites what a detector actually *found*. A fused region
      // covering this text node says the opposite: nothing in the system can account
      // for what it says. Elements have always been tokenized on that basis; text
      // nodes were not, so a region could be redacted in the screenshot while its
      // text went into the payload verbatim.
      //
      // That was a measured leak, found by the P14-B chaos suite: with NER
      // force-failed, its text nodes were correctly marked unexplained and correctly
      // redacted as pixels, and the names in them still shipped. Losing a detector
      // raised leakage instead of lowering it, which is the one thing a fail-closed
      // system may never do.
      // Only *unaccounted* regions do this — a covering region carrying no evidence,
      // which is the coverage pass or a dead source saying "nobody read this". A
      // region backed by detections was already handled above, value by value, and
      // replacing the whole paragraph there would throw away the structure that
      // type-preserving tokenization exists to keep (PLAN.md §4.5).
      const unaccounted = redactingRegions.some(
        r => r.evidence.length === 0 && rectsOverlap(r.rect, tn.rect)
      );
      if (unaccounted && tokenizedText.trim().length > 0) {
        tokenizedText =
          getHandleForValue(tokenizer, registry, tokenizedText, 'PERSONAL') || '[REDACTED]';
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

/** A transformation that leaves the content in the payload. */
const PASSES_THROUGH = new Set<Transformation>(['PASS']);

function rectsOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
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
