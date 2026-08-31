import type { PiiType } from '@glasswall/schema/policy';

/**
 * NER labels are advisory evidence for fusion. They are deliberately mapped to
 * coarse PII types and never to a Tier 1 type — a model must not be able to
 * promote text to a class the deterministic recognizers own.
 */
const NER_TO_PII: Record<string, PiiType> = {
  PER: 'NAME',
  PERSON: 'NAME',
  LOC: 'ADDRESS',
  GPE: 'ADDRESS',
  LOCATION: 'ADDRESS',
  FAC: 'ADDRESS',
  ORG: 'PERSONAL',
  ORGANIZATION: 'PERSONAL',
  MISC: 'PERSONAL',
  DATE: 'PERSONAL',
  TIME: 'PERSONAL',
  MONEY: 'FINANCIAL',
};

export function nerTypeToPii(nerType: string): PiiType {
  return NER_TO_PII[nerType.toUpperCase()] ?? 'PERSONAL';
}
