// CLICK executor - exact event sequence per PLAN.md §14.4
// pointerdown → mousedown → focus → pointerup → mouseup → click

import type { Action, Target } from '@glasswall/schema/action';
import type { SanitizedElement } from '@glasswall/schema/observation';
import type { ExecutionContext } from './types';
import { waitForEffect, getExpectedEffect } from './verify';

const CLICK_EVENT_DELAY_MS = 12; // ~12ms between events

interface ClickCoordinates {
  x: number;
  y: number;
}

/**
 * Executes a CLICK action with exact event ordering
 */
export async function executeClick(
  action: Action & { type: 'CLICK' },
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

  // 2. Check if element is actionable (visible, enabled, focusable)
  if (!isElementActionable(element, target)) {
    return { ok: false, effectObserved: false, errorCode: 'ELEMENT_NOT_ACTIONABLE', errorMessage: `Element ${action.target.id} is not actionable`, ms: performance.now() - startTime };
  }

  // 3. Recompute identity hash and verify
  const computedHash = computeIdentityHash(element, target);
  if (computedHash !== action.target.id_hash) {
    return { ok: false, effectObserved: false, errorCode: 'IDENTITY_MISMATCH', errorMessage: `Identity hash mismatch for element ${action.target.id}`, ms: performance.now() - startTime };
  }

  // 4. Scroll into view if not fully visible
  if (!isFullyVisible(element)) {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    // Small delay to let scroll complete
    await new Promise(r => setTimeout(r, 50));
  }

  // 5. Get click coordinates (center of element)
  const coords = getClickCoordinates(element);

  // 6. Dispatch events in exact order per PLAN.md §14.4
  // pointerdown → mousedown → focus → pointerup → mouseup → click
  
  dispatchPointerEvent(element, 'pointerdown', coords);
  await delay(CLICK_EVENT_DELAY_MS);
  
  dispatchMouseEvent(element, 'mousedown', coords);
  await delay(CLICK_EVENT_DELAY_MS);
  
  // Focus the element
  if (isFocusable(element)) {
    (element as HTMLElement).focus();
  }
  await delay(CLICK_EVENT_DELAY_MS);
  
  dispatchPointerEvent(element, 'pointerup', coords);
  await delay(CLICK_EVENT_DELAY_MS);
  
  dispatchMouseEvent(element, 'mouseup', coords);
  await delay(CLICK_EVENT_DELAY_MS);
  
  dispatchMouseEvent(element, 'click', coords);

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
  // Try to find by data attributes or other means
  return document.querySelector(`[data-gw-id="${target.id}"]`);
}

function isElementActionable(element: Element, target: SanitizedElement): boolean {
  if (!target.visible || !target.enabled || !target.focusable) {
    return false;
  }
  // Check computed styles
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return true;
}

export function computeIdentityHash(element: Element, target: SanitizedElement): string {
  // Recompute the identity hash per PLAN.md §12.2
  // tag | role | normalized_accessible_name | dom_path_signature | quantized_rect | frame_id
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
  // Simplified accessible name computation
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

function isFocusable(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  const focusableTags = ['input', 'select', 'textarea', 'button', 'a'];
  if (focusableTags.includes(tag)) return true;
  if (element.hasAttribute('tabindex')) {
    const tabindex = parseInt(element.getAttribute('tabindex') || '-1', 10);
    return tabindex >= 0;
  }
  if (element.hasAttribute('contenteditable')) return true;
  return false;
}

function getClickCoordinates(element: Element): ClickCoordinates {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function dispatchPointerEvent(element: Element, type: string, coords: ClickCoordinates): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: coords.x,
    clientY: coords.y,
    button: 0,
    buttons: 1,
    pointerType: 'mouse',
    isPrimary: true
  });
  element.dispatchEvent(event);
}

function dispatchMouseEvent(element: Element, type: string, coords: ClickCoordinates): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: coords.x,
    clientY: coords.y,
    button: 0,
    buttons: 1
  });
  element.dispatchEvent(event);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}