// Response Guard - validates model output against Action schema
// One repair retry with validation error appended, then AGENT_ERROR

import { z } from 'zod';
import { ActionEnvelopeSchema, type ActionEnvelope } from '@glasswall/schema/action';
import type { SanitizedObservation } from '@glasswall/schema/observation';

export interface ValidationResult {
  success: boolean;
  envelope?: ActionEnvelope;
  error?: string;
  repairAttempted: boolean;
}

// Repair prompt template - appended to the original prompt on validation failure
const REPAIR_PROMPT = `
The previous response failed validation. Please fix the following error:
{error}

Respond with ONLY a valid JSON object matching the ActionEnvelope schema.
No extra text, no markdown, no explanation.
`;

export function validateActionEnvelope(
  data: unknown,
  observation: SanitizedObservation
): ValidationResult {
  // First attempt: direct validation
  const firstAttempt = ActionEnvelopeSchema.safeParse(data);
  if (firstAttempt.success) {
    // Additional semantic checks
    const semanticCheck = checkSemanticValidity(firstAttempt.data, observation);
    if (semanticCheck.valid) {
      return { success: true, envelope: firstAttempt.data, repairAttempted: false };
    }
    // Semantic failure - treat as validation error for repair
    return attemptRepair(data, semanticCheck.error ?? 'Semantic validation failed', observation);
  }

  // Schema validation failed - attempt repair
  return attemptRepair(data, formatZodError(firstAttempt.error), observation);
}

function attemptRepair(
  originalData: unknown,
  error: string,
  observation: SanitizedObservation
): ValidationResult {
  // In a real implementation, this would call the model again with the repair prompt
  // For now, we return the error - the orchestrator handles the retry logic
  return {
    success: false,
    error: `Validation failed: ${error}`,
    repairAttempted: true,
  };
}

function checkSemanticValidity(
  envelope: ActionEnvelope,
  observation: SanitizedObservation
): { valid: boolean; error?: string } {
  // Check observation_id freshness
  if (envelope.observation_id !== observation.observation_id) {
    return { valid: false, error: `STALE_OBSERVATION: expected ${observation.observation_id}, got ${envelope.observation_id}` };
  }

  // Check target exists in current observation (for actions with targets)
  const action = envelope.action;
  if ('target' in action && action.target) {
    const target = observation.elements.find(e => e.id === action.target!.id);
    if (!target) {
      return { valid: false, error: `UNKNOWN_TARGET: element ${action.target.id} not in current observation` };
    }
    // Check id_hash matches (computed at execution time, but we can verify it's present)
    if (!target.id_hash) {
      return { valid: false, error: `IDENTITY_MISMATCH: target ${action.target.id} has no id_hash` };
    }
  }

  // Check NAVIGATE origin allowlist (would need session context)
  // For now, just ensure url_template is present
  if (action.type === 'NAVIGATE' && !action.url_template) {
    return { valid: false, error: 'NAVIGATE requires url_template' };
  }

  return { valid: true };
}

function formatZodError(error: z.ZodError): string {
  return error.errors
    .map(e => `${e.path.join('.')}: ${e.message}`)
    .join('; ');
}

export function buildRepairPrompt(originalPrompt: string, error: string): string {
  return originalPrompt + '\n\n' + REPAIR_PROMPT.replace('{error}', error);
}