// Scripted Provider - deterministic finite-state planner per task
// Runs with ZERO network, for CI and demo-day insurance

import type { Action, ActionEnvelope, Target, Value } from '@glasswall/schema/action';
import type { SanitizedObservation, SanitizedElement } from '@glasswall/schema/observation';

export interface ScriptedStep {
  action: Action;
  rationale: string;
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
}

export interface TaskScript {
  name: string;
  steps: ScriptedStep[];
  // Optional: condition to check if we should continue
  doneCondition?: (observation: SanitizedObservation) => boolean;
}

// T1: "Fill the shipping form and submit" on ShopLite
export const T1_SCRIPT: TaskScript = {
  name: 'T1_shoplite_checkout',
  steps: [
    {
      action: { type: 'TYPE', target: { id: 'e1', id_hash: '' }, value: { kind: 'vault_ref', handle: '⟦PERSON_NAME#1⟧' }, clear_first: true },
      rationale: 'fill_required_field',
      risk: 'medium',
      requiresConfirmation: false,
    },
    {
      action: { type: 'TYPE', target: { id: 'e2', id_hash: '' }, value: { kind: 'vault_ref', handle: '⟦EMAIL#1⟧' }, clear_first: true },
      rationale: 'fill_required_field',
      risk: 'medium',
      requiresConfirmation: false,
    },
    {
      action: { type: 'TYPE', target: { id: 'e3', id_hash: '' }, value: { kind: 'vault_ref', handle: '⟦PHONE#1⟧' }, clear_first: true },
      rationale: 'fill_required_field',
      risk: 'medium',
      requiresConfirmation: false,
    },
    {
      action: { type: 'TYPE', target: { id: 'e4', id_hash: '' }, value: { kind: 'vault_ref', handle: '⟦STREET_ADDRESS#1⟧' }, clear_first: true },
      rationale: 'fill_required_field',
      risk: 'medium',
      requiresConfirmation: false,
    },
    {
      action: { type: 'TYPE', target: { id: 'e5', id_hash: '' }, value: { kind: 'vault_ref', handle: '⟦POSTAL_CODE#1⟧' }, clear_first: true },
      rationale: 'fill_required_field',
      risk: 'medium',
      requiresConfirmation: false,
    },
    {
      action: { type: 'CLICK', target: { id: 'e6', id_hash: '' } },
      rationale: 'complete',
      risk: 'high',
      requiresConfirmation: true,
    },
  ],
  doneCondition: (obs) => {
    // Check if we're on confirmation page
    return obs.page.url_template.includes('/checkout/confirm') || obs.page.url_template.includes('/confirm');
  },
};

// T3: "Search for wireless earbuds under ₹3000 and add the top result to cart" on ShopLite
export const T3_SCRIPT: TaskScript = {
  name: 'T3_shoplite_search',
  steps: [
    {
      action: { type: 'TYPE', target: { id: 'e1', id_hash: '' }, value: { kind: 'literal', text: 'wireless earbuds' }, clear_first: true },
      rationale: 'search',
      risk: 'low',
      requiresConfirmation: false,
    },
    {
      action: { type: 'PRESS_KEY', key: 'Enter', target: { id: 'e1', id_hash: '' } },
      rationale: 'search',
      risk: 'low',
      requiresConfirmation: false,
    },
    {
      action: { type: 'CLICK', target: { id: 'e2', id_hash: '' } },
      rationale: 'advance_step',
      risk: 'low',
      requiresConfirmation: false,
    },
    {
      action: { type: 'CLICK', target: { id: 'e3', id_hash: '' } },
      rationale: 'complete',
      risk: 'high',
      requiresConfirmation: true,
    },
  ],
  doneCondition: (obs) => obs.page.url_template.includes('/cart'),
};

// Fallback generic script for unknown tasks
export const GENERIC_SCRIPT: TaskScript = {
  name: 'generic',
  steps: [
    {
      action: { type: 'WAIT', condition: 'stable', timeout_ms: 1000 },
      rationale: 'wait_stable',
      risk: 'low',
      requiresConfirmation: false,
    },
    {
      action: { type: 'DONE', outcome: 'impossible' as const, evidence_element: undefined },
      rationale: 'complete',
      risk: 'low',
      requiresConfirmation: false,
    },
  ],
};

function findMatchingElement(
  observation: SanitizedObservation,
  preferredRoles: string[],
  preferredLabels: string[]
): SanitizedElement | null {
  // Try to find element by role first
  for (const role of preferredRoles) {
    const el = observation.elements.find(e => e.role === role && e.visible && e.enabled);
    if (el) return el;
  }
  // Try by label
  for (const label of preferredLabels) {
    const el = observation.elements.find(e => 
      e.label_raw.toLowerCase().includes(label.toLowerCase()) && e.visible && e.enabled
    );
    if (el) return el;
  }
  // Fallback: first visible, enabled, focusable input
  return observation.elements.find(e => e.visible && e.enabled && e.focusable) ?? null;
}

function createTarget(element: SanitizedElement): Target {
  return { id: element.id, id_hash: element.id_hash };
}

function detectTaskType(task: string): 'T1' | 'T3' | 'generic' {
  const lower = task.toLowerCase();
  if (lower.includes('shipping') || lower.includes('checkout') || lower.includes('fill') && lower.includes('form')) {
    return 'T1';
  }
  if (lower.includes('search') || lower.includes('find') && lower.includes('add') && lower.includes('cart')) {
    return 'T3';
  }
  return 'generic';
}

export function getScriptedPlanner(task: string): TaskScript {
  const taskType = detectTaskType(task);
  switch (taskType) {
    case 'T1': return T1_SCRIPT;
    case 'T3': return T3_SCRIPT;
    default: return GENERIC_SCRIPT;
  }
}

export function buildScriptedAction(
  script: TaskScript,
  stepIndex: number,
  observation: SanitizedObservation,
  _history: ActionEnvelope[]
): { action: Action; rationale: string; risk: 'low' | 'medium' | 'high'; requiresConfirmation: boolean } | null {
  if (stepIndex >= script.steps.length) {
    return null;
  }

  const scriptStep = script.steps[stepIndex];
  if (!scriptStep) {
    return null;
  }
  let action = { ...scriptStep.action };

  // For TYPE actions with vault_ref, we need to find the actual target element
  if (action.type === 'TYPE' && action.value.kind === 'vault_ref') {
    // Find the next unfilled input field
    const unfilledInputs = observation.elements.filter(e => 
      e.tag === 'input' && 
      e.visible && 
      e.enabled && 
      e.value_state !== 'filled' &&
      !['hidden', 'button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'color'].includes(e.type || '')
    );
    
    if (unfilledInputs.length > 0) {
      // Pick the first unfilled input that matches the expected type
      const target = unfilledInputs[0];
      if (target) {
        action = { ...action, target: createTarget(target) };
      }
    }
  }

  // For CLICK actions, find appropriate clickable element
  if (action.type === 'CLICK') {
    const clickable = observation.elements.find(e => 
      (e.role === 'button' || e.role === 'link' || e.tag === 'button' || e.tag === 'a') &&
      e.visible && 
      e.enabled
    );
    if (clickable) {
      action = { ...action, target: createTarget(clickable) };
    }
  }

  return {
    action,
    rationale: scriptStep.rationale,
    risk: scriptStep.risk,
    requiresConfirmation: scriptStep.requiresConfirmation,
  };
}