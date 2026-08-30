// Recovery ladder — capped at 3 attempts then abort
// PLAN.md §21 F11, PHASE 14

import type { ActionEnvelope, ActionResult } from '@glasswall/schema/action';

export interface RecoveryAttempt {
  stepIndex: number;
  actionType: string;
  errorCode: ActionResult['error_code'];
  timestamp: number;
}

const MAX_RECOVERY_ATTEMPTS = 3;
const recoveryHistory: RecoveryAttempt[] = [];

export function recordRecoveryAttempt(
  stepIndex: number,
  actionType: string,
  errorCode: ActionResult['error_code']
): void {
  recoveryHistory.push({
    stepIndex,
    actionType,
    errorCode,
    timestamp: Date.now(),
  });

  // Keep only last 10 attempts
  if (recoveryHistory.length > 10) {
    recoveryHistory.shift();
  }
}

export function getRecentFailures(stepIndex: number): RecoveryAttempt[] {
  return recoveryHistory.filter(
    (a) => a.stepIndex === stepIndex && Date.now() - a.timestamp < 30000
  );
}

export function shouldAttemptRecovery(
  stepIndex: number,
  actionType: string,
  errorCode: ActionResult['error_code']
): { shouldRecover: boolean; recoveryAction?: ActionEnvelope['action']; reason?: string } {
  const recent = getRecentFailures(stepIndex);

  if (recent.length >= MAX_RECOVERY_ATTEMPTS) {
    return {
      shouldRecover: false,
      reason: `Recovery attempts exhausted (${MAX_RECOVERY_ATTEMPTS}) for step ${stepIndex}`,
    };
  }

  // Recovery strategies by error code
  switch (errorCode) {
    case 'ELEMENT_NOT_FOUND':
    case 'ELEMENT_NOT_ACTIONABLE':
    case 'UNKNOWN_TARGET':
    case 'STALE_OBSERVATION':
      // Try SCROLL to bring element into view, then re-observe
      return {
        shouldRecover: true,
        recoveryAction: { type: 'SCROLL', direction: 'down', amount: 300 },
        reason: `Scroll to find element (attempt ${recent.length + 1}/${MAX_RECOVERY_ATTEMPTS})`,
      };

    case 'UNSUPPORTED_ACTION':
      // Try alternative action
      return {
        shouldRecover: true,
        recoveryAction: { type: 'CLICK', target: { id: '', id_hash: '' } }, // Will be replaced by caller
        reason: `Try alternative action (attempt ${recent.length + 1}/${MAX_RECOVERY_ATTEMPTS})`,
      };

    case 'VAULT_TYPE_MISMATCH':
    case 'LITERAL_CONTAINS_SECRET':
    case 'ORIGIN_NOT_ALLOWED':
    case 'AGENT_ERROR':
      // Security failures - do not recover, abort
      return {
        shouldRecover: false,
        reason: `Security violation ${errorCode} — aborting`,
      };

    case 'ABORTED':
      return { shouldRecover: false, reason: 'User aborted' };

    case 'IDENTITY_MISMATCH':
      // Re-observe and retry
      return {
        shouldRecover: true,
        recoveryAction: { type: 'WAIT', condition: 'stable', timeout_ms: 500 },
        reason: `Wait for DOM to stabilize (attempt ${recent.length + 1}/${MAX_RECOVERY_ATTEMPTS})`,
      };

    default:
      // Generic recovery: wait and re-observe
      return {
        shouldRecover: recent.length < 2,
        recoveryAction: { type: 'WAIT', condition: 'stable', timeout_ms: 1000 },
        reason: `Generic wait recovery (attempt ${recent.length + 1}/${MAX_RECOVERY_ATTEMPTS})`,
      };
  }
}

export function getRecoveryStats(): { totalAttempts: number; byErrorCode: Record<string, number> } {
  const byErrorCode: Record<string, number> = {};
  for (const attempt of recoveryHistory) {
    byErrorCode[attempt.errorCode] = (byErrorCode[attempt.errorCode] || 0) + 1;
  }
  return { totalAttempts: recoveryHistory.length, byErrorCode };
}

export function clearRecoveryHistory(): void {
  recoveryHistory.length = 0;
}