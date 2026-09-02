// sanitize(): RawObservation → SanitizedObservation.
//
// Layer 1 is structural: the builder is an allowlist projection, so no field can hold
// raw HTML, a value, a cookie or raw OCR text. Layer 2 runs here: deterministic
// recognizers, optional perception sources (OCR/NER/vision), noisy-OR fusion,
// explain-or-redact coverage, and the policy profile. Every detected value becomes a
// typed handle recorded in the session's secrets so the egress gate can catch it if
// it ever reappears and the executor can resolve it locally.
//
// sanitize() never throws. On an internal failure it returns a maximally redacted
// observation with `degraded: ['sanitize_exception']`.
import type { RawObservation, CapturedFrame, SanitizedObservation, Budget } from '@glasswall/schema/observation';
import type { RedactionReason, SanitizeResult, Detection, PolicyDecision, Timings } from '@glasswall/schema/audit';
import type { PolicyConfig, PiiType } from '@glasswall/schema/policy';
import type { SecretRegistry } from '@glasswall/schema/branded';

import { recognizeAll, recognizeText, isLabelWord } from './recognizers';
import { createTokenizer, getHandleForValue, tokenizeAndRegister, type Tokenizer } from './tokenizer';
import { buildSanitizedObservation, deriveAvailableActions, classifySensitivityFromRules } from '@glasswall/perception/observation-builder';
import { PROFILES, decide, tierForType, type Profile, type Transformation } from './policy';
import { fuse } from './fusion';
import { explainOrRedact, partitionByExplanation } from './coverage';
import type { SessionSecrets } from './session-secrets';
import { normalizePiiType } from './pii-types';

export interface PerceptionSource {
  id: string;
  timeout_ms: number;
  run(ctx: PerceptionContext): Promise<SourceOutput>;
  /**
   * The regions this source is the account for. When `run()` throws or hangs,
   * sanitize() marks these unexplained so a dead source costs utility, never privacy.
   */
  coverage?(ctx: PerceptionContext): Array<{ rect: [number, number, number, number]; reason: string }>;
}

export interface SourceOutput {
  evidence: Evidence[];
  degraded?: string[];
  /** Regions the source could not read: masked, never assumed clean. */
  unexplained?: Array<{ rect: [number, number, number, number]; reason: string }>;
}

export interface PerceptionContext {
  raw: RawObservation;
  frame: CapturedFrame | null;
  registry: SecretRegistry;
  tokenizer: Tokenizer;
  policyProfile: PolicyConfig['name'];
  /** A disabled screenshot is a decision; an absent frame is an accident. Pixel sources gate on this. */
  screenshotEnabled: boolean;
}

export interface Evidence {
  sourceId: string;
  type: 'regex' | 'ner' | 'ocr' | 'vision' | 'deterministic';
  piiType: PiiType;
  confidence: number;
  rect?: [number, number, number, number];
  /** Raw matched text; sanitize() tokenizes it. Sources must not pre-tokenize. */
  textSpan?: string;
  elementId?: string;
}

export interface SanitizeInput {
  raw: RawObservation;
  frame: CapturedFrame | null;
  task: string;
  step: number;
  session: { session_id: string; policy_profile: PolicyConfig['name']; secrets?: SessionSecrets };
  perceptionSources?: PerceptionSource[];
  /** Profile parsed from config/policies/*.json (ablations); the extension uses PROFILES[policy_profile]. */
  profile?: Profile;
  budget?: Budget;
}

/** Below this length a "value" is noise; replacing it would shred unrelated text. */
const MIN_SUBSTITUTION_LENGTH = 3;
const PASSES_THROUGH = new Set<Transformation>(['PASS']);

export { normalizePiiType as toPiiType };

function emptyTimings(): Timings {
  return { rules: 0, ner: 0, ocr: 0, vision: 0, fuse: 0, build: 0 };
}

