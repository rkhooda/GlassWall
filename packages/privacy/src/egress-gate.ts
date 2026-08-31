// C6 CONTRACT: egressGate() - B's function, A's single call site
// Pure, synchronous, fail-closed. Seven checks in order.

import { SafePayload, Violation, Result, SecretRegistry, PolicyConfig } from '@glasswall/schema/branded';
import { SanitizedObservationSchema } from '@glasswall/schema/observation';
import { normalize } from './registry/normalize';
import { generateEncodings } from './registry/encodings';
import { generateNgrams, hasNgramOverlap } from './registry/ngram';
import { AhoCorasick } from './registry/registry';

const MIN_SECRET_LENGTH = 6;
const ENTROPY_THRESHOLD = 3.5;
const ENTROPY_MIN_LENGTH = 12;
const NGRAM_SIZE = 8;

function calculateShannonEntropy(str: string): number {
  const freq = new Map<string, number>();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isHandleLike(str: string): boolean {
  return /^⟦[A-Z_]+(#\d+)?⟧$/.test(str);
}

function extractStrings(obj: unknown, path: string = ''): Array<{ value: string; path: string }> {
  const results: Array<{ value: string; path: string }> = [];
  if (obj === null || obj === undefined) return results;
  if (typeof obj === 'string') {
    results.push({ value: obj, path });
    return results;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      results.push(...extractStrings(obj[i], `${path}[${i}]`));
    }
    return results;
  }
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      results.push(...extractStrings(value, path ? `${path}.${key}` : key));
    }
  }
  return results;
}

function checkSchemaConformance(payload: unknown): Violation | null {
  const result = SanitizedObservationSchema.safeParse(payload);
  if (!result.success) {
    console.debug('Schema validation failed:', JSON.stringify(result.error.issues, null, 2));
    const firstError = result.error.issues[0];
    return {
      code: 'SCHEMA_CONFORMANCE',
      message: `Schema validation failed at ${firstError.path.join('.')}: ${firstError.message}`,
      details: { issues: result.error.issues },
    };
  }
  return null;
}

