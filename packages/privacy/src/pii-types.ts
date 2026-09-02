// One vocabulary for PII types across recognizers, handles, vault binding and the
// planner. Legacy and recognizer-internal names are aliased here, nowhere else.
import type { PiiType } from '@glasswall/schema/policy';
import { PiiTypeSchema } from '@glasswall/schema/policy';

const ALIAS: Record<string, PiiType> = { CARD: 'CREDIT_CARD', BDAY: 'DOB', NAME: 'PERSON_NAME', ADDRESS: 'STREET_ADDRESS' };

export function normalizePiiType(name: string | undefined | null): PiiType {
  if (!name) return 'NONE';
  const upper = name.toUpperCase();
  const aliased = ALIAS[upper] ?? upper;
  return PiiTypeSchema.safeParse(aliased).success ? (aliased as PiiType) : 'PERSONAL';
}
