// Element identity: the same function produces id_hash at extraction time and at
// execution time, so a target that moved or changed since the observation fails
// IDENTITY_MISMATCH instead of being acted on.
//
// id_hash = hash(tag | role | accessible name | dom path | 4px-quantized rect | frame)
import { computeAccessibleNameForElement, computeRoleForElement } from './extractor/a11y';

export type Rect4 = [number, number, number, number];

export function quantizeRect(rect: DOMRect | { left: number; top: number; width: number; height: number }, grid = 4): Rect4 {
  const q = (n: number) => Math.round(n / grid) * grid;
  return [q(rect.left), q(rect.top), q(rect.width), q(rect.height)];
}

export function domPathSignature(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    const id = current.getAttribute('id');
    if (id) {
      selector += `#${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}`;
    } else {
      let nth = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) nth++;
        sibling = sibling.previousElementSibling;
      }
      if (nth > 1) selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    const parent: Node | null = current.parentNode;
    // Cross a shadow boundary by continuing from the host element.
    current = parent instanceof ShadowRoot ? parent.host : (current.parentElement as Element | null);
  }
  return path.join(' > ');
}

export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function computeIdentityHash(element: Element, frameId: number): string {
  const tag = element.tagName.toLowerCase();
  const role = computeRoleForElement(element);
  const name = computeAccessibleNameForElement(element).trim().toLowerCase();
  const rect = quantizeRect(element.getBoundingClientRect());
  return fnv1a(`${tag}|${role}|${name}|${domPathSignature(element)}|${rect.join(',')}|${frameId}`);
}
