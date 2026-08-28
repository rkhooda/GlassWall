import { z } from 'zod';
import { PiiType } from './policy';

export const DetectionSchema = z.object({
  type: z.enum(['regex', 'ner', 'ocr', 'vision', 'deterministic']),
  pii_type: z.enum([
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
  ]),
  confidence: z.number().min(0).max(1),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  text_span: z.string().optional(),
  source_id: z.string(),
});
export type Detection = z.infer<typeof DetectionSchema>;

export const PolicyDecisionSchema = z.object({
  pii_type: z.enum([
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
  ]),
  action: z.enum(['PASS', 'GENERALIZE', 'TOKENIZE', 'MASK', 'DROP', 'VAULT_ONLY']),
  threshold_matched: z.string(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const EgressCheckSchema = z.object({
  check: z.enum([
    'secret_registry_raw',
    'secret_registry_normalized',
    'secret_registry_url_encoded',
    'secret_registry_base64',
    'secret_registry_hex',
    'secret_registry_html_entity',
    'payload_size',
  ]),
  passed: z.boolean(),
  matched_value: z.string().optional(),
});
export type EgressCheck = z.infer<typeof EgressCheckSchema>;

export const TimingsSchema = z.object({
  rules: z.number(),
  ner: z.number(),
  ocr: z.number(),
  vision: z.number(),
  fuse: z.number(),
  build: z.number(),
});
export type Timings = z.infer<typeof TimingsSchema>;

export const AuditRecordSchema = z
  .object({
    session_id: z.string(),
    step: z.number(),
    ts: z.number(),
    action: z.string(),
    latency_ms: z.number(),
    observation: z.object({
      element_count: z.number(),
      text_block_count: z.number(),
      handle_count: z.number(),
      has_redacted_screenshot: z.boolean(),
    }),
    detections: z.array(DetectionSchema),
    policy: z.array(PolicyDecisionSchema),
    egress: z.array(EgressCheckSchema),
    timings: TimingsSchema,
    degraded: z.array(z.string()),
    payload_hash: z.string(),
  })
  .strict();
export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export const AuditPrivacyFieldsSchema = z.object({
  detections: z.array(DetectionSchema),
  policy: z.array(PolicyDecisionSchema),
  egress: z.array(EgressCheckSchema),
  timings: TimingsSchema,
  degraded: z.array(z.string()),
});
export type AuditPrivacyFields = z.infer<typeof AuditPrivacyFieldsSchema>;
