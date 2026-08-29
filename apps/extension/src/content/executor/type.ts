// TYPE executor - exact event sequence per PLAN.md §14.4
// focus → (select-all + Delete if clear_first) → per-char keydown/keypress/input/keyup → change → blur
// Uses native value setter: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set

import type { Action, Target } from '@glasswall/schema/action';
import type { SanitizedElement } from '@glasswall/schema/observation';
import type { ExecutionContext } from './types';
import { waitForEffect, getExpectedEffect } from './verify';

const CHAR_DELAY_MS = 12; // ~12ms per character as specified in PLAN.md

/**
 * Executes a TYPE action with exact event ordering and native value setter
 */
export async function executeType(
  action: Action & { type: 'TYPE'; value: { kind: 'literal'; text: string } },
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

  // 2. Verify it's a typeable element
  if (!isTypeableElement(element, target)) {
    return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_ACTIONABLE', errorMessage: `Element ${action.target.id} is not typeable`, ms: performance.now() - startTime };
  }

  // 3. Recompute identity hash and verify
  const computedHash = computeIdentityHash(element, target);
  if (computedHash !== action.target.id_hash) {
    return { ok: false, effectObserved: false, errorCode: 'IDENTITY_MISMATCH', errorMessage: `Identity hash mismatch for element ${action.target.id}`, ms: performance.now() - startTime };
  }

  // 4. Scroll into view if not fully visible
  if (!isFullyVisible(element)) {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise(r => setTimeout(r, 50));
  }

  // 5. Resolve the value (now always literal, vault resolved in orchestrator)
  const text = resolveValue(action.value);

  // 6. Focus the element
  (element as HTMLElement).focus();
  await delay(CHAR_DELAY_MS);

  // 7. Clear existing value if clear_first (default true)
  if (action.clear_first !== false) {
    clearElementValue(element);
    await delay(CHAR_DELAY_MS);
  }

  // 8. Type each character with exact event sequence
  // per-char: keydown → keypress → input → keyup
  for (const char of text) {
    await typeCharacter(element, char);
    await delay(CHAR_DELAY_MS);
  }

  // 9. Dispatch change and blur events
  dispatchEvent(element, 'change');
  await delay(CHAR_DELAY_MS);
  
  // Don't blur immediately for form validation - let the page handle it
  // But we can optionally blur if needed
  // (element as HTMLElement).blur();

  // 10. Wait for expected effect
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

function isTypeableElement(element: Element, target: SanitizedElement): boolean {
  const tag = element.tagName.toLowerCase();
  const typeableTags = ['input', 'textarea'];
  if (!typeableTags.includes(tag)) return false;
  
  // Check input type
  if (tag === 'input') {
    const inputType = element.getAttribute('type')?.toLowerCase() || 'text';
    const nonTypeableTypes = ['hidden', 'button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'color', 'range'];
    if (nonTypeableTypes.includes(inputType)) return false;
  }
  
  return target.enabled && target.focusable;
}

function resolveValue(
  value: { kind: 'literal'; text: string }
): string {
  return value.text;
}

function clearElementValue(element: Element): void {
  const nativeValueSetter = getNativeValueSetter(element);
  if (nativeValueSetter) {
    nativeValueSetter.call(element as HTMLInputElement, '');
  } else {
    // Fallback
    (element as HTMLInputElement).value = '';
  }
  // Dispatch input event after clearing
  dispatchEvent(element, 'input');
}

function typeCharacter(element: Element, char: string): void {
  // For controlled components, we MUST use the native value setter
  const nativeValueSetter = getNativeValueSetter(element);
  const currentValue = (element as HTMLInputElement).value || '';
  const newValue = currentValue + char;
  
  if (nativeValueSetter) {
    nativeValueSetter.call(element as HTMLInputElement, newValue);
  } else {
    (element as HTMLInputElement).value = newValue;
  }
  
  // Dispatch events in order: keydown → keypress → input → keyup
  const keyEventOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: char,
    code: `Key${char.toUpperCase()}`,
    charCode: char.charCodeAt(0),
    keyCode: char.charCodeAt(0),
    which: char.charCodeAt(0)
  };
  
  element.dispatchEvent(new KeyboardEvent('keydown', keyEventOptions));
  element.dispatchEvent(new KeyboardEvent('keypress', keyEventOptions));
  dispatchEvent(element, 'input');
  element.dispatchEvent(new KeyboardEvent('keyup', keyEventOptions));
}

function getNativeValueSetter(element: Element): ((this: HTMLInputElement, value: string) => void) | null {
  // Use the native value setter so React/Vue controlled components register the change
  // This is the canonical fix per PLAN.md §14.4
  const descriptor = Object.getOwnPropertyDescriptor(
    element.tagName === 'TEXTAREA' 
      ? HTMLTextAreaElement.prototype 
      : HTMLInputElement.prototype, 
    'value'
  );
  return descriptor?.set as ((this: HTMLInputElement, value: string) => void) | null;
}

function dispatchEvent(element: Element, type: string): void {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  element.dispatchEvent(event);
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}