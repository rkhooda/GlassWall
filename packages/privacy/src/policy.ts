/**
 * P11 policy engine — declarative profiles, and the map from a fused sensitivity
 * score to a transformation with a reason a human can read.
 *
 * The profiles live in `config/policies/*.json` so the ablation harness can flip
 * one without a rebuild. The constants below are the same three profiles embedded
 * for the extension bundle, which cannot read the filesystem; `policy.test.ts`
 * asserts the two never drift.
 */
import { z } from 'zod';
import { PolicyConfigSchema, type PolicyConfig, type PolicyProfile, type PiiType } from '@glasswall/schema/policy';

/** The six transformations. `ANNOTATE` in the frozen tier enum degrades to PASS. */
export type Transformation = 'PASS' | 'GENERALIZE' | 'TOKENIZE' | 'MASK' | 'DROP' | 'VAULT_ONLY';

export type EvidenceKind = 'regex' | 'ner' | 'ocr' | 'vision' | 'deterministic';

/**
 * Per-source reliability `w_i` in `S = 1 − Π (1 − w_i · c_i)`.
 *
 * These are config, not code, for one reason: an ablation is exactly "set one
 * `w_i` to zero", and the harness must be able to do that without a rebuild.
 */
export const FusionConfigSchema = z
  .object({
    source_weights: z
      .object({
        regex: z.number().min(0).max(1),
        ner: z.number().min(0).max(1),
        ocr: z.number().min(0).max(1),
        vision: z.number().min(0).max(1),
        deterministic: z.number().min(0).max(1),
      })
      .strict(),
    /** Below this covered fraction a content region counts as unexplained. */
    min_coverage: z.number().min(0).max(1),
  })
  .strict();
export type FusionConfig = z.infer<typeof FusionConfigSchema>;

export const ProfileSchema = z
  .object({ policy: PolicyConfigSchema, fusion: FusionConfigSchema })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;

/** Validates a profile file. Throws — a malformed policy must not run at all. */
export function parseProfile(json: unknown): Profile {
  return ProfileSchema.parse(json);
}

const SHARED = {
  url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
  text_block_max_chars: 400,
  fail_mode: 'CLOSED',
  high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
  require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
  max_elements: 400,
} as const satisfies Partial<PolicyConfig>;

/**
 * `w_i` rationale, in the order the sources are trusted:
 *
 * - `regex` 1.0 — a Verhoeff-valid Aadhaar or a Luhn-valid card is not an opinion.
 *   The per-detection `c_i` still separates a checksum (0.99) from a bare pattern (0.85).
 * - `ner` 0.9 — measured span F1 0.958, precision 1.00 on the generator held-out set.
 *   It is right when it fires; it does not always fire (STREET_ADDRESS recall 0.84).
 *   Below 1.0 because it is a model, not an arithmetic identity.
 * - `ocr` 0.8 — recognition error compounds: a misread digit breaks a checksum, and
 *   the box round-trips only to ±3px, so the spatial join is looser too.
 * - `vision` 0.5 — no trained detector exists yet, and this is the adversarial case.
 *   A low weight bounds how much a compromised detector can contribute; noisy-OR
 *   guarantees the contribution can only ever be toward redaction.
 * - `deterministic` 1.0 — the coverage pass. Its `c_i` is `unexplained_prior`, so
 *   the profile's stated 0.8 / 0.4 / 0.1 is exactly the term that enters the product.
 */
const STRICT_FUSION: FusionConfig = {
  source_weights: { regex: 1.0, ner: 0.9, ocr: 0.8, vision: 0.5, deterministic: 1.0 },
  min_coverage: 0.98,
};

export const STRICT: Profile = {
  policy: {
    name: 'STRICT',
    unexplained_prior: 0.8,
    screenshot: { enabled: false },
    thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
    tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'TOKENIZE', T4: 'ANNOTATE', T5: 'TOKENIZE' },
    ...SHARED,
  },
  fusion: STRICT_FUSION,
};

export const BALANCED: Profile = {
  policy: {
    ...STRICT.policy,
    name: 'BALANCED',
    unexplained_prior: 0.4,
    screenshot: { enabled: true },
    tiers: { ...STRICT.policy.tiers, T3: 'GENERALIZE' },
  },
  fusion: { ...STRICT_FUSION, min_coverage: 0.9 },
};

export const PERMISSIVE: Profile = {
  policy: {
    ...STRICT.policy,
    name: 'PERMISSIVE',
    unexplained_prior: 0.1,
    screenshot: { enabled: true },
    thresholds: { tokenize: 0.6, mask: 0.8, drop: 0.95 },
    tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'PASS', T4: 'ANNOTATE', T5: 'TOKENIZE' },
  },
  fusion: { ...STRICT_FUSION, min_coverage: 0.75 },
};

export const PROFILES: Record<PolicyProfile, Profile> = { STRICT, BALANCED, PERMISSIVE };

export interface Decision {
  action: Transformation;
  /** Human-readable, and the only redaction rationale that reaches the audit record. */
  reason: string;
  threshold_matched: string;
}

/**
 * Sensitivity → transformation.
 *
 * Comparisons are `>=`, so a score sitting exactly on a threshold takes the
 * stricter side. Ties break toward redaction.
 */
export function decide(
  profile: Profile,
  input: { sensitivity: number; cause: string; piiType?: PiiType; tier?: number }
): Decision {
  const { thresholds, tiers } = profile.policy;
  const { sensitivity, cause, tier } = input;

  if (tier === 1) return say('VAULT_ONLY', 'tier1', `tier-1 secret, ${cause}`);
  if (sensitivity >= thresholds.drop) return say('DROP', 'drop', cause);
  if (sensitivity >= thresholds.mask) return say('MASK', 'mask', cause);
  if (sensitivity >= thresholds.tokenize) return say('TOKENIZE', 'tokenize', cause);

  const tierKey = `T${tier ?? 3}` as keyof typeof tiers;
  const fallback = tiers[tierKey] ?? 'PASS';
  // ANNOTATE is not a payload transformation — the content passes, carrying a note.
  const action: Transformation = fallback === 'ANNOTATE' ? 'PASS' : fallback;
  return say(action, 'below_tokenize', cause);
}

function say(action: Transformation, threshold: string, cause: string): Decision {
  return { action, reason: `${action}: ${cause}`, threshold_matched: threshold };
}

/** Tier for a schema PII type. Tier 1 never leaves the vault, whatever the score. */
export function tierForType(piiType: PiiType): number {
  if (piiType === 'PASSWORD' || piiType === 'CREDIT_CARD' || piiType === 'SSN' || piiType === 'API_KEY' || piiType === 'TOKEN') return 1;
  if (piiType === 'EMAIL' || piiType === 'PHONE' || piiType === 'ADDRESS' || piiType === 'NAME' || piiType === 'FINANCIAL' || piiType === 'HEALTH') return 2;
  return 3;
}
