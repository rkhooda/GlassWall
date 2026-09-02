import type { SecretRegistry } from '@glasswall/schema/branded';
import { normalize } from './registry/normalize';

export interface TokenizerConfig {
  sessionSalt: string;
}

export interface TokenizerHandle {
  handle: string;
  type: string;
  tier: number;
}

const HANDLE_PREFIX = '⟦';
const HANDLE_SUFFIX = '⟧';

export class Tokenizer {
  private config: TokenizerConfig;
  private handleCounter = new Map<string, number>();

  constructor(config: TokenizerConfig) {
    this.config = config;
  }

  tokenize(value: string, type: string, tier: number): string {
    // The emitted handle is a per-session sequence number, so this map is only a
    // dictionary for "have I seen this value before". It never leaves the instance
    // and is never serialised, which is why a plain key is enough — and why the
    // node-only createHmac it used to call bought nothing but a broken browser build.
    const key = `${this.config.sessionSalt}\u0000${normalize(value)}`;

    let idx = this.handleCounter.get(key);
    if (idx === undefined) {
      idx = this.handleCounter.size + 1;
      this.handleCounter.set(key, idx);
    }

    if (tier === 1) {
      return `${HANDLE_PREFIX}${type}${HANDLE_SUFFIX}`;
    }
    return `${HANDLE_PREFIX}${type}#${idx}${HANDLE_SUFFIX}`;
  }

  /** How many distinct values this session has tokenized. Counts only — the keys
   *  are values and must never be handed out. */
  distinctValues(): number {
    return this.handleCounter.size;
  }

  reset(): void {
    this.handleCounter.clear();
  }

  /** For session persistence only (chrome.storage.session). Keys contain values. */
  exportCounter(): Array<[string, number]> {
    return [...this.handleCounter.entries()];
  }

  importCounter(entries: Array<[string, number]>): void {
    this.handleCounter = new Map(entries);
  }
}

export function createTokenizer(sessionSalt: string): Tokenizer {
  return new Tokenizer({ sessionSalt });
}

export function generateSessionSalt(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Tokenize a value and record it in the session registry, returning the handle.
 * The registry keeps the value so the egress gate can catch it if it ever escapes;
 * only the handle travels onward.
 */
export function tokenizeAndRegister(
  tokenizer: Tokenizer,
  registry: SecretRegistry,
  value: string,
  piiType: string,
  tier: number
): string {
  // One value, one handle: a second classification of a known value (NER calling a
  // CITY an ADDRESS) reuses the first. ponytail: linear scan, registries stay small.
  const normalized = normalize(value);
  for (const entry of registry.values()) if (entry.normalized_value === normalized) return entry.handle;
  const handle = tokenizer.tokenize(value, piiType, tier);
  if (!registry.has(handle)) {
    registry.set(handle, {
      handle,
      pii_type: piiType,
      tier,
      created_at: Date.now(),
      normalized_value: normalize(value),
    });
  }
  return handle;
}

/** The handle already issued for this value, or undefined if it was never registered. */
export function getHandleForValue(
  tokenizer: Tokenizer,
  registry: SecretRegistry,
  value: string,
  piiType: string,
  tier: number = 3
): string | undefined {
  const handle = tokenizer.tokenize(value, piiType, tier);
  return registry.has(handle) ? handle : undefined;
}
