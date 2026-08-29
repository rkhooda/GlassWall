// SELECT executor - select option by index with native value setter

import type { Action, Target } from '@glasswall/schema/action';
import type { SanitizedElement } from '@glasswall/schema/observation';
import type { ExecutionContext } from './types';
import { waitForEffect, getExpectedEffect } from './verify';

/**
 * Executes a SELECT action by setting the selectedIndex
 */
export async function executeSelect(
  action: Action & { type: 'SELECT'; option_index: number },
  context: ExecutionContext
): Promise<{ ok: boolean; effectObserved: boolean; errorCode?: string; errorMessage?: string; ms: number }> {
  const startTime = performance.now();

  // 1. Find target element
  const target = findElementById(context.observation, action.target.id);
  if (!target) {
    return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_FOUND', errorMessage: `Element ${action.target.id} not found in observation`, ms: performance.now() - startTime };
  }

  const element = document.getElementById(target.id) || findElementBySelector(target);
  if (!element) {
    return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_FOUND', errorMessage: `Element ${action.target.id} not found in DOM`, ms: performance.now() - startTime };
  }

  // 2. Verify it's a select element
  if (element.tagName.toLowerCase() !== 'select') {
    return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_ACTIONABLE', errorMessage: `Element ${action.target.id} is not a <select>`, ms: performance.now() - startTime };
  }

  // 3. Recompute identity hash and verify
  const computedHash = computeIdentityHash(element, target);
  if (computedHash !== action.target.id_hash) {
    return { ok: false, effectObserved: false, errorCode: 'IDENTITY_MISMATCH', errorMessage: `Identity hash mismatch for element ${action.target.id}`, ms: performance.now() - startTime };
  }

  const selectElement = element as HTMLSelectElement;

  // 4. Check if option index is valid
  if (action.option_index < 0 || action.option_index >= selectElement.options.length) {
    return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_ACTIONABLE', errorMessage: `Option index ${action.option_index} out of range (0-${selectElement.options.length - 1})`, ms: performance.now() - startTime };
  }

  // 5. Scroll into view if needed
  if (!isFullyVisible(element)) {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise(r => setTimeout(r, 50));
  }

  // 6. Focus and select
  selectElement.focus();
  await delay(12);
  
  // Use native value setter for consistency
  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  const option = selectElement.options[action.option_index];
  const selectedValue = option?.value || '';
  
  if (nativeValueSetter) {
    nativeValueSetter.call(selectElement, selectedValue);
  } else {
    selectElement.value = selectedValue;
  }
  
  // Also set selectedIndex directly
  selectElement.selectedIndex = action.option_index;
  
  // Dispatch events
  dispatchEvent(selectElement, 'input');
  await delay(12);
  dispatchEvent(selectElement, 'change');

  // 7. Wait for expected effect
  const expectedEffect = getExpectedEffect(action);
  const effectResult = await waitForEffect(context, action, element, expectedEffect);

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

function computeIdentityHash(element: Element, target: SanitizedElement): string {
  const tag = element.tagName.toLowerCase();
  const role = target.role;
  const accessibleName = getAccessibleName(element);
  const domPath = getDomPathSignature(element);
  const rect = element.getBoundingClientRect();
  const quantizedRect = quantizeRect(rect);
  const frameId = target.frame;
  
  const hashInput = `${tag}|${role}|${accessibleName}|${domPath}|${quantizedRect[0]},${quantizedRect[1]},${quantizedRect[2]},${quantizedRect[3]}|${frameId}`;
  return simpleHash(hashInput).substring(0, 12);
}

function getAccessibleName(element: Element): string {
  if (element.hasAttribute('aria-label')) return element.getAttribute('aria-label') || '';
  if (element.hasAttribute('aria-labelledby')) {
    const id = element.getAttribute('aria-labelledby');
    const labelled = document.getElementById(id || '');
    return labelled?.textContent?.trim() || '';
  }
  const label = element.querySelector(`label[for="${element.id}"]`);
  if (label) return label.textContent?.trim() || '';
  const wrappingLabel = element.closest('label');
  if (wrappingLabel) return wrappingLabel.textContent?.trim() || '';
  if (element.hasAttribute('placeholder')) return element.getAttribute('placeholder') || '';
  if (element.hasAttribute('title')) return element.getAttribute('title') || '';
  return element.textContent?.trim() || '';
}

function getDomPathSignature(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    const id = current.getAttribute('id');
    if (id) {
      selector += `#${CSS.escape(id)}`;
    } else {
      let sameTypeSiblings = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) sameTypeSiblings++;
        sibling = sibling.previousElementSibling;
      }
      if (sameTypeSiblings > 0) {
        selector += `:nth-of-type(${sameTypeSiblings + 1})`;
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }
  
  return path.join(' > ');
}

function quantizeRect(rect: DOMRect): [number, number, number, number] {
  const gridSize = 4;
  return [
    Math.round(rect.left / gridSize) * gridSize,
    Math.round(rect.top / gridSize) * gridSize,
    Math.round(rect.width / gridSize) * gridSize,
    Math.round(rect.height / gridSize) * gridSize
  ];
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function isFullyVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth
  );
}

function dispatchEvent(element: Element, type: string): void {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  element.dispatchEvent(event);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}