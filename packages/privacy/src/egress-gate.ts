// The egress gate: the last thing between the sanitizer and the network.
//
// Pure, synchronous, fail-closed. Seven checks in order; the first failure returns a
// Violation that names a PII type, never a value. Only this function constructs a
// SafePayload, and net.ts accepts nothing else.
import type { SafePayload, Violation, Result, SecretRegistry } from '@glasswall/schema/branded';
import type { PolicyConfig } from '@glasswall/schema/policy';
import { SessionRequestSchema, StepRequestSchema, GATEWAY_PATHS } from '@glasswall/schema/transport';
import { normalize } from './registry/normalize';
import { generateEncodings } from './registry/encodings';
import { generateNgrams } from './registry/ngram';
import { AhoCorasick } from './registry/registry';
import { recognizeText } from './recognizers';

export type GatePolicy = PolicyConfig;

export type OutboundRequest =
  | { path: typeof GATEWAY_PATHS.session; body: unknown }
  | { path: typeof GATEWAY_PATHS.step; body: unknown }
  | { path: typeof GATEWAY_PATHS.health; body?: undefined };

const MIN_SECRET_LENGTH = 6;
const NGRAM_SIZE = 8;
const ENTROPY_THRESHOLD = 4.0;
const ENTROPY_MIN_LENGTH = 24;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_SENDS = 90;
const HANDLE_RE = /^⟦[A-Z_]+(#\d+)?⟧$/;
const HANDLE_TOKEN_RE = /⟦[A-Z_]+(?:#\d+)?⟧/g;
const PROTOCOL_LABEL_PATH = /(?:^|\.)(type|kind|source|sensitivity_class|pii_type|origin_class|type_hint|policy_profile)$/;
/** Recognizer tiers 1–2 are checksum- or shape-verified identifiers: a hit is a leak. */
const SWEEP_TIERS = new Set([1, 2]);

const violation = (code: string, message: string, details: Record<string, unknown> = {}): Violation => ({ code, message, details });

function extractStrings(obj: unknown, path = '', out: { value: string; path: string }[] = []): { value: string; path: string }[] {
  if (typeof obj === 'string') out.push({ value: obj, path });
  else if (Array.isArray(obj)) obj.forEach((v, i) => extractStrings(v, `${path}[${i}]`, out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) extractStrings(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** Fields that legitimately hold long opaque strings. */
const OPAQUE_FIELDS = /(^|\.)(data_base64|session_id|observation_id|id_hash)$/;

// 1 — schema conformance, strict at every level
function checkSchema(request: OutboundRequest): Violation | null {
  const schema = request.path === GATEWAY_PATHS.session ? SessionRequestSchema : request.path === GATEWAY_PATHS.step ? StepRequestSchema : null;
  if (!schema) return request.body === undefined ? null : violation('SCHEMA_CONFORMANCE', `${request.path} takes no body`);
  const parsed = schema.safeParse(request.body);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return violation('SCHEMA_CONFORMANCE', `Schema validation failed at ${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'invalid'}`, { issues: parsed.error.issues.length });
}

// 2 — recognizer sweep: no released string may still match a tier-1/2 recognizer, and handles must be well-formed
function checkRecognizerSweep(body: unknown): Violation | null {
  for (const { value, path } of extractStrings(body)) {
    if (!value || OPAQUE_FIELDS.test(path)) continue;
    if (HANDLE_RE.test(value)) continue;
    if (path.endsWith('.handle') && !HANDLE_RE.test(value)) return violation('TYPE_BRAND', `Malformed handle at ${path}`, { path });
    // Every tier-1/2 identifier carries a digit or an '@' (or is a long token); skip plain words.
    if (value.length < 6 || !(/[\d@]/.test(value) || (value.length >= 16 && /[_-]/.test(value)))) continue;
    for (const span of recognizeText(value)) {
      if (SWEEP_TIERS.has(span.tier)) return violation('TYPE_BRAND', `Unredacted ${span.type} at ${path}`, { path, pii_type: span.type });
    }
  }
  return null;
}

// 3 — registry scan: raw, normalized, nine encodings, 8-gram partial overlap
interface ScanIndex { size: number; automaton: AhoCorasick; byPattern: Map<string, string> }
const indexes = new WeakMap<SecretRegistry, ScanIndex>();
function indexFor(registry: SecretRegistry): ScanIndex {
  const cached = indexes.get(registry);
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
  const built = { size: registry.size, automaton: new AhoCorasick(patterns), byPattern };
  indexes.set(registry, built);
  return built;
}

function checkRegistry(body: unknown, registry: SecretRegistry): Violation | null {
  if (registry.size === 0) return null;
  // Scan the released strings one by one, normalized. Scanning each string separately
  // keeps an n-gram from straddling two unrelated values, and lets the violation name
  // the path of the offending field (never its content).
  // Handles are safe by construction, but their type name can also be a registry
  // value (for example a detector may register "personal"). Remove only complete,
  // well-shaped handles before scanning so the gate does not match a secret against
  // the safe token it just emitted.
  const strings = extractStrings(body)
    .filter(s => s.value.length >= 4)
    .filter(s => !PROTOCOL_LABEL_PATH.test(s.path))
    .map(s => ({ path: s.path, text: normalize(s.value.replace(HANDLE_TOKEN_RE, ' ')) }));
  const { automaton, byPattern } = indexFor(registry);
  for (const { path, text } of strings) {
    const hit = automaton.search(text)[0];
    if (hit) return violation('REGISTRY_SCAN', `Registry secret found at ${path}: ${byPattern.get(hit.pattern) ?? 'UNKNOWN'}`, { path, pii_type: byPattern.get(hit.pattern) });
  }
  // Partial-overlap detection is for identifiers (tier 1–2: emails, phones, ids,
  // cards), whose fragments are distinctive. Fragments of names and addresses are
  // ordinary words and would refuse ordinary pages.
  const grams = new Map<string, string>();
  for (const { path, text } of strings) for (const g of generateNgrams(text, NGRAM_SIZE)) if (!grams.has(g)) grams.set(g, path);
  for (const entry of registry.values()) {
    if (entry.normalized_value.length < NGRAM_SIZE || entry.tier > 2) continue;
    const gram = generateNgrams(entry.normalized_value, NGRAM_SIZE).find(g => grams.has(g));
    if (gram) return violation('REGISTRY_SCAN', `Partial secret overlap (8-gram) at ${grams.get(gram)}: ${entry.pii_type}`, { path: grams.get(gram), pii_type: entry.pii_type });
  }
  return null;
}

// 4 — entropy heuristic for keys and tokens that no recognizer names
function shannon(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
function checkEntropy(body: unknown): Violation | null {
  for (const { value, path } of extractStrings(body)) {
    if (OPAQUE_FIELDS.test(path) || /\s/.test(value) || /⟦/.test(value)) continue;
    if (/^https?:\/\//.test(value)) continue;
    // A path is judged segment by segment: "/shoplite/checkout/confirm" is words, a
    // 40-character random segment is a token.
    const tokens = value.includes('/') ? value.split('/') : [value];
    for (const token of tokens) {
      if (token.length < ENTROPY_MIN_LENGTH) continue;
      if (shannon(token) > ENTROPY_THRESHOLD) return violation('ENTROPY_HEURISTIC', `High-entropy token at ${path}: possible key passthrough`, { path, length: token.length });
    }
  }
  return null;
}

// 5 — size budget
function checkSize(body: unknown, policy: GatePolicy): Violation | null {
  const bytes = body === undefined ? 0 : new TextEncoder().encode(JSON.stringify(body)).length;
  const limit = policy.max_payload_bytes ?? 250 * 1024;
  return bytes > limit ? violation('SIZE_BUDGET', `Payload of ${bytes} bytes exceeds ${limit}`, { bytes, limit }) : null;
}

// 6 — rate limit: a runaway loop must not hammer the gateway
const sendTimes: number[] = [];
function checkRate(now: number): Violation | null {
  while (sendTimes.length && now - sendTimes[0]! > RATE_WINDOW_MS) sendTimes.shift();
  if (sendTimes.length >= RATE_MAX_SENDS) return violation('RATE_LIMIT', `More than ${RATE_MAX_SENDS} sends per minute`, { window_ms: RATE_WINDOW_MS });
  return null;
}
export function resetRateLimitForTests(): void {
  sendTimes.length = 0;
}

// 7 — destination pin
function checkDestination(destination: string, policy: GatePolicy): Violation | null {
  if (!policy.gateway_origin) return violation('DESTINATION_PIN', 'Policy has no gateway_origin');
  let origin: string;
  try {
    origin = new URL(destination).origin;
  } catch {
    return violation('DESTINATION_PIN', 'Destination is not a URL');
  }
  return origin === new URL(policy.gateway_origin).origin ? null : violation('DESTINATION_PIN', `Destination ${origin} is not the configured gateway`, { destination: origin });
}

const CHECK_NAMES = ['schema', 'registry', 'sweep', 'entropy', 'size', 'rate', 'destination'] as const;
let lastTimings: Record<string, number> = {};
/** Per-check durations of the most recent egressGate() call, for the trace UI. */
export function lastGateTimings(): Record<string, number> {
  return { ...lastTimings };
}

export function egressGate(request: OutboundRequest, registry: SecretRegistry, policy: GatePolicy, destination: string = policy.gateway_origin ?? ''): Result<SafePayload, Violation> {
  const checks: (() => Violation | null)[] = [
    () => checkSchema(request),
    () => checkRegistry(request.body, registry),
    () => checkRecognizerSweep(request.body),
    () => checkEntropy(request.body),
    () => checkSize(request.body, policy),
    () => checkRate(Date.now()),
    () => checkDestination(destination, policy),
  ];
  lastTimings = {};
  for (let i = 0; i < checks.length; i++) {
    const started = performance.now();
    const v = checks[i]!();
    lastTimings[CHECK_NAMES[i]!] = performance.now() - started;
    if (v) return { ok: false, error: v };
  }
  sendTimes.push(Date.now());
  const safe: SafePayload = {
    __safePayloadBrand: '__safePayloadBrand',
    destination: new URL(destination).origin,
    path: request.path,
    method: request.body === undefined ? 'GET' : 'POST',
    body: request.body,
  };
  return { ok: true, value: safe };
}
