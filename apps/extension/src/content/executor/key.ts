// PRESS_KEY executor - press specific keys with proper events

import type { Action, Target } from '@glasswall/schema/action';
import type { SanitizedElement } from '@glasswall/schema/observation';
import type { ExecutionContext } from './types';
import { waitForEffect, getExpectedEffect } from './verify';

const KEY_MAP: Record<string, { key: string; code: string; keyCode: number }> = {
  'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
  'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
  'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
  'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
};

/**
 * Executes a PRESS_KEY action
 */
export async function executePressKey(
  action: Action & { type: 'PRESS_KEY'; key: 'Enter' | 'Tab' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'; target?: Target },
  context: ExecutionContext
): Promise<{ ok: boolean; effectObserved: boolean; errorCode?: string; errorMessage?: string; ms: number }> {
  const startTime = performance.now();

  // Determine target element
  let element: Element | Document = document;
  
  if (action.target) {
    const target = findElementById(context.observation, action.target.id);
    if (!target) {
      return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_FOUND', errorMessage: `Element ${action.target.id} not found in observation`, ms: performance.now() - startTime };
    }
    const found = document.getElementById(target.id) || findElementBySelector(target);
    if (!found) {
      return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_FOUND', errorMessage: `Element ${action.target.id} not found in DOM`, ms: performance.now() - startTime };
    }
    element = found;
  }

  // Get key info
  const keyInfo = KEY_MAP[action.key];
  if (!keyInfo) {
    return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_ACTIONABLE', errorMessage: `Unsupported key: ${action.key}`, ms: performance.now() - startTime };
  }

  // Dispatch keydown
  const keydownEvent = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: keyInfo.key,
    code: keyInfo.code,
    keyCode: keyInfo.keyCode,
    which: keyInfo.keyCode
  });
  element.dispatchEvent(keydownEvent);
  await delay(12);

  // Dispatch keyup
  const keyupEvent = new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: keyInfo.key,
    code: keyInfo.code,
    keyCode: keyInfo.keyCode,
    which: keyInfo.keyCode
  });
  element.dispatchEvent(keyupEvent);

  // For Enter, also dispatch keypress (legacy but some handlers expect it)
  if (action.key === 'Enter') {
    const keypressEvent = new KeyboardEvent('keypress', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: keyInfo.key,
      code: keyInfo.code,
      keyCode: keyInfo.keyCode,
      which: keyInfo.keyCode,
      charCode: 13
    });
    element.dispatchEvent(keypressEvent);
  }

  // Wait for expected effect
  const expectedEffect = getExpectedEffect(action);
  const effectResult = await waitForEffect(context, action, element as Element, expectedEffect);

  const ms = performance.now() - startTime;
  
  return {
    ok: true,
    effectObserved: effectResult.effectObserved,
    errorCode: effectResult.errorCode,
    errorMessage: effectResult.errorMessage,
    ms: Math.round(ms)
  };
}

function findElementById(observation: ExecutionContext['observation'], id: string): SanitizedElement | undefined {
  return observation.elements.find(el => el.id === id);
}

function findElementBySelector(target: Target): Element | null {
  return document.querySelector(`[data-gw-id="${target.id}"]`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}