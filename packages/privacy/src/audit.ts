import type {
  AuditPrivacyFields,
  Detection,
  EgressCheck,
  PolicyDecision,
  RedactionReason,
  Timings,
} from '@glasswall/schema/audit';
import { normalize } from './registry/normalize';
import { generateEncodings } from './registry/encodings';

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
          // The offending string is deliberately not included: an error message is a log.
          throw new Error(`Audit field ${path} appears to contain a raw value`);
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

    const encoded = generateEncodings(secretNormalized);
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
