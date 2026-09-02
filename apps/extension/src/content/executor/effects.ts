// Effect verification: after an action, wait briefly for the page to change in the
// way the action implies. Reports honestly when nothing happened.
import type { Action } from '@glasswall/schema/action';

export type Effect = 'dom' | 'navigation' | 'dom_or_navigation' | 'value' | 'none';

const TIMEOUT_MS = 1500;

export function expectedEffect(action: Action, element: Element | null): Effect {
  switch (action.type) {
    case 'CLICK': {
      const tag = element?.tagName.toLowerCase();
      if (tag === 'a' && (element as HTMLAnchorElement).href) return 'dom_or_navigation';
      if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) return 'value';
      return 'dom_or_navigation';
    }
    case 'TYPE':
    case 'SELECT':
      return 'value';
    case 'NAVIGATE':
    case 'BACK':
      return 'navigation';
    case 'PRESS_KEY':
      return 'dom_or_navigation';
    default:
      return 'none';
  }
}

/** Resolves true as soon as the effect is seen, false at the timeout. Start it before acting. */
export function waitForEffect(effect: Effect, element: Element | null): Promise<boolean> {
  if (effect === 'none') return Promise.resolve(true);
  if (effect === 'value') {
    // The executor sets the value itself; observe via the input event on the element.
    return new Promise(resolve => {
      const done = () => { cleanup(); resolve(true); };
      const cleanup = () => { element?.removeEventListener('input', done); element?.removeEventListener('change', done); };
      element?.addEventListener('input', done, { once: true });
      element?.addEventListener('change', done, { once: true });
      setTimeout(() => { cleanup(); resolve(true); }, 200);
    });
  }
  return new Promise(resolve => {
    const url = location.href;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
      resolve(value);
    };
    const onNav = () => finish(true);
    const observer = new MutationObserver(mutations => {
      if (effect === 'navigation') return;
      // Ignore mutations inside our own overlay.
      const meaningful = mutations.some(m => !(m.target instanceof Element && m.target.closest('[data-gw-overlay]')));
      if (meaningful) finish(true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    const poll = setInterval(() => {
      if (location.href !== url) { clearInterval(poll); finish(true); }
    }, 50);
    setTimeout(() => { clearInterval(poll); finish(location.href !== url); }, TIMEOUT_MS);
  });
}
