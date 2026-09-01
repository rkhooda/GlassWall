import { Sensitive } from './sensitive';
import { VaultStore } from './vault';

export interface Violation {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type PiiType =
  | 'EMAIL'
  | 'PHONE'
  | 'AADHAAR'
  | 'PAN'
  | 'IFSC'
  | 'GSTIN'
  | 'UPI'
  | 'CARD'
  | 'IP'
  | 'DOB'
  | 'SECRET'
  | 'PASSWORD'
  | 'CREDIT_CARD'
  | 'CVC'
  | 'OTP'
  | 'STREET_ADDRESS'
  | 'POSTAL_CODE'
  | 'BDAY'
  | 'MRN';

export interface BindingTarget {
  element_id: string;
  sensitivity_class: PiiType | 'none';
  accepts: PiiType[];
}

const COMPATIBILITY_MATRIX: Record<string, PiiType[]> = {
  EMAIL: ['EMAIL'],
  PHONE: ['PHONE'],
  AADHAAR: ['AADHAAR'],
  PAN: ['PAN'],
  IFSC: ['IFSC'],
  GSTIN: ['GSTIN'],
  UPI: ['UPI'],
  CARD: ['CARD', 'CREDIT_CARD'],
  CREDIT_CARD: ['CARD', 'CREDIT_CARD'],
  CVC: ['CVC'],
  OTP: ['OTP'],
  PASSWORD: ['PASSWORD'],
  STREET_ADDRESS: ['STREET_ADDRESS', 'POSTAL_CODE'],
  POSTAL_CODE: ['POSTAL_CODE', 'STREET_ADDRESS'],
  BDAY: ['BDAY', 'DOB'],
  DOB: ['DOB', 'BDAY'],
  IP: ['IP'],
  SECRET: ['SECRET'],
  MRN: ['MRN'],
};

export async function resolveForBinding(
  handle: string,
  target: BindingTarget,
  vault: VaultStore
): Promise<Result<Sensitive<string>, Violation>> {
  const entry = await vault.get(handle);
  if (!entry) {
    return err({
      code: 'HANDLE_NOT_FOUND',
      message: `Vault handle ${handle} not found`,
      details: { handle },
    });
  }

  const handleType = entry.type;
  const accepts = target.accepts;

  if (accepts.length > 0 && handleType !== 'none') {
    const allowed = COMPATIBILITY_MATRIX[handleType] || [handleType];
    const hasMatch = accepts.some(a => allowed.includes(a));

    if (!hasMatch) {
      return err({
        code: 'VAULT_TYPE_MISMATCH',
        message: `Vault handle ${handle} type ${handleType} not accepted by target (accepts: ${accepts.join(', ')})`,
        details: { handle, target: target.element_id, expected: accepts, actual: handleType },
      });
    }
  }

  const sensitiveValue: Sensitive<string> = {
    __sensitiveBrand: '__sensitiveBrand',
    value: entry.value,
  };

  return ok(sensitiveValue);
}

/**
 * Read the type out of a handle. Both shapes must parse: `⟦EMAIL#3⟧` for Tier 2+,
 * and `⟦PASSWORD⟧` for Tier 1, which deliberately carries no index so that not even
 * cardinality leaks.
 *
 * The Tier-1 shape used to return `'PASSWORD⟧'`, which matches nothing in the
 * compatibility matrix — so a password could never be bound at all. Fail-closed, and
 * therefore silent, and therefore worth a test.
 */
export function extractPiiTypeFromHandle(handle: string): PiiType {
  const match = handle.match(/⟦([^#⟧]+)[#⟧]/);
  if (match) return match[1] as PiiType;
  return 'NONE' as PiiType;
}