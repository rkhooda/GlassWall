import { SanitizedObservation } from '@glasswall/schema/observation';
import { PiiType } from '@glasswall/schema/policy';
import { Violation, Result, ok, err, SecretRegistry } from '@glasswall/schema/branded';
import { normalize } from './registry/normalize';
import { encodeAllForms } from './registry/encodings';

export interface Action {
  type: string;
  target?: {
    id: string;
    id_hash: string;
  };
  value?: {
    kind: string;
    handle?: string;
  };
}

export function checkVaultTypeMatch(
  action: Action,
  obs: SanitizedObservation
): Result<void, Violation> {
  if (action.type !== 'TYPE' || !action.target || action.value?.kind !== 'vault_ref') {
    return ok(undefined);
  }

  const targetElement = obs.elements.find(e => e.id === action.target!.id);
  if (!targetElement) {
    return err({
      code: 'UNKNOWN_TARGET',
      message: `Target element ${action.target.id} not found in observation`,
      details: { targetId: action.target.id },
    });
  }

  const handle = action.value.handle;
  if (!handle) {
    return ok(undefined);
  }

  const handleType = extractPiiTypeFromHandle(handle);
  if (handleType === 'NONE') {
    return ok(undefined);
  }

  const acceptedTypes = targetElement.sensitivity_class
    ? [targetElement.sensitivity_class as PiiType]
    : [];

  if (acceptedTypes.length > 0 && !acceptedTypes.includes(handleType)) {
    return err({
      code: 'VAULT_TYPE_MISMATCH',
      message: `Potential exfiltration attempt: vault handle ${handle} (${handleType}) bound into ${targetElement.sensitivity_class} field`,
      details: {
        handle,
        targetElementId: targetElement.id,
        targetElementLabel: targetElement.label_raw,
        expectedTypes: acceptedTypes,
        actualType: handleType,
      },
    });
  }

  return ok(undefined);
}

export function scanLiteralAgainstRegistry(
  text: string,
  registry: SecretRegistry
): Result<void, Violation> {
  const normalizedText = normalize(text);
  const encodedForms = encodeAllForms(normalizedText);

  for (const entry of registry.values()) {
    const secretNormalized = entry.normalized_value;
    const secretEncoded = encodeAllForms(secretNormalized);

    for (const form of secretEncoded) {
      if (normalizedText.includes(form) || text.includes(form)) {
        return err({
          code: 'SECRET_IN_LITERAL',
          message: `Literal contains registered secret (${entry.pii_type}) in ${form.startsWith('%') ? 'URL-encoded' : form.startsWith('&#') ? 'HTML-entity' : form.length > 50 ? 'base64' : 'raw'} form`,
          details: {
            piiType: entry.pii_type,
            handle: entry.handle,
            matchedForm: form,
            textPreview: text.slice(0, 100),
          },
        });
      }
    }

    if (secretNormalized.length >= 6) {
      const secretNgrams = getNgrams(secretNormalized, 8);
      const textNgrams = getNgrams(normalizedText, 8);
      const overlap = secretNgrams.filter(n => textNgrams.includes(n)).length;
      if (overlap > 0 && overlap / secretNgrams.length > 0.7) {
        return err({
          code: 'SECRET_PARTIAL_MATCH',
          message: `Literal contains partial match (${overlap}/${secretNgrams.length} 8-grams) for registered ${entry.pii_type}`,
          details: {
            piiType: entry.pii_type,
            handle: entry.handle,
            overlapRatio: overlap / secretNgrams.length,
            textPreview: text.slice(0, 100),
          },
        });
      }
    }
  }

  return ok(undefined);
}

function extractPiiTypeFromHandle(handle: string): PiiType {
  const match = handle.match(/⟦([^#]+)(?:#|⟧)/);
  if (match) return match[1] as PiiType;
  return 'NONE';
}

function getNgrams(text: string, n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.push(text.slice(i, i + n));
  }
  return ngrams;
}