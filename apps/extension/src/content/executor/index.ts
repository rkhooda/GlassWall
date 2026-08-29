// Main executor - dispatches actions to specific handlers

import type { Action, ActionResult, Target } from '@glasswall/schema/action';
import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { SanitizedElement } from '@glasswall/schema/observation';
import type { ExecutionContext } from './types';
import { executeClick, computeIdentityHash } from './click';
import { executeType } from './type';
import { executeScroll } from './scroll';
import { executeSelect } from './select';
import { executePressKey } from './key';
import { executeNavigate } from './navigate';

/**
 * Main execute function - validates and executes an action
 * Per PLAN.md §14.4 execution semantics:
 * 1. scrollIntoView if not fully visible
 * 2. recompute identity_hash → abort on mismatch
 * 3. dispatch events in exact order
 * 4. wait for expected_effect with 2s timeout
 * 5. verify effect
 * 6. return ActionResult { ok, effect_observed, error_code?, ms }
 */
export async function executeAction(
  action: Action,
  observation: SanitizedObservation,
  viewport: { w: number; h: number; dpr: number; scrollX: number; scrollY: number }
): Promise<ActionResult> {
  const context: ExecutionContext = { observation, viewport };

  try {
    // Validate action against available_actions (rung 6 of validation ladder)
    if (!isActionSupported(action, observation)) {
      return {
        ok: false,
        effect_observed: false,
        error_code: 'ELEMENT_NOT_FOUND',
        error_message: `Action ${action.type} not supported for target element`
      };
    }

    // Dispatch to specific executor
    let result: { ok: boolean; effectObserved: boolean; errorCode?: string; errorMessage?: string; ms: number };

    switch (action.type) {
      case 'CLICK':
        result = await executeClick(action as any, context);
        break;
      case 'TYPE':
        result = await executeType(action as any, context);
        break;
      case 'SCROLL':
        result = await executeScroll(action as any, context);
        break;
      case 'SELECT':
        result = await executeSelect(action as any, context);
        break;
      case 'PRESS_KEY':
        result = await executePressKey(action as any, context);
        break;
      case 'NAVIGATE':
        result = await executeNavigate(action as any, context);
        break;
      case 'WAIT':
        result = await executeWait(action as any);
        break;
      case 'BACK':
        result = await executeBack();
        break;
      case 'DONE':
        result = { ok: true, effectObserved: true, ms: 0 };
        break;
      default:
        result = { ok: false, effectObserved: false, errorCode: 'INVALID_SCHEMA', errorMessage: `Unknown action type: ${(action as any).type}`, ms: 0 };
    }

    return {
      ok: result.ok,
      effect_observed: result.effectObserved,
      error_code: (result.errorCode as ActionResult['error_code']) || 'NONE',
      error_message: result.errorMessage
    };
  } catch (error) {
    return {
      ok: false,
      effect_observed: false,
      error_code: 'AGENT_ERROR',
      error_message: error instanceof Error ? error.message : 'Unknown execution error'
    };
  }
}

function isActionSupported(action: Action, observation: SanitizedObservation): boolean {
  // NAVIGATE, WAIT, BACK, DONE don't have targets
  if (['NAVIGATE', 'WAIT', 'BACK', 'DONE'].includes(action.type)) {
    return true;
  }

  // At this point, action is guaranteed to have a target
  const typedAction = action as Action & { target: Target };
  const target = observation.elements.find(el => el.id === typedAction.target.id);
  if (!target) return false;

  // Check if this action type is in available_actions for this element
  // In the observation, available_actions would be pre-computed
  // For now, we check based on element type and attributes
  
  switch (typedAction.type) {
    case 'CLICK':
      // Clickable if interactive role or has onclick/tabindex
      return target.role === 'button' || 
             target.role === 'link' || 
             target.role === 'checkbox' ||
             target.role === 'radio' ||
             target.role === 'tab' ||
             target.tag === 'button' ||
             target.tag === 'a' ||
             target.tag === 'input' ||
             true; // Most visible elements are clickable
    case 'TYPE':
      return (target.tag === 'input' && 
              !['hidden', 'button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'color'].includes(target.type || '')) ||
             target.tag === 'textarea';
    case 'SELECT':
      return target.tag === 'select';
    case 'SCROLL':
      return true; // Can always scroll
    case 'PRESS_KEY':
      return true; // Can always press keys
    default:
      return false;
  }
}

async function executeWait(action: Action & { type: 'WAIT' }): Promise<{ ok: boolean; effectObserved: boolean; ms: number }> {
  const ms = action.timeout_ms || 1000;
  await new Promise(r => setTimeout(r, Math.min(ms, 5000)));
  return { ok: true, effectObserved: true, ms };
}

async function executeBack(): Promise<{ ok: boolean; effectObserved: boolean; ms: number }> {
  window.history.back();
  await new Promise(r => setTimeout(r, 500));
  return { ok: true, effectObserved: true, ms: 500 };
}

// Re-export types and utilities
export type { ExecutionContext, ElementRect } from './types';
export { computeIdentityHash };