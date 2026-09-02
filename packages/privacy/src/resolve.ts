// Deferred value binding (C7): the agent plans with ⟦EMAIL#1⟧; the extension resolves
// it here, locally, at execution time, and only into a field whose type accepts it.
// A hijacked planner asking for an Aadhaar in a search box is refused.
import type { PiiType } from '@glasswall/schema/policy';
import type { Sensitive } from './sensitive';
import type { VaultStore } from './vault';
import { normalizePiiType } from './pii-types';

export interface Violation {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export interface BindingTarget {
  element_id: string;
  /** From the sanitized element: what the field is for, per its autocomplete/type/label. */
  sensitivity_class: string | undefined;
  /** Types the field may receive; empty means "unclassified free-text field". */
  accepts: string[];
}

/** handle type → field types it may be typed into. Symmetric where the field is ambiguous. */
export const COMPATIBILITY_MATRIX: Partial<Record<PiiType, PiiType[]>> = {
  EMAIL: ['EMAIL', 'USERNAME'],
  PHONE: ['PHONE'],
  AADHAAR: ['AADHAAR'],
  PAN: ['PAN'],
  IFSC: ['IFSC'],
  GSTIN: ['GSTIN'],
  UPI: ['UPI'],
  CREDIT_CARD: ['CREDIT_CARD'],
  CVC: ['CVC'],
  OTP: ['OTP'],
  PASSWORD: ['PASSWORD'],
  SECRET: ['SECRET', 'PASSWORD'],
  PERSON_NAME: ['PERSON_NAME', 'NAME'],
  NAME: ['PERSON_NAME', 'NAME'],
  STREET_ADDRESS: ['STREET_ADDRESS', 'ADDRESS', 'POSTAL_CODE'],
  ADDRESS: ['STREET_ADDRESS', 'ADDRESS'],
  POSTAL_CODE: ['POSTAL_CODE', 'STREET_ADDRESS'],
  DOB: ['DOB'],
  IP: ['IP'],
  MRN: ['MRN'],
  ORGANIZATION: ['ORGANIZATION'],
};

/** Free-text fields (no classification) may receive tier-3 quasi-identifiers, never identifiers or secrets. */
const BINDABLE_INTO_UNCLASSIFIED = new Set<PiiType>(['PERSON_NAME', 'NAME', 'STREET_ADDRESS', 'ADDRESS', 'POSTAL_CODE', 'ORGANIZATION', 'PERSONAL']);

export function isBindingAllowed(handleType: string, target: BindingTarget): boolean {
  const type = normalizePiiType(handleType);
  const raw = target.accepts.length ? target.accepts : target.sensitivity_class && target.sensitivity_class !== 'none' ? [target.sensitivity_class] : [];
  const accepts = raw.map(a => normalizePiiType(a)).filter(a => a !== 'NONE');
  if (accepts.length === 0) return BINDABLE_INTO_UNCLASSIFIED.has(type);
  const allowed = COMPATIBILITY_MATRIX[type] ?? [type];
  return accepts.some(a => allowed.includes(a));
}

export async function resolveForBinding(handle: string, target: BindingTarget, vault: VaultStore): Promise<Result<Sensitive<string>, Violation>> {
  const entry = await vault.get(handle);
  if (!entry) return err({ code: 'HANDLE_NOT_FOUND', message: `Vault handle ${handle} not found`, details: { handle } });

  const handleType = normalizePiiType(entry.type);
  if (!isBindingAllowed(handleType, target)) {
    return err({
      code: 'VAULT_TYPE_MISMATCH',
      message: `Vault handle ${handle} (${handleType}) is not accepted by ${target.element_id} (${target.sensitivity_class ?? 'unclassified'})`,
      details: { handle, target: target.element_id, expected: target.accepts, actual: handleType },
    });
  }
  return ok({ __sensitiveBrand: '__sensitiveBrand', value: entry.value });
}

/** Both handle shapes parse: ⟦EMAIL#3⟧ (tier 2+) and ⟦PASSWORD⟧ (tier 1, no index). */
export function extractPiiTypeFromHandle(handle: string): PiiType {
  const match = handle.match(/⟦([^#⟧]+)[#⟧]/);
  return (match ? match[1] : 'NONE') as PiiType;
}
