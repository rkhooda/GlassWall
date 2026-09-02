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

/**
 * The audit record is content-free by construction; this asserts it. Only the fields
 * that could carry page text are inspected: a text_span must be a handle, a
 * matched_value must be a byte count, and degraded reasons are machine tokens.
 * Error messages never include the offending string — an error message is a log.
 */
export function assertNoValuesInAudit(fields: AuditPrivacyFields): void {
  const HANDLE = /^⟦[A-Z_]+(#\d+)?⟧$/;
  fields.detections.forEach((d, i) => {
    if (d.text_span !== undefined && !HANDLE.test(d.text_span)) throw new Error(`Audit detections[${i}].text_span is not a handle`);
    if (!/^[a-z0-9_-]+$/i.test(d.source_id)) throw new Error(`Audit detections[${i}].source_id is not an identifier`);
  });
  fields.egress.forEach((e, i) => {
    if (e.matched_value !== undefined && !/^\d+ bytes$/.test(e.matched_value)) throw new Error(`Audit egress[${i}].matched_value carries content`);
  });
  fields.degraded.forEach((d, i) => {
    if (!/^[a-z0-9_:-]+$/i.test(d)) throw new Error(`Audit degraded[${i}] is not a machine token`);
  });
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