function maximallyRedacted(raw: RawObservation, degraded: string[], budget: Budget): SanitizeResult {
  const observation = buildSanitizedObservation({
    raw,
    tokenizedElements: raw.elements.map(el => ({ rawElement: el, tokenizedLabel: '[REDACTED]', tokenizedPlaceholder: el.placeholder_raw ? '[REDACTED]' : undefined, sensitivityClass: 'PERSONAL', availableActions: [] })),
    tokenizedTextNodes: raw.text_nodes.map(tn => ({ rawTextNode: tn, tokenizedText: '[REDACTED]' })),
    handles: [],
    budget,
  });
  const timings = emptyTimings();
  return { observation, redactions: [], audit: { detections: [], policy: [], egress: [], timings, degraded }, timings, degraded };
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, sourceId: string): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${sourceId} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return { ok: true, value: await Promise.race([promise, timeout]) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

function rectsOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

/** Fraction of `el` covered by `region`. */
function overlapFraction(region: [number, number, number, number], el: [number, number, number, number]): number {
  const w = Math.min(region[0] + region[2], el[0] + el[2]) - Math.max(region[0], el[0]);
  const h = Math.min(region[1] + region[3], el[1] + el[3]) - Math.max(region[1], el[1]);
  const area = el[2] * el[3];
  return w <= 0 || h <= 0 || area <= 0 ? 0 : (w * h) / area;
}

const INTERACTIVE_TAGS = new Set(['input', 'textarea', 'select', 'button', 'a']);

/** Placeholders are examples, never user data. One that looks like PII is replaced by a note, not a handle. */
function scrubPlaceholder(text: string | undefined): string | undefined {
  if (!text) return text;
  const hit = recognizeText(text)[0];
  return hit ? `[example ${hit.type.toLowerCase()}]` : text;
}

export async function sanitize(input: SanitizeInput): Promise<SanitizeResult> {
  const { raw, frame, step, session, perceptionSources = [] } = input;
  const profile: Profile = input.profile ?? PROFILES[session.policy_profile];
  const policy = profile.policy;
  const budget: Budget = input.budget ?? { steps_left: Math.max(0, 20 - step), ms_left: 5 * 60 * 1000 };

  // Session-scoped state when the caller has it; per-call state otherwise (tests, ablations).
  const secrets = session.secrets;
  const registry: SecretRegistry = secrets?.registry ?? new Map();
  const tokenizer: Tokenizer = secrets?.tokenizer ?? createTokenizer(session.session_id);
  const record = (value: string, piiType: PiiType, tier: number): string =>
    secrets ? secrets.record(value, piiType, tier) : tokenizeAndRegister(tokenizer, registry, value, piiType, tier);

  const degraded: string[] = [];
  const timings = emptyTimings();
  const detections: Detection[] = [];
  const decisions: PolicyDecision[] = [];
  const redactions: RedactionReason[] = [];
  const substitutions: Array<{ value: string; handle: string }> = [];
  const sourceUnexplained: Array<{ rect: [number, number, number, number]; reason: string }> = [];
  /** Element id → the PII type its rules say it will hold (autocomplete, type=password). */
  const elementClass = new Map<string, PiiType>();

  try {
    const t0 = Date.now();
    for (const hit of recognizeAll(raw, frame)) {
      const piiType = normalizePiiType(hit.piiType);
      if (hit.kind === 'element' && hit.elementId) {
        const prev = elementClass.get(hit.elementId);
        // Lowest tier wins; on a tie the later, more specific rule (autocomplete) wins over input type.
        if (!prev || tierForType(piiType) <= tierForType(prev)) elementClass.set(hit.elementId, piiType);
        detections.push({ type: 'regex', pii_type: piiType, confidence: hit.confidence, rect: hit.rect, source_id: 'element-rules' });
        continue;
      }
      const handle = record(hit.value, piiType, hit.tier);
      substitutions.push({ value: hit.value, handle });
      detections.push({ type: 'regex', pii_type: piiType, confidence: hit.confidence, rect: hit.rect, text_span: handle, source_id: 'recognizers' });
      const d = decide(profile, { sensitivity: hit.confidence, piiType, tier: hit.tier, cause: `${piiType} matched by recognizer` });
      decisions.push({ pii_type: piiType, action: d.action, threshold_matched: d.threshold_matched });
    }
    timings.rules = Date.now() - t0;

    for (const source of perceptionSources) {
      const started = Date.now();
      const ctx: PerceptionContext = { raw, frame, registry, tokenizer, policyProfile: policy.name, screenshotEnabled: policy.screenshot.enabled };
      const result = await runWithTimeout(source.run(ctx), source.timeout_ms, source.id);
      const key = (source.id === 'ner' || source.id === 'ocr' || source.id === 'vision' ? source.id : null) as 'ner' | 'ocr' | 'vision' | null;
      if (key) timings[key] += Date.now() - started;

      if (!result.ok) {
        const reason = `${source.id}_${result.error.message.includes('timeout') ? 'timeout' : 'error'}`;
        degraded.push(reason);
        for (const region of source.coverage?.(ctx) ?? []) sourceUnexplained.push({ rect: region.rect, reason: `${source.id}: ${reason}` });
        continue;
      }
      const output = result.value;
      degraded.push(...(output.degraded ?? []));
      for (const region of output.unexplained ?? []) sourceUnexplained.push({ rect: region.rect, reason: `${source.id}: ${region.reason}` });
      for (const ev of output.evidence) {
        // A model that flags the word "City" or "Name" found a label, not a value.
        if (ev.textSpan && (ev.textSpan.trim().length < 3 || isLabelWord(ev.textSpan))) continue;
        const piiType = normalizePiiType(ev.piiType);
        const tier = tierForType(piiType);
        const handle = ev.textSpan ? record(ev.textSpan, piiType, tier) : undefined;
        if (ev.textSpan && handle) substitutions.push({ value: ev.textSpan, handle });
        detections.push({ type: ev.type, pii_type: piiType, confidence: ev.confidence, rect: ev.rect, text_span: handle, source_id: source.id });
        const d = decide(profile, { sensitivity: ev.confidence, piiType, tier, cause: `${piiType} from ${source.id}` });
        decisions.push({ pii_type: piiType, action: d.action, threshold_matched: d.threshold_matched });
      }
    }

    // Explain-or-redact, then fuse everything through the same noisy-OR.
    const fuseStart = Date.now();
    const sensitiveIds = new Set(raw.elements.filter(el => detections.some(d => d.rect && rectsOverlap(d.rect, el.rect))).map(el => el.id));
    const { candidates, explained } = partitionByExplanation(raw, sensitiveIds);
    const unexplained = [...explainOrRedact({ candidates, explained, minCoverage: profile.fusion.min_coverage }), ...sourceUnexplained];
    const fused = fuse({ detections, unexplained, profile });
    timings.fuse = Date.now() - fuseStart;

    const redacting = fused.filter(r => !PASSES_THROUGH.has(r.action));
    for (const region of redacting) redactions.push({ rect: region.rect, reason: region.reason, source: region.source, score: Math.min(1, region.sensitivity) });

    // Build. Values are replaced by handles wherever they appear (labels, placeholders,
    // text); labels that are not values stay, because "Email" is not a secret and the
    // planner needs it. Elements keep their actions: sensitivity governs binding, not
    // reachability.
    const buildStart = Date.now();
    // This step's detections plus everything the session already knows: a value that
    // reappears in prose on a later page (an order summary, a confirmation dialog)
    // is substituted even when no detector fires on it there.
    const known = secrets ? secrets.knownValues() : [];
    const ordered = [...substitutions, ...known].filter(s => s.value.length >= MIN_SUBSTITUTION_LENGTH).sort((a, b) => b.value.length - a.value.length);
    const substitute = (text: string): string => {
      let out = text;
      for (const { value, handle } of ordered) {
        if (out.includes(value)) out = out.split(value).join(handle);
        else if (out.toLowerCase().includes(value.toLowerCase())) out = out.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), handle);
      }
      return out;
    };

    const tokenizedElements = raw.elements.map(el => {
      const covering = redacting.filter(r => rectsOverlap(r.rect, el.rect));
      // A region classifies an element only when the element sits inside it: a
      // container that merely encloses a redacted value is not itself sensitive,
      // and an input's class comes from its own rules, never from a neighbour.
      const inside = INTERACTIVE_TAGS.has(el.tag) ? [] : covering.filter(r => overlapFraction(r.rect, el.rect) >= 0.5);
      const evidenced = inside.flatMap(r => r.evidence).filter(d => d.pii_type !== 'NONE');
      const fromRules = elementClass.get(el.id);
      const fromRegion = evidenced.length ? evidenced.reduce((m, d) => (d.confidence > m.confidence ? d : m)).pii_type : undefined;
      const sensitivityClass: PiiType | undefined = fromRules ?? fromRegion ?? (inside.length && !el.label_raw ? 'PERSONAL' : undefined) ?? (classifySensitivityFromRules(el, policy) as PiiType | undefined);
      const tokenizedLabel = substitute(el.label_raw);
      const tokenizedPlaceholder = scrubPlaceholder(el.placeholder_raw);
      // Unexplained regions with no owner (canvas, image, cross-origin frame) carry no readable label anyway.
      const masked = inside.some(r => r.evidence.length === 0) && el.unexplained;
      return {
        rawElement: el,
        tokenizedLabel: masked && tokenizedLabel ? getHandleForValue(tokenizer, registry, tokenizedLabel, 'PERSONAL') ?? '[REDACTED]' : tokenizedLabel,
        tokenizedPlaceholder,
        sensitivityClass: sensitivityClass && sensitivityClass !== 'NONE' ? sensitivityClass : undefined,
        availableActions: deriveAvailableActions(el),
      };
    });

    const tokenizedTextNodes = raw.text_nodes.map(tn => {
      let text = substitute(tn.text);
      // A region nobody could account for covering this node: withhold it wholesale.
      const unaccounted = redacting.some(r => r.evidence.length === 0 && rectsOverlap(r.rect, tn.rect));
      if (unaccounted && text.trim().length > 0 && !/⟦[^⟧]+⟧/.test(text)) {
        text = record(text, 'PERSONAL', 3);
      }
      return { rawTextNode: tn, tokenizedText: text };
    });

    const handles = [...registry.values()].map(entry => ({ handle: entry.handle, type: entry.pii_type, tier: entry.tier, occurrences: 1, first_seen_step: step }));
    const observation = buildSanitizedObservation({ raw, tokenizedElements, tokenizedTextNodes, handles, budget });
    timings.build = Date.now() - buildStart;

    return { observation, redactions, audit: { detections, policy: decisions, egress: [], timings, degraded }, timings, degraded };
  } catch {
    return maximallyRedacted(raw, [...degraded, 'sanitize_exception'], budget);
  }
}

export type { SanitizedObservation };
