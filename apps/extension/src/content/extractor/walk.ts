// DOM traversal for element extraction (PLAN §12.2, archived).
//
// This file is the privacy boundary: it never reads `.value`, `.innerHTML`,
// `.outerHTML`, cookies or storage. `value_state` is derived from attributes and
// pseudo-classes only. scripts/verify-boundary.sh greps this directory for those
// reads and fails the build if one appears.
import { computeAccessibleNameForElement, computeRoleForElement, getElementState, isElementHidden } from './a11y';
import { computeIdentityHash, quantizeRect, type Rect4 } from '../identity';

const OFFSCREEN_MARGIN_PX = 50;
const CORNER_INSET_PX = 2;
const MAX_LABEL_CHARS = 200;

export interface Viewport {
  w: number;
  h: number;
}

export interface WalkedElement {
  element: Element;
  id: string;
  id_hash: string;
  tag: string;
  role: string;
  type?: string;
  label: string;
  placeholder?: string;
  rect: Rect4;
  visible: boolean;
  enabled: boolean;
  focusable: boolean;
  value_state: 'empty' | 'partial' | 'filled' | 'n/a';
  options_count?: number;
  group: string;
  frame: number;
  unexplained: boolean;
  autocomplete?: string;
  input_type?: string;
}

export interface WalkedFrame {
  id: number;
  origin: 'same' | 'cross';
  rect: Rect4;
}

export interface WalkResult {
  elements: WalkedElement[];
  frames: WalkedFrame[];
  truncated: boolean;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem', 'option',
]);
const LANDMARK_TAGS = new Set(['header', 'footer', 'nav', 'main', 'section', 'article', 'aside', 'form', 'fieldset']);
const LANDMARK_ROLES = new Set(['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search']);

export function isInteractive(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return element.hasAttribute('href');
  if (tag === 'input') return (element.getAttribute('type') ?? 'text').toLowerCase() !== 'hidden';
  if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
  const role = element.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (element.hasAttribute('onclick')) return true;
  const tabindex = parseInt(element.getAttribute('tabindex') ?? '-1', 10);
  if (tabindex >= 0) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function isTextLeaf(element: Element): boolean {
  if (element.children.length > 0) return false;
  const text = element.textContent?.trim() ?? '';
  return text.length > 0;
}

const MEDIA_TAGS = new Set(['canvas', 'img', 'video', 'object', 'embed', 'svg']);

/** Pixels the DOM cannot explain: kept so coverage can mask or OCR them. */
function isMedia(element: Element): boolean {
  return MEDIA_TAGS.has(element.tagName.toLowerCase());
}

function isLandmark(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (LANDMARK_TAGS.has(tag)) return true;
  const role = element.getAttribute('role');
  return !!role && LANDMARK_ROLES.has(role);
}

function inViewport(rect: DOMRect, viewport: Viewport): boolean {
  return (
    rect.right >= -OFFSCREEN_MARGIN_PX &&
    rect.bottom >= -OFFSCREEN_MARGIN_PX &&
    rect.left <= viewport.w + OFFSCREEN_MARGIN_PX &&
    rect.top <= viewport.h + OFFSCREEN_MARGIN_PX
  );
}

/** Hit-test the centre and four inset corners; visible if any point reaches the element. */
export function isOccluded(element: Element, doc: Document = document): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return true;
  const root = element.getRootNode();
  const from = root instanceof ShadowRoot && typeof root.elementFromPoint === 'function' ? root : doc;
  if (typeof from.elementFromPoint !== 'function') return false; // no hit-testing available (tests)
  const points = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + CORNER_INSET_PX, rect.top + CORNER_INSET_PX],
    [rect.right - CORNER_INSET_PX, rect.top + CORNER_INSET_PX],
    [rect.left + CORNER_INSET_PX, rect.bottom - CORNER_INSET_PX],
    [rect.right - CORNER_INSET_PX, rect.bottom - CORNER_INSET_PX],
  ];
  for (const [x, y] of points) {
    const hit = from.elementFromPoint(x!, y!);
    if (hit && (hit === element || element.contains(hit) || hit.contains(element))) return false;
  }
  return true;
}

/**
 * value_state without reading the value: `:placeholder-shown` tells us a text control
 * with a placeholder is empty; `validity.valueMissing` tells us a required control is
 * empty; a textarea exposes `textLength`; checkboxes/radios/selects expose state.
 * Anything else is 'n/a', and the agent re-observes after typing.
 */
