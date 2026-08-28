import { z } from 'zod';

export const PolicyProfileSchema = z.enum(['STRICT', 'BALANCED', 'PERMISSIVE']);
export type PolicyProfile = z.infer<typeof PolicyProfileSchema>;

export const PiiTypeSchema = z.enum([
  'EMAIL',
  'PHONE',
  'SSN',
  'CREDIT_CARD',
  'ADDRESS',
  'NAME',
  'USERNAME',
  'PASSWORD',
  'API_KEY',
  'TOKEN',
  'PERSONAL',
  'FINANCIAL',
  'HEALTH',
  'NONE'
]);
export type PiiType = z.infer<typeof PiiTypeSchema>;

export const ScreenshotPolicySchema = z.object({
  enabled: z.boolean(),
});
export type ScreenshotPolicy = z.infer<typeof ScreenshotPolicySchema>;

export const ThresholdsSchema = z.object({
  tokenize: z.number().min(0).max(1),
  mask: z.number().min(0).max(1),
  drop: z.number().min(0).max(1),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

export const TierPolicySchema = z.object({
  T1: z.enum(['VAULT_ONLY']),
  T2: z.enum(['TOKENIZE', 'PASS', 'GENERALIZE', 'MASK', 'DROP']),
  T3: z.enum(['TOKENIZE', 'PASS', 'GENERALIZE', 'MASK', 'DROP']),
  T4: z.enum(['ANNOTATE', 'PASS', 'TOKENIZE', 'MASK', 'DROP']),
  T5: z.enum(['TOKENIZE', 'PASS', 'GENERALIZE', 'MASK', 'DROP']),
});
export type TierPolicy = z.infer<typeof TierPolicySchema>;

export const UrlPolicySchema = z.object({
  query: z.enum(['DROP', 'KEEP']),
  fragment: z.enum(['DROP', 'KEEP']),
  path: z.enum(['TEMPLATE', 'KEEP', 'DROP']),
});
export type UrlPolicy = z.infer<typeof UrlPolicySchema>;

export const PolicyConfigSchema = z
  .object({
    name: PolicyProfileSchema,
    unexplained_prior: z.number().min(0).max(1),
    screenshot: ScreenshotPolicySchema,
    thresholds: ThresholdsSchema,
    tiers: TierPolicySchema,
    url: UrlPolicySchema,
    text_block_max_chars: z.number().positive(),
    fail_mode: z.literal('CLOSED'),
    high_risk_actions: z.array(z.string()),
    require_confirmation: z.array(z.string()),
    max_elements: z.number().positive().default(400),
  })
  .strict();
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

// Policy is the configuration that governs privacy processing
export type Policy = PolicyConfig;

export const STRICT_POLICY: PolicyConfig = {
  name: 'STRICT',
  unexplained_prior: 0.8,
  screenshot: { enabled: false },
  thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
  tiers: {
    T1: 'VAULT_ONLY',
    T2: 'TOKENIZE',
    T3: 'TOKENIZE',
    T4: 'ANNOTATE',
    T5: 'TOKENIZE',
  },
  url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
  text_block_max_chars: 400,
  fail_mode: 'CLOSED',
  high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
  require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
  max_elements: 400,
};

export const BALANCED_POLICY: PolicyConfig = {
  ...STRICT_POLICY,
  name: 'BALANCED',
  unexplained_prior: 0.4,
  screenshot: { enabled: true },
  tiers: {
    ...STRICT_POLICY.tiers,
    T3: 'GENERALIZE',
  },
};

export const PERMISSIVE_POLICY: PolicyConfig = {
  ...STRICT_POLICY,
  name: 'PERMISSIVE',
  unexplained_prior: 0.1,
  screenshot: { enabled: true },
  thresholds: { tokenize: 0.6, mask: 0.8, drop: 0.95 },
  tiers: {
    T1: 'VAULT_ONLY',
    T2: 'TOKENIZE',
    T3: 'PASS',
    T4: 'ANNOTATE',
    T5: 'TOKENIZE',
  },
};

export const POLICY_PRESETS = {
  STRICT: STRICT_POLICY,
  BALANCED: BALANCED_POLICY,
  PERMISSIVE: PERMISSIVE_POLICY,
} as const;
