// Executes one validated action in the page.
//
// Targets are resolved through the element registry filled by the last
// observation; the executor never receives a selector. Before acting it recomputes
// the identity hash so a changed page fails IDENTITY_MISMATCH rather than clicking
// something else. Values arrive as literals: the service worker resolves vault
// handles locally and the plaintext exists only here and in the page.
import type { Action, ActionResult } from '@glasswall/schema/action';
import type { SanitizedObservation, SanitizedElement } from '@glasswall/schema/observation';
import { resolve, currentObservationId } from '../registry';
import { computeIdentityHash } from '../identity';
import { waitForEffect, expectedEffect } from './effects';

const EVENT_GAP_MS = 8;
const CHAR_GAP_MS = 6;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Outcome { ok: boolean; effect_observed: boolean; error_code?: ActionResult['error_code']; error_message?: string }

function fail(error_code: ActionResult['error_code'], error_message: string): Outcome {
  return { ok: false, effect_observed: false, error_code, error_message };
}

export async function executeAction(action: Action, observation: SanitizedObservation): Promise<ActionResult> {
  const started = performance.now();
  let outcome: Outcome;
  try {
    outcome = await run(action, observation);
  } catch (error) {
    outcome = fail('AGENT_ERROR', error instanceof Error ? error.message : 'execution failed');
  }
  return { ...outcome, error_code: outcome.error_code ?? 'NONE', ms: Math.round(performance.now() - started) } as ActionResult;
}

async function run(action: Action, observation: SanitizedObservation): Promise<Outcome> {
  if (observation.observation_id !== currentObservationId()) {
    return fail('STALE_OBSERVATION', `observation ${observation.observation_id} is not the current one`);
  }
  switch (action.type) {
    case 'CLICK': {
      const t = locate(action.target, observation);
      if ('ok' in t) return t;
      return await click(t.element, action);
    }
    case 'TYPE': {
      const t = locate(action.target, observation);
      if ('ok' in t) return t;
      if (action.value.kind !== 'literal') return fail('AGENT_ERROR', 'vault reference reached the executor unresolved');
      return await type(t.element, t.meta, action.value.text, action.clear_first !== false);
    }
    case 'SELECT': {
      const t = locate(action.target, observation);
      if ('ok' in t) return t;
      return await select(t.element, action.option_index);
    }
    case 'PRESS_KEY': {
      let element: Element = document.activeElement ?? document.body;
      if (action.target) {
        const t = locate(action.target, observation);
        if ('ok' in t) return t;
        element = t.element;
      }
      return await pressKey(element, action.key);
    }
    case 'SCROLL': {
      const before = window.scrollY + window.scrollX;
      const amount = (action.amount ?? 1) * Math.round(window.innerHeight * 0.8);
      if (action.target) {
        const t = locate(action.target, observation);
        if ('ok' in t) return t;
        t.element.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      } else {
        const dx = action.direction === 'left' ? -amount : action.direction === 'right' ? amount : 0;
        const dy = action.direction === 'up' ? -amount : action.direction === 'down' ? amount : 0;
        window.scrollBy({ left: dx, top: dy, behavior: 'instant' as ScrollBehavior });
      }
      await delay(120);
      const moved = window.scrollY + window.scrollX !== before || !!action.target;
      return moved ? { ok: true, effect_observed: true } : { ok: true, effect_observed: false, error_code: 'EFFECT_NOT_OBSERVED', error_message: 'page did not scroll (already at the edge?)' };
    }
    case 'NAVIGATE': {
      const url = new URL(action.url_template, location.href);
      if (url.origin !== location.origin) return fail('ORIGIN_NOT_ALLOWED', `cross-origin navigation to ${url.origin} is not executed by the content script`);
      const effect = waitForEffect('navigation', null);
      location.assign(url.href);
      return { ok: true, effect_observed: await effect };
    }
    case 'BACK': {
      const effect = waitForEffect('navigation', null);
      history.back();
      return { ok: true, effect_observed: await effect };
    }
    case 'WAIT': {
      await delay(Math.min(action.timeout_ms ?? 1000, 10_000));
      return { ok: true, effect_observed: true };
    }
    case 'DONE':
      return { ok: true, effect_observed: true };
  }
}

