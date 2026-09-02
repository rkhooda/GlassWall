// Validator hooks (C8): the two rungs of the action validator that need privacy state.
// Violations name types and handles, never values (hard rule 5).
import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { PiiType } from '@glasswall/schema/policy';
import { ok, err, type Violation, type Result, type SecretRegistry } from '@glasswall/schema/branded';
import { normalize } from './registry/normalize';
import { generateEncodings } from './registry/encodings';
import { generateNgrams } from './registry/ngram';
import { extractPiiTypeFromHandle, isBindingAllowed } from './resolve';

export interface Action {
  type: string;
  target?: { id: string; id_hash: string };
  value?: { kind: string; handle?: string; text?: string };
}

/** Rung 7: a vault handle may only be typed into a field whose class accepts it. */
export function checkVaultTypeMatch(action: Action, obs: SanitizedObservation): Result<void, Violation> {
  if (action.type !== 'TYPE' || !action.target || action.value?.kind !== 'vault_ref') return ok(undefined);
  const target = obs.elements.find(e => e.id === action.target!.id);
  if (!target) return err({ code: 'UNKNOWN_TARGET', message: `Target ${action.target.id} not in observation`, details: { targetId: action.target.id } });
  const handle = action.value.handle;
  if (!handle) return ok(undefined);
  const handleType = extractPiiTypeFromHandle(handle);
  if (handleType === 'NONE') return err({ code: 'VAULT_TYPE_MISMATCH', message: `Malformed vault handle`, details: { handle } });
  const cls = target.sensitivity_class as PiiType | undefined;
  if (!isBindingAllowed(handleType, { element_id: target.id, sensitivity_class: cls, accepts: cls && cls !== 'NONE' ? [cls] : [] })) {
    return err({
      code: 'VAULT_TYPE_MISMATCH',
      message: `Blocked: ${handleType} handle bound into ${target.id} (${cls ?? 'unclassified'} "${target.label_raw.slice(0, 40)}")`,
      details: { handle, targetElementId: target.id, targetClass: cls ?? null, actualType: handleType },
    });
  }
  return ok(undefined);
}

/** Rung 8: a literal the planner wants typed must not contain a registered secret in any encoding. */
export function scanLiteralAgainstRegistry(text: string, registry: SecretRegistry): Result<void, Violation> {
  const normalizedText = normalize(text);
  for (const entry of registry.values()) {
    const secret = entry.normalized_value;
    if (secret.length < 4) continue;
    for (const form of [secret, ...generateEncodings(secret)]) {
      if (normalizedText.includes(form) || text.includes(form)) {
        return err({ code: 'LITERAL_CONTAINS_SECRET', message: `Literal contains a registered ${entry.pii_type}`, details: { piiType: entry.pii_type, handle: entry.handle } });
      }
    }
    if (secret.length >= 8) {
      const grams = generateNgrams(secret, 8);
      const textGrams = new Set(generateNgrams(normalizedText, 8));
      const overlap = grams.filter(g => textGrams.has(g)).length;
      if (overlap > 0 && overlap / grams.length > 0.7) {
        return err({ code: 'LITERAL_CONTAINS_SECRET', message: `Literal overlaps a registered ${entry.pii_type}`, details: { piiType: entry.pii_type, handle: entry.handle, overlap: overlap / grams.length } });
      }
    }
  }
  return ok(undefined);
}
