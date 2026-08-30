import { z } from 'zod';
import { PiiType } from './policy';

export const RedactionReasonSchema = z.object({
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  reason: z.string(),
  source: z.enum(['regex', 'ner', 'ocr', 'vision', 'deterministic']),
  score: z.number().min(0).max(1),
});
export type RedactionReason = z.infer<typeof RedactionReasonSchema>;

export const SanitizeResultSchema = z.object({
  observation: z.unknown(),
  redactions: z.array(RedactionReasonSchema),
  audit: z.unknown(),
  timings: z.object({
    rules: z.number(),
    ner: z.number(),
    ocr: z.number(),
    vision: z.number(),
    fuse: z.number(),
    build: z.number(),
  }),
  degraded: z.array(z.string()),
});
export type SanitizeResult = z.infer<typeof SanitizeResultSchema>;

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

export interface AuditPrivacyInput {
  observation: any;
  detections: Detection[];
  policyDecisions: PolicyDecision[];
  egressChecks: EgressCheck[];
  timings: Timings;
  degraded: string[];
  redactions: RedactionReason[];
}

export function buildAuditPrivacyFields(input: AuditPrivacyInput): AuditPrivacyFields {
  return {
    detections: input.detections.map(d => ({
      type: d.type,
      pii_type: d.pii_type,
      confidence: d.confidence,
      rect: d.rect,
      text_span: d.text_span,
      source_id: d.source_id,
    })),
    policy: input.policyDecisions.map(p => ({
      pii_type: p.pii_type,
      action: p.action,
      threshold_matched: p.threshold_matched,
    })),
    egress: input.egressChecks.map(e => ({
      check: e.check,
      passed: e.passed,
      matched_value: e.matched_value,
    })),
    timings: {
      rules: input.timings.rules,
      ner: input.timings.ner,
      ocr: input.timings.ocr,
      vision: input.timings.vision,
      fuse: input.timings.fuse,
      build: input.timings.build,
    },
    degraded: [...input.degraded],
  };
}

export function assertNoValuesInAudit(fields: AuditPrivacyFields): void {
  const checkObject = (obj: unknown, path: string): void => {
    if (obj === null || obj === undefined) return;

    if (typeof obj === 'string') {
      const handlePattern = /⟦[^⟧]+⟧/;
      if (!handlePattern.test(obj) && obj.length > 0) {
        const looksLikeValue = /[\w@.-]{6,}/.test(obj) &&
          !['PASS', 'GENERALIZE', 'TOKENIZE', 'MASK', 'DROP', 'VAULT_ONLY', 'ANNOTATE'].includes(obj) &&
          !['regex', 'ner', 'ocr', 'vision', 'deterministic'].includes(obj) &&
          !['secret_registry_raw', 'secret_registry_normalized', 'secret_registry_url_encoded', 'secret_registry_base64', 'secret_registry_hex', 'secret_registry_html_entity', 'payload_size'].includes(obj) &&
          !['EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD', 'ADDRESS', 'NAME', 'USERNAME', 'PASSWORD', 'API_KEY', 'TOKEN', 'PERSONAL', 'FINANCIAL', 'HEALTH', 'NONE'].includes(obj);
        if (looksLikeValue) {
          throw new Error(`Audit field ${path} appears to contain a raw value: ${obj.slice(0, 50)}`);
        }
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, idx) => checkObject(item, `${path}[${idx}]`));
    } else if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        checkObject(value, `${path}.${key}`);
      }
    }
  };

  checkObject(fields, 'AuditPrivacyFields');
}

export function createEgressChecks(
  payload: unknown,
  registry: Map<string, { handle: string; pii_type: string; tier: number; normalized_value: string }>,
  policy: { fail_mode: 'CLOSED' }
): EgressCheck[] {
  const checks: EgressCheck[] = [];

  const payloadStr = JSON.stringify(payload);
  const normalizedPayload = normalize(payloadStr);

  let registryRawPassed = true;
  let registryNormalizedPassed = true;
  let registryUrlEncodedPassed = true;
  let registryBase64Passed = true;
  let registryHexPassed = true;
  let registryHtmlEntityPassed = true;

  for (const entry of registry.values()) {
    const secretNormalized = entry.normalized_value;

    if (payloadStr.includes(secretNormalized)) {
      registryRawPassed = false;
    }
    if (normalizedPayload.includes(secretNormalized)) {
      registryNormalizedPassed = false;
    }

    const encoded = encodeAllForms(secretNormalized);
    for (const form of encoded) {
      if (payloadStr.includes(form)) {
        if (form.startsWith('%')) registryUrlEncodedPassed = false;
        else if (form.startsWith('&#') || form.startsWith('&')) registryHtmlEntityPassed = false;
        else if (/^[A-Za-z0-9+/]+={0,2}$/.test(form) && form.length % 4 === 0) registryBase64Passed = false;
        else if (/^[0-9a-fA-F]+$/.test(form)) registryHexPassed = false;
      }
    }
  }

  checks.push({ check: 'secret_registry_raw', passed: registryRawPassed });
  checks.push({ check: 'secret_registry_normalized', passed: registryNormalizedPassed });
  checks.push({ check: 'secret_registry_url_encoded', passed: registryUrlEncodedPassed });
  checks.push({ check: 'secret_registry_base64', passed: registryBase64Passed });
  checks.push({ check: 'secret_registry_hex', passed: registryHexPassed });
  checks.push({ check: 'secret_registry_html_entity', passed: registryHtmlEntityPassed });

  const maxSize = 250 * 1024;
  const sizePassed = payloadStr.length <= maxSize;
  checks.push({ check: 'payload_size', passed: sizePassed, matched_value: sizePassed ? undefined : `${payloadStr.length} bytes` });

  return checks;
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[-\s]/g, '')
    .trim();
}

function encodeAllForms(text: string): string[] {
  const forms: string[] = [text];

  try {
    forms.push(encodeURIComponent(text));
  } catch {}

  try {
    forms.push(btoa(text));
  } catch {}

  try {
    forms.push(Array.from(text).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  } catch {}

  try {
    forms.push(text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "&apos;"));
  } catch {}

  try {
    forms.push(text.replace(/[\s\S]/g, c => `&#${c.charCodeAt(0)};`));
  } catch {}

  return [...new Set(forms)];
}

export type { AuditPrivacyFields } from '@glasswall/schema/audit';