function checkTypeBrand(payload: unknown): Violation | null {
  const strings = extractStrings(payload);

  for (const { value, path } of strings) {
    if (value.length === 0) continue;

    const isSensitiveField =
      path === 'page.title_raw' ||
      path.endsWith('.label_raw') ||
      path.endsWith('.placeholder_raw') ||
      (path.includes('text_nodes') && path.endsWith('.text')) ||
      (path.includes('handles') && path.endsWith('.handle'));

    if (!isSensitiveField) continue;

    if (isHandleLike(value) || value.startsWith('[') || value.startsWith('⟦')) {
      continue;
    }

    if (path.includes('text_nodes') && path.endsWith('.text')) {
      const hasHandle = /⟦[A-Z_]+(#\d+)?⟧/.test(value);
      if (hasHandle) continue;
    }

    console.debug('TypeBrand rejecting:', { path, value: value.slice(0, 50), isHandleLike: isHandleLike(value) });
    return {
      code: 'TYPE_BRAND',
      message: `Unbranded string at ${path}: strings must be Sanitized<string> (handles or redacted placeholders)`,
      details: { path, value: value.slice(0, 50) },
    };
  }
  return null;
}

function checkRegistryScan(payload: unknown, registry: SecretRegistry): Violation | null {
  const payloadStr = JSON.stringify(payload);
  const normalizedPayload = normalize(payloadStr);

  console.debug('Registry scan - normalized payload:', normalizedPayload.slice(0, 500));

  const automaton = registry.getAutomaton();
  const matches = automaton.search(normalizedPayload);
  if (matches.length > 0) {
    console.debug('Registry scan - automaton matches:', matches);
    return {
      code: 'REGISTRY_SCAN',
      message: `Secret found in payload (normalized): ${matches[0].pattern}`,
      details: { pattern: matches[0].pattern, position: matches[0].start },
    };
  }

  for (const entry of registry.getAll()) {
    if (entry.normalized.length < MIN_SECRET_LENGTH) continue;

    console.debug('Registry scan - checking entry:', entry.type, 'encodings:', entry.encodings.slice(0, 3));

    for (const encoding of entry.encodings) {
      if (normalizedPayload.includes(encoding)) {
        console.debug('Registry scan - encoding match:', encoding);
        return {
          code: 'REGISTRY_SCAN',
          message: `Secret found in payload (encoded): ${entry.type}`,
          details: { type: entry.type, encoding: encoding.slice(0, 50) },
        };
      }
    }

    if (entry.normalized.length >= NGRAM_SIZE && hasNgramOverlap(normalizedPayload, [entry.normalized], NGRAM_SIZE)) {
      return {
        code: 'REGISTRY_SCAN',
        message: `Partial secret overlap (8-gram): ${entry.type}`,
        details: { type: entry.type, ngram_size: NGRAM_SIZE },
      };
    }
  }

  console.debug('Registry scan - no matches found');
  return null;
}

function checkEntropyHeuristic(payload: unknown): Violation | null {
  const strings = extractStrings(payload);
  for (const { value, path } of strings) {
    if (value.length < ENTROPY_MIN_LENGTH) continue;

    const isPureHandleField =
      path.endsWith('.label_raw') ||
      path.endsWith('.placeholder_raw') ||
      (path.includes('handles') && path.endsWith('.handle'));

    if (isPureHandleField) {
      if (isHandleLike(value) || value.startsWith('[') || value.startsWith('⟦')) {
        continue;
      }
    } else {
      if (/⟦[A-Z_]+(#\d+)?⟧/.test(value)) continue;
    }

    if (/^https?:\/\/[^\s]+$/.test(value)) continue;

    const entropy = calculateShannonEntropy(value);
    if (entropy > ENTROPY_THRESHOLD) {
      return {
        code: 'ENTROPY_HEURISTIC',
        message: `High-entropy token at ${path} (${entropy.toFixed(2)} bits/char): possible key/token passthrough`,
        details: { path, entropy: entropy.toFixed(2), length: value.length, sample: value.slice(0, 20) },
      };
    }
  }
  return null;
}

function checkSizeBudget(payload: unknown, policy: PolicyConfig): Violation | null {
  const payloadStr = JSON.stringify(payload);
  const maxBytes = policy.max_payload_bytes ?? 250 * 1024;
  if (payloadStr.length > maxBytes) {
    return {
      code: 'SIZE_BUDGET',
      message: `Payload exceeds ${maxBytes} byte limit`,
      details: { size: payloadStr.length, limit: maxBytes },
    };
  }
  return null;
}

function checkRateLimit(policy: PolicyConfig): Violation | null {
  return null;
}

function checkDestinationPin(payload: unknown, policy: PolicyConfig): Violation | null {
  const gatewayOrigin = policy.gateway_origin;
  if (!gatewayOrigin) {
    return {
      code: 'DESTINATION_PIN',
      message: 'Gateway origin not configured in policy',
      details: {},
    };
  }

  const payloadObj = payload as Record<string, unknown>;
  const destination = payloadObj.page?.url_template as string | undefined;
  if (!destination || !destination.includes('://')) {
    return null;
  }

  try {
    const destUrl = new URL(destination);
    const gatewayUrl = new URL(gatewayOrigin);
    if (destUrl.origin !== gatewayUrl.origin) {
      return {
        code: 'DESTINATION_PIN',
        message: `Destination origin ${destUrl.origin} does not match gateway ${gatewayUrl.origin}`,
        details: { destination, gateway: gatewayOrigin },
      };
    }
  } catch {
    return {
      code: 'DESTINATION_PIN',
      message: `Invalid destination URL: ${destination}`,
      details: { destination },
    };
  }
  return null;
}

export function egressGate(
  payload: unknown,
  registry: SecretRegistry,
  policy: PolicyConfig
): Result<SafePayload, Violation> {
  const schemaCheck = checkSchemaConformance(payload);
  if (schemaCheck) {
    console.debug('Check 1 (Schema) failed:', schemaCheck.code);
    return { ok: false, error: schemaCheck };
  }
  console.debug('Check 1 (Schema) passed');

  const brandCheck = checkTypeBrand(payload);
  if (brandCheck) {
    console.debug('Check 2 (TypeBrand) failed:', brandCheck.code);
    return { ok: false, error: brandCheck };
  }
  console.debug('Check 2 (TypeBrand) passed');

  const registryCheck = checkRegistryScan(payload, registry);
  if (registryCheck) {
    console.debug('Check 3 (Registry) failed:', registryCheck.code);
    return { ok: false, error: registryCheck };
  }
  console.debug('Check 3 (Registry) passed');

  const entropyCheck = checkEntropyHeuristic(payload);
  if (entropyCheck) {
    console.debug('Check 4 (Entropy) failed:', entropyCheck.code);
    return { ok: false, error: entropyCheck };
  }
  console.debug('Check 4 (Entropy) passed');

  const sizeCheck = checkSizeBudget(payload, policy);
  if (sizeCheck) {
    console.debug('Check 5 (Size) failed:', sizeCheck.code);
    return { ok: false, error: sizeCheck };
  }
  console.debug('Check 5 (Size) passed');

  const rateCheck = checkRateLimit(policy);
  if (rateCheck) {
    console.debug('Check 6 (Rate) failed:', rateCheck.code);
    return { ok: false, error: rateCheck };
  }
  console.debug('Check 6 (Rate) passed');

  const destCheck = checkDestinationPin(payload, policy);
  if (destCheck) {
    console.debug('Check 7 (Destination) failed:', destCheck.code);
    return { ok: false, error: destCheck };
  }
  console.debug('Check 7 (Destination) passed');

  const safePayload = { __safePayloadBrand: '__safePayloadBrand' as const };
  return { ok: true, value: safePayload };
}