function locate(target: { id: string; id_hash: string }, observation: SanitizedObservation): { element: Element; meta: SanitizedElement } | Outcome {
  const meta = observation.elements.find(e => e.id === target.id);
  if (!meta) return fail('UNKNOWN_TARGET', `${target.id} is not in the observation`);
  const element = resolve(target.id);
  if (!element) return fail('ELEMENT_NOT_FOUND', `${target.id} is no longer in the page`);
  if (computeIdentityHash(element, meta.frame) !== target.id_hash) return fail('IDENTITY_MISMATCH', `${target.id} changed since it was observed`);
  if (!meta.enabled) return fail('ELEMENT_DISABLED', `${target.id} is disabled`);
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return fail('ELEMENT_NOT_FOUND', `${target.id} is hidden`);
  return { element, meta };
}

function centre(element: Element) {
  const r = element.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function scrollIntoViewIfNeeded(element: Element): void {
  const r = element.getBoundingClientRect();
  if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > window.innerWidth) {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  }
}

async function click(element: Element, action: Action): Promise<Outcome> {
  scrollIntoViewIfNeeded(element);
  await delay(EVENT_GAP_MS);
  const pos = centre(element);
  const base = { bubbles: true, cancelable: true, composed: true, button: 0, ...pos };
  const effect = waitForEffect(expectedEffect(action, element), element);
  element.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  await delay(EVENT_GAP_MS);
  element.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mouseup', base));
  element.dispatchEvent(new MouseEvent('click', base));
  const observed = await effect;
  return observed ? { ok: true, effect_observed: true } : { ok: true, effect_observed: false, error_code: 'EFFECT_NOT_OBSERVED', error_message: 'click produced no visible change' };
}

function nativeSetter(element: Element): ((value: string) => void) | null {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
  if (!proto) return null;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- bound with .call below
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  return setter ? (v: string) => setter.call(element, v) : null;
}

async function type(element: Element, meta: SanitizedElement, text: string, clearFirst: boolean): Promise<Outcome> {
  const editable = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable);
  if (!editable || !meta.focusable) return fail('ELEMENT_NOT_FOCUSABLE', `${meta.id} does not accept text`);
  scrollIntoViewIfNeeded(element);
  (element as HTMLElement).focus({ preventScroll: true });
  await delay(EVENT_GAP_MS);

  const setValue = nativeSetter(element);
  const fire = (name: string) => element.dispatchEvent(new Event(name, { bubbles: true, composed: true }));

  if (element instanceof HTMLElement && element.isContentEditable && !setValue) {
    if (clearFirst) element.textContent = '';
    element.textContent = (element.textContent ?? '') + text;
    fire('input');
    fire('change');
    return { ok: true, effect_observed: true };
  }

  let buffer = clearFirst ? '' : (element as HTMLInputElement).defaultValue ?? '';
  if (clearFirst) {
    setValue?.('');
    fire('input');
  }
  // Per character so React/Vue controlled inputs and masks see real key events.
  for (const ch of text) {
    const keyInit = { bubbles: true, cancelable: true, composed: true, key: ch, code: `Key${ch.toUpperCase()}` };
    element.dispatchEvent(new KeyboardEvent('keydown', keyInit));
    element.dispatchEvent(new KeyboardEvent('keypress', keyInit));
    buffer += ch;
    setValue?.(buffer);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ch }));
    element.dispatchEvent(new KeyboardEvent('keyup', keyInit));
    await delay(CHAR_GAP_MS);
  }
  fire('change');
  return { ok: true, effect_observed: true };
}

async function select(element: Element, optionIndex: number): Promise<Outcome> {
  if (!(element instanceof HTMLSelectElement)) return fail('ELEMENT_NOT_ACTIONABLE', 'target is not a <select>');
  if (optionIndex < 0 || optionIndex >= element.options.length) return fail('AGENT_ERROR', `option_index ${optionIndex} out of range`);
  element.focus({ preventScroll: true });
  element.selectedIndex = optionIndex;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return { ok: true, effect_observed: true };
}

async function pressKey(element: Element, key: string): Promise<Outcome> {
  const init = { bubbles: true, cancelable: true, composed: true, key, code: key === 'Enter' ? 'Enter' : key };
  const effect = waitForEffect('dom_or_navigation', element);
  const notCancelled = element.dispatchEvent(new KeyboardEvent('keydown', init));
  element.dispatchEvent(new KeyboardEvent('keypress', init));
  if (key === 'Enter' && notCancelled) {
    const form = (element as HTMLInputElement).form ?? element.closest('form');
    if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
  }
  element.dispatchEvent(new KeyboardEvent('keyup', init));
  const observed = await effect;
  return { ok: true, effect_observed: observed };
}