export function valueState(element: Element): WalkedElement['value_state'] {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const input = element as HTMLInputElement;
    const type = (input.getAttribute('type') ?? 'text').toLowerCase();
    if (['hidden', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'].includes(type)) return 'n/a';
    if (type === 'checkbox' || type === 'radio') return input.checked ? 'filled' : 'empty';
    if (input.hasAttribute('placeholder')) {
      try {
        return input.matches(':placeholder-shown') ? 'empty' : 'filled';
      } catch {
        /* jsdom may not support the pseudo-class */
      }
    }
    if (input.required && typeof input.validity?.valueMissing === 'boolean') return input.validity.valueMissing ? 'empty' : 'filled';
    return 'n/a';
  }
  if (tag === 'textarea') {
    const ta = element as HTMLTextAreaElement;
    if (typeof ta.textLength === 'number') return ta.textLength === 0 ? 'empty' : 'filled';
    return 'n/a';
  }
  if (tag === 'select') {
    const select = element as HTMLSelectElement;
    const selected = select.selectedIndex;
    if (selected < 0) return 'empty';
    const option = select.options[selected];
    return option && option.hasAttribute('value') && option.getAttribute('value') === '' ? 'empty' : 'filled';
  }
  return 'n/a';
}

export function groupPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element.parentElement;
  let depth = 0;
  while (current && current !== document.body && depth < 8) {
    const tag = current.tagName.toLowerCase();
    if (LANDMARK_TAGS.has(tag) || current.hasAttribute('role')) {
      const id = current.getAttribute('id');
      parts.unshift(id ? `${tag}#${id}` : tag);
    }
    current = current.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

interface WalkContext {
  viewport: Viewport;
  counter: number;
  out: WalkedElement[];
  frames: WalkedFrame[];
  maxElements: number;
  truncated: boolean;
}

function walkRoot(root: Document | ShadowRoot, frameId: number, unexplainedRoot: boolean, ctx: WalkContext, doc: Document): void {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (ctx.out.length >= ctx.maxElements) {
      ctx.truncated = true;
      return;
    }
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;

    if (element.shadowRoot) walkRoot(element.shadowRoot, frameId, unexplainedRoot, ctx, doc);
    if (tag === 'iframe') {
      walkIframe(element as HTMLIFrameElement, frameId, ctx);
      continue;
    }

    const interactive = isInteractive(element);
    const media = isMedia(element);
    if (!interactive && !media && !isTextLeaf(element) && !isLandmark(element)) continue;
    if (isElementHidden(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (!inViewport(rect, ctx.viewport)) continue;

    const id = `e${++ctx.counter}`;
    const { enabled, focusable } = getElementState(element);
    const type = tag === 'input' ? (element.getAttribute('type') ?? 'text').toLowerCase() : undefined;
    const autocomplete = element.getAttribute('autocomplete') ?? undefined;
    const placeholder = element.getAttribute('placeholder') ?? undefined;
    ctx.out.push({
      element,
      id,
      id_hash: computeIdentityHash(element, frameId),
      tag,
      role: computeRoleForElement(element),
      type,
      label: computeAccessibleNameForElement(element).trim().slice(0, MAX_LABEL_CHARS),
      placeholder,
      rect: quantizeRect(rect),
      visible: !isOccluded(element, doc),
      enabled,
      focusable,
      value_state: valueState(element),
      options_count: tag === 'select' ? (element as HTMLSelectElement).options.length : undefined,
      group: groupPath(element),
      frame: frameId,
      unexplained: unexplainedRoot || media,
      autocomplete,
      input_type: type,
    });
  }
}

function walkIframe(iframe: HTMLIFrameElement, parentFrame: number, ctx: WalkContext): void {
  const rect = iframe.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || !inViewport(rect, ctx.viewport)) return;
  const frameId = ctx.frames.length + 1;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    doc = null;
  }
  const origin: 'same' | 'cross' = doc ? 'same' : 'cross';
  ctx.frames.push({ id: frameId, origin, rect: quantizeRect(rect) });
  if (!doc?.body) {
    // Cross-origin: the region exists but nothing inside can be explained.
    ctx.out.push({
      element: iframe,
      id: `e${++ctx.counter}`,
      id_hash: computeIdentityHash(iframe, parentFrame),
      tag: 'iframe',
      role: 'document',
      label: iframe.getAttribute('title') ?? '',
      rect: quantizeRect(rect),
      visible: !isOccluded(iframe),
      enabled: false,
      focusable: false,
      value_state: 'n/a',
      group: groupPath(iframe),
      frame: parentFrame,
      unexplained: true,
    });
    return;
  }
  // Same-origin: walk its document; rects are offset by the frame position.
  const offsetX = rect.left;
  const offsetY = rect.top;
  const before = ctx.out.length;
  walkRoot(doc, frameId, false, ctx, doc);
  for (let i = before; i < ctx.out.length; i++) {
    const el = ctx.out[i]!;
    el.rect = [el.rect[0] + Math.round(offsetX), el.rect[1] + Math.round(offsetY), el.rect[2], el.rect[3]];
  }
}

export function walkDocument(viewport: Viewport, maxElements = 400): WalkResult {
  const ctx: WalkContext = { viewport, counter: 0, out: [], frames: [{ id: 0, origin: 'same', rect: [0, 0, viewport.w, viewport.h] }], maxElements, truncated: false };
  walkRoot(document, 0, false, ctx, document);
  return { elements: ctx.out, frames: ctx.frames, truncated: ctx.truncated };
}
