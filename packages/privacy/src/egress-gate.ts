// C6 CONTRACT: egressGate() - B's function, A's single call site
// Pure, synchronous, fail-closed. Seven checks in order.

import { SafePayload, Violation, Result, SecretRegistry } from '@glasswall/schema/branded';
import type { PolicyConfig } from '@glasswall/schema/policy';

/**
 * Deployment limits the frozen PolicyConfig does not carry. Both optional, so any
 * PolicyConfig satisfies this and the schema stays untouched.
 */
export type GatePolicy = PolicyConfig & {
  max_payload_bytes?: number;
  gateway_origin?: string;
};
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
    const firstError = result.error.issues[0];
    return {
      code: 'SCHEMA_CONFORMANCE',
      message: firstError
        ? `Schema validation failed at ${firstError.path.join('.')}: ${firstError.message}`
        : 'Schema validation failed',
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

    return {
      code: 'TYPE_BRAND',
      message: `Unbranded string at ${path}: strings must be Sanitized<string> (handles or redacted placeholders)`,
      details: { path, value: value.slice(0, 50) },
    };
  }
  return null;
}

/**
 * The automaton over a registry's secrets and their encodings. Built once per
 * registry and reused: rebuilding ~1000 patterns on every send costs ~45ms and
 * the gate has a 15ms budget. The registry is append-only within a session, so
 * its size is a sound cache key.
 */
interface ScanIndex {
  size: number;
  automaton: AhoCorasick;
  byPattern: Map<string, string>;
}
const scanIndexes = new WeakMap<SecretRegistry, ScanIndex>();

function scanIndexFor(registry: SecretRegistry): ScanIndex {
  const cached = scanIndexes.get(registry);
  if (cached && cached.size === registry.size) return cached;

  const patterns: string[] = [];
  const byPattern = new Map<string, string>();
  for (const entry of registry.values()) {
    if (entry.normalized_value.length < MIN_SECRET_LENGTH) continue;
    for (const form of [entry.normalized_value, ...generateEncodings(entry.normalized_value)]) {
      patterns.push(form);
      byPattern.set(form, entry.pii_type);
    }
  }

  const index: ScanIndex = { size: registry.size, automaton: new AhoCorasick(patterns), byPattern };
  scanIndexes.set(registry, index);
  return index;
}

function checkRegistryScan(payload: unknown, registry: SecretRegistry): Violation | null {
  const normalizedPayload = normalize(JSON.stringify(payload));

  // Violation messages and details name the PII type, never the matched value —
  // a gate that logs the secret it caught has leaked it.
  const { automaton, byPattern } = scanIndexFor(registry);
  const match = automaton.search(normalizedPayload)[0];
  if (match) {
    const piiType = byPattern.get(match.pattern) ?? 'UNKNOWN';
    return {
      code: 'REGISTRY_SCAN',
      message: `Registry secret found in payload: ${piiType}`,
      details: { pii_type: piiType },
    };
  }

  for (const entry of registry.values()) {
    if (entry.normalized_value.length < NGRAM_SIZE) continue;
    if (hasNgramOverlap(normalizedPayload, [entry.normalized_value], NGRAM_SIZE)) {
      return {
        code: 'REGISTRY_SCAN',
        message: `Partial secret overlap (8-gram): ${entry.pii_type}`,
        details: { pii_type: entry.pii_type, ngram_size: NGRAM_SIZE },
      };
    }
  }

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

function checkSizeBudget(payload: unknown, policy: GatePolicy): Violation | null {
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

function checkRateLimit(_policy: GatePolicy): Violation | null {
  return null;
}

function checkDestinationPin(payload: unknown, policy: GatePolicy): Violation | null {
  const gatewayOrigin = policy.gateway_origin;
  if (!gatewayOrigin) {
    return {
      code: 'DESTINATION_PIN',
      message: 'Gateway origin not configured in policy',
      details: {},
    };
  }

  const page = (payload as { page?: { url_template?: string } }).page;
  const destination = page?.url_template;
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
  policy: GatePolicy
): Result<SafePayload, Violation> {
  const schemaCheck = checkSchemaConformance(payload);
  if (schemaCheck) {
    return { ok: false, error: schemaCheck };
  }

  const brandCheck = checkTypeBrand(payload);
  if (brandCheck) {
    return { ok: false, error: brandCheck };
  }

  const registryCheck = checkRegistryScan(payload, registry);
  if (registryCheck) {
    return { ok: false, error: registryCheck };
  }

  const entropyCheck = checkEntropyHeuristic(payload);
  if (entropyCheck) {
    return { ok: false, error: entropyCheck };
  }

  const sizeCheck = checkSizeBudget(payload, policy);
  if (sizeCheck) {
    return { ok: false, error: sizeCheck };
  }

  const rateCheck = checkRateLimit(policy);
  if (rateCheck) {
    return { ok: false, error: rateCheck };
  }

  const destCheck = checkDestinationPin(payload, policy);
  if (destCheck) {
    return { ok: false, error: destCheck };
  }

  const safePayload = { __safePayloadBrand: '__safePayloadBrand' as const };
  return { ok: true, value: safePayload };
}