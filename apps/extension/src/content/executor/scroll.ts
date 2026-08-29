// SCROLL executor - scroll actions with viewport-relative amounts

import type { Action, Target } from '@glasswall/schema/action';
import type { SanitizedElement } from '@glasswall/schema/observation';
import type { ExecutionContext } from './types';
import { waitForEffect, getExpectedEffect } from './verify';

/**
 * Executes a SCROLL action
 */
export async function executeScroll(
  action: Action & { type: 'SCROLL'; direction: 'up' | 'down' | 'left' | 'right'; amount?: 'page' | 'half' | number; target?: Target },
  context: ExecutionContext
): Promise<{ ok: boolean; effectObserved: boolean; errorCode?: string; errorMessage?: string; ms: number }> {
  const startTime = performance.now();

  // If target is specified, scroll that element; otherwise scroll window
  let element: Element | Window = window;
  
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

  // Compute scroll amount
  const amount = computeScrollAmount(action.amount, element);
  
  // Perform scroll
  if (element === window) {
    const currentY = window.scrollY;
    const currentX = window.scrollX;
    
    switch (action.direction) {
      case 'down':
        window.scrollBy({ top: amount, behavior: 'instant' });
        break;
      case 'up':
        window.scrollBy({ top: -amount, behavior: 'instant' });
        break;
      case 'right':
        window.scrollBy({ left: amount, behavior: 'instant' });
        break;
      case 'left':
        window.scrollBy({ left: -amount, behavior: 'instant' });
        break;
    }
  } else {
    const el = element as Element;
    switch (action.direction) {
      case 'down':
        el.scrollTop += amount;
        break;
      case 'up':
        el.scrollTop -= amount;
        break;
      case 'right':
        el.scrollLeft += amount;
        break;
      case 'left':
        el.scrollLeft -= amount;
        break;
    }
  }

  // Wait for scroll effect
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

function computeScrollAmount(amount: 'page' | 'half' | number | undefined, element: Element | Window): number {
  if (typeof amount === 'number') return amount;
  
  const viewportHeight = element === window ? window.innerHeight : (element as Element).clientHeight;
  
  switch (amount) {
    case 'page':
      return viewportHeight * 0.9; // 90% of viewport
    case 'half':
      return viewportHeight * 0.5;
    default:
      return viewportHeight * 0.5; // default to half page
  }
}