import type { SecretRegistry } from '@glasswall/schema/branded';
import { normalize } from './registry/normalize';
import { createHmac } from 'crypto';

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
    const normalized = normalize(value);
    const hmac = createHmac('sha256', this.config.sessionSalt);
    hmac.update(normalized);
    const hash = hmac.digest('hex');

    const existing = this.handleCounter.get(hash);
    let idx: number;
    if (existing !== undefined) {
      idx = existing;
    } else {
      idx = this.handleCounter.size + 1;
      this.handleCounter.set(hash, idx);
    }

    if (tier === 1) {
      return `${HANDLE_PREFIX}${type}${HANDLE_SUFFIX}`;
    }
    return `${HANDLE_PREFIX}${type}#${idx}${HANDLE_SUFFIX}`;
  }

  getHandleCounter(): Map<string, number> {
    return new Map(this.handleCounter);
  }

  reset(): void {
    this.handleCounter.clear();
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
