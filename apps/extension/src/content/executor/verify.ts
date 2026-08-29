// Effect verification - verifies expected effects after action execution

import type { Action, ActionResult } from '@glasswall/schema/action';
import type { SanitizedElement } from '@glasswall/schema/observation';
import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { ExecutionContext } from './types';

const EFFECT_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 50;

/**
 * Waits for an expected effect to be observed after action execution
 */
export async function waitForEffect(
  context: ExecutionContext,
  action: Action,
  targetElement: Element | null,
  expectedEffect: 'value_change' | 'dom_mutation' | 'navigation' | 'scroll' | 'none'
): Promise<{ effectObserved: boolean; errorCode?: ActionResult['error_code']; errorMessage?: string }> {
  if (expectedEffect === 'none') {
    return { effectObserved: true };
  }

  const startTime = Date.now();
  let lastUrl = window.location.href;
  let lastScrollY = window.scrollY;
  let lastDomHash = computeDomHash(document.body);

  return new Promise((resolve) => {
    const checkEffect = () => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed >= EFFECT_TIMEOUT_MS) {
        resolve({
          effectObserved: false,
          errorCode: 'EFFECT_NOT_OBSERVED',
          errorMessage: `Expected effect '${expectedEffect}' not observed within ${EFFECT_TIMEOUT_MS}ms`
        });
        return;
      }

      let effectObserved = false;

      switch (expectedEffect) {
        case 'value_change': {
          if (targetElement && (targetElement as HTMLInputElement).value !== undefined) {
            const currentValue = (targetElement as HTMLInputElement).value;
            // Check if value changed from initial empty/partial state
            if (currentValue && currentValue.length > 0) {
              effectObserved = true;
            }
          }
          break;
        }

        case 'dom_mutation': {
          const currentHash = computeDomHash(document.body);
          if (currentHash !== lastDomHash) {
            effectObserved = true;
            lastDomHash = currentHash;
          }
          break;
        }

        case 'navigation': {
          if (window.location.href !== lastUrl) {
            effectObserved = true;
            lastUrl = window.location.href;
          }
          break;
        }

        case 'scroll': {
          if (window.scrollY !== lastScrollY) {
            effectObserved = true;
            lastScrollY = window.scrollY;
          }
          break;
        }
      }

      if (effectObserved) {
        resolve({ effectObserved: true });
        return;
      }

      setTimeout(checkEffect, POLL_INTERVAL_MS);
    };

    checkEffect();
  });
}

/**
 * Computes a simple hash of the DOM subtree for mutation detection
 */
function computeDomHash(root: Node): string {
  let hash = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      hash = ((hash << 5) - hash) + (el.tagName.length + (el.id?.length || 0) + (el.className?.length || 0));
      hash = hash & hash;
    } else if (node.nodeType === Node.TEXT_NODE) {
      hash = ((hash << 5) - hash) + (node.textContent?.length || 0);
      hash = hash & hash;
    }
  }
  return Math.abs(hash).toString(36);
}

/**
 * Verifies the specific effect based on action type
 */
export function getExpectedEffect(action: Action): 'value_change' | 'dom_mutation' | 'navigation' | 'scroll' | 'none' {
  switch (action.type) {
    case 'TYPE':
    case 'SELECT':
      return 'value_change';
    case 'CLICK':
      // Could be navigation, DOM mutation, or none depending on target
      return 'dom_mutation';
    case 'SCROLL':
      return 'scroll';
    case 'NAVIGATE':
      return 'navigation';
    case 'PRESS_KEY':
      return 'dom_mutation';
    case 'BACK':
      return 'navigation';
    case 'WAIT':
      return 'none';
    case 'DONE':
      return 'none';
    default:
      return 'none';
  }
}