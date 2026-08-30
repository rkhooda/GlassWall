// C6 CONTRACT: egressGate() - B's function, A's single call site
// This is a stub until B7 (P7) — the real implementation with all 7 checks

import { SafePayload, Violation, Result, SecretRegistry } from '@glasswall/schema/branded';
import { PolicyConfig } from '@glasswall/schema/policy';

export function egressGate(
  payload: unknown,
  registry: SecretRegistry,
  policy: PolicyConfig
): Result<SafePayload, Violation> {
  const payloadStr = JSON.stringify(payload);

  if (payloadStr.length > 250 * 1024) {
    return {
      ok: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Payload exceeds ${250 * 1024} byte limit`,
        details: { size: payloadStr.length, limit: 250 * 1024 },
      },
    };
  }

  const safePayload = { __safePayloadBrand: '__safePayloadBrand' as const };
  return { ok: true, value: safePayload };
}