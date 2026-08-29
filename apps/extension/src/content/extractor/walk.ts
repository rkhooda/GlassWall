// TreeWalker-based DOM traversal for element extraction
// Implements PLAN.md section 12.2: Element extraction

import { createRect, area, intersects, quantizeRect } from '@glasswall/perception';
import {
  computeAccessibleNameForElement,
  computeRoleForElement,
  getElementState,
  isElementHidden
} from './a11y';

// Import stability checking for validation ladder
import { waitForFullStability } from './stability';

// Import types from schema
import type { Rect } from '@glasswall/schema';

// Configuration
const POLICY_OFFSCREEN_MARGIN = 50; // pixels outside viewport to ignore
const INTERSECTION_CORNER_INSET = 2; // pixels inset for corner hit-tests

// Frame tracking
let frameIdCounter = 0;
const frameMap = new Map<Window, number>(); // window -> frameId

// Element ID counter for this observation
let elementIdCounter = 0;

/**
 * Get or assign a frame ID for a window
 */
function getFrameId(window: Window): number {
  if (window === window.top) {
    return 0; // top-level frame
  }

  if (frameMap.has(window)) {
    return frameMap.get(window)!;
  }

  // Assign new frame ID
  const frameId = ++frameIdCounter;
  frameMap.set(window, frameId);
  return frameId;
}

/**
 * Check if two origins are same-origin
 */
function isSameOrigin(url1: string, url2: string): boolean {
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);
    return u1.protocol === u2.protocol &&
           u1.host === u2.host &&
           u1.port === u2.port;
  } catch (e) {
    return false;
  }
}

/**
 * Check if element is interactive per PLAN.md criteria
 */
function isInteractiveElement(element: Element): boolean {
  // Check for interactive tags/attributes
  const tag = element.tagName.toLowerCase();

  // Interactive elements by tag
  if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) {
    // Special case: anchor without href is not interactive
    if (tag === 'a' && !element.hasAttribute('href')) {
      return false;
    }
    // Special case: input types that are not interactive
    if (tag === 'input') {
      const type = element.getAttribute('type')?.toLowerCase() || 'text';
      if (['hidden', 'button', 'submit', 'reset', 'image'].includes(type)) {
        return type !== 'hidden'; // hidden inputs are not interactive
      }
    }
    return true;
  }

  // Elements with role attribute (if role indicates interactivity)
  const role = element.getAttribute('role');
  if (role) {
    const interactiveRoles = new Set([
      'button', 'checkbox', 'combobox', 'link', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'radio', 'radiogroup', 'searchbox', 'slider', 'spinbutton',
      'switch', 'tab', 'textbox', 'treeitem'
    ]);
    if (interactiveRoles.has(role)) {
      return true;
    }
  }

  // Elements with onclick handler
  if (element.hasAttribute('onclick')) {
    return true;
  }

  // Elements with tabindex >= 0
  const tabindex = parseInt(element.getAttribute('tabindex') || '-1', 10);
  if (tabindex >= 0) {
    return true;
  }

  // Contenteditable elements
  if ('isContentEditable' in element && (element as HTMLElement).isContentEditable) {
    return true;
  }

  return false;
}

/**
 * Check if element is a text-bearing leaf with non-empty accessible text
 */
function isTextBearingLeaf(element: Element): boolean {
  // Must have non-empty accessible text
  const name = computeAccessibleNameForElement(element);
  if (!name || name.trim() === '') {
    return false;
  }

  // Must be a leaf element (no element children)
  // But can have text nodes
  const children = element.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && child.nodeType === Node.ELEMENT_NODE) {
      return false;
    }
  }

  // Must have non-zero area
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Check if element is a landmark/section container for group_path
 */
function isLandmarkOrSection(element: Element): boolean {
  const tag = element.tagName.toLowerCase();

  // Landmark elements
  if (['header', 'footer', 'nav', 'main'].includes(tag)) {
    return true;
  }

  // Sectioning elements
  if (['section', 'article', 'aside'].includes(tag)) {
    return true;
  }

  // Elements with role indicating landmark/region
  const role = element.getAttribute('role');
  const landmarkRoles = new Set([
    'banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation',
    'region', 'search'
  ]);

  if (role && landmarkRoles.has(role)) {
    return true;
  }

  return false;
}

/**
 * Check inclusion criteria per PLAN.md 12.2
 */
function meetsInclusionCriteria(element: Element): boolean {
  return isInteractiveElement(element) ||
         isTextBearingLeaf(element) ||
         isLandmarkOrSection(element);
}

/**
 * Check exclusion criteria per PLAN.md 12.2
 */
function meetsExclusionCriteria(
  element: Element,
  viewport: { w: number; h: number; scroll_y_pct: number; doc_h_ratio: number }
): boolean {
  // Zero area
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return true;
  }

  // Check if hidden
  if (isElementHidden(element)) {
    return true;
  }

  // Check if outside viewport by more than offscreen margin
  const margin = POLICY_OFFSCREEN_MARGIN;
  const viewportRect = {
    x: -margin,
    y: -margin,
    width: viewport.w + 2 * margin,
    height: viewport.h + 2 * margin
  };

  if (!intersects(
    createRect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height),
    createRect(rect.left, rect.top, rect.width, rect.height)
  )) {
    return true;
  }

  // Note: overflow clipping and occlusion are handled separately
  // in the visibility testing function

  return false;
}

/**
 * Test if element is occluded using center and 4 corner hit-testing
 * Returns true if occluded (modal is above it)
 */
function isOccluded(element: Element): boolean {
  const rect = element.getBoundingClientRect();

  // Skip if zero area
  if (rect.width === 0 || rect.height === 0) {
    return true;
  }

  // Test points: center and 4 corners inset by INTERSECTION_CORNER_INSET
  const testPoints = [
    // Center
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    // Top-left corner (inset)
    { x: rect.left + INTERSECTION_CORNER_INSET, y: rect.top + INTERSECTION_CORNER_INSET },
    // Top-right corner (inset)
    { x: rect.right - INTERSECTION_CORNER_INSET, y: rect.top + INTERSECTION_CORNER_INSET },
    // Bottom-left corner (inset)
    { x: rect.left + INTERSECTION_CORNER_INSET, y: rect.bottom - INTERSECTION_CORNER_INSET },
    // Bottom-right corner (inset)
    { x: rect.right - INTERSECTION_CORNER_INSET, y: rect.bottom - INTERSECTION_CORNER_INSET }
  ];

  // For each test point, check if elementFromPoint returns the element or a descendant
  for (const point of testPoints) {
    const hitElement = document.elementFromPoint(point.x, point.y);
    if (hitElement && (hitElement === element || element.contains(hitElement))) {
      // At least one point hits the element or its descendant -> not occluded
      return false;
    }
  }

  // None of the test points hit the element or its descendants -> occluded
  return true;
}

/**
 * Generate element ID and identity hash per PLAN.md 12.2
 */
function generateElementIds(
  element: Element,
  index: number,
  frameId: number,
  quantizedRect: Rect
): { id: string; idHash: string } {
  // Short, model-friendly ID
  const elementId = `e${index}`;

  // For identity hash, we need:
  // tag | role | normalized_accessible_name | dom_path_signature | quantized_rect | frame_id
  // Since we don't have crypto.subtle in content scripts, we'll use a simple hash
  // In production, this would be SHA-256

  const tag = element.tagName.toLowerCase();
  const role = computeRoleForElement(element);
  const accessibleName = computeAccessibleNameForElement(element).trim();
  const domPath = getDomPathSignature(element);

  // Simple string concatenation for hash input (in prod, use proper hashing)
  const hashInput = `${tag}|${role}|${accessibleName}|${domPath}|${quantizedRect[0]},${quantizedRect[1]},${quantizedRect[2]},${quantizedRect[3]}|${frameId}`;

  // Simple hash function (for demo - replace with real SHA-256 in prod)
  const idHash = simpleHash(hashInput).substring(0, 12);

  return { id: elementId, idHash };
}

/**
 * Get DOM path signature for an element
 * Simplified version - in prod would be more robust
 */
function getDomPathSignature(element: Element): string {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    const id = current.getAttribute('id');
    if (id) {
      selector += `#${CSS.escape(id)}`;
    } else {
      // Use nth-of-type among siblings with same tag name
      let sameTypeSiblings = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          sameTypeSiblings++;
        }
        sibling = sibling.previousElementSibling;
      }
      if (sameTypeSiblings > 0) {
        selector += `:nth-of-type(${sameTypeSiblings + 1})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement as Element;
  }

  return path.join(' > ');
}

/**
 * Simple hash function (not crypto-secure, for demo only)
 * In production, use crypto.subtle.digest('SHA-256', ...)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Process shadow DOM root recursively
 */
function* processShadowRoot(root: ShadowRoot, frameId: number): any {
  // Process all elements in the shadow root
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => NodeFilter.FILTER_ACCEPT
    }
  );

  let node;
  while ((node = walker.nextNode())) {
    // Ensure node is an Element (TreeWalker with SHOW_ELEMENT should guarantee this)
    if (node.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const element = node as Element;
    yield element;

    // Recursively process nested shadow roots
    if (element.shadowRoot) {
      yield* processShadowRoot(element.shadowRoot, frameId);
    }
  }
}

/**
 * Process iframe content document
 * Only processes same-origin iframes (cross-origin handled elsewhere)
 */
function* processIframe(iframe: HTMLIFrameElement, frameId: number): any {
  try {
    // Check if same-origin
    if (!isSameOrigin(iframe.src, window.location.href)) {
      // Cross-origin iframe - handled as opaque rect elsewhere
      return;
    }

    // Access the iframe's document
    const iframeDoc = iframe.contentDocument;
    if (!iframeDoc) {
      return;
    }

    // Process the iframe's body
    const body = iframeDoc.body;
    if (!body) {
      return;
    }

    // Create TreeWalker for iframe document
    const walker = document.createTreeWalker(
      body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => NodeFilter.FILTER_ACCEPT
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      // Ensure node is an Element (TreeWalker with SHOW_ELEMENT should guarantee this)
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = node as Element;
      yield element;

      // Recursively process shadow roots in iframe
      if (element.shadowRoot) {
        yield* processShadowRoot(element.shadowRoot, frameId);
      }

      // Process nested iframes in iframe
      if (element.tagName === 'IFRAME' && (element as HTMLIFrameElement).contentDocument) {
        yield* processIframe(element as HTMLIFrameElement, frameId);
      }
    }
  } catch (e) {
    // Access denied (likely cross-origin) - ignore
    return;
  }
}

/**
 * Main traversal function
 * Extracts elements from document.body with shadow DOM and iframe support
 */
export function* traverseElements(
  viewport: { w: number; h: number; scroll_y_pct: number; doc_h_ratio: number }
) {
  // Reset counters for this observation
  elementIdCounter = 0;
  frameIdCounter = 0;
  frameMap.clear();

  // Process top-level document
  yield* processElementSubtree(document.body, 0, viewport);

  // Process iframes in top-level document
  const iframes = document.querySelectorAll('iframe');
  const iframeArray = Array.from(iframes);
  for (const iframe of iframeArray) {
    yield* processIframe(iframe as HTMLIFrameElement, 0);
  }
}

/**
 * Process a subtree of elements (used for document body and shadow roots)
 */
function* processElementSubtree(
  root: ParentNode,
  frameId: number,
  viewport: { w: number; h: number; scroll_y_pct: number; doc_h_ratio: number }
): any {
  // Create TreeWalker for this root
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => NodeFilter.FILTER_ACCEPT
    }
  );

  let node;
  while ((node = walker.nextNode())) {
    const element = node as Element;

    // Skip if not in our ownership (per LANE-A.md)
    // Note: In practice, we might want to check ownership here
    // but for now we'll process everything and filter later

    // Check inclusion criteria
    if (!meetsInclusionCriteria(element)) {
      continue;
    }

    // Check exclusion criteria
    if (meetsExclusionCriteria(element, viewport)) {
      continue;
    }

    // Get bounding rect
    const rect = element.getBoundingClientRect();

    // Check occlusion/visibility
    const visible = !isOccluded(element);

    // Get element state
    const { enabled, focusable } = getElementState(element);

    // Compute role and accessible name (label)
    const role = computeRoleForElement(element);
    const label = computeAccessibleNameForElement(element);

    // Get placeholder (for input/textarea)
    let placeholder: string | undefined;
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const attr = element.getAttribute('placeholder');
      placeholder = attr !== null ? attr : undefined;
    }

    // Get tag and type
    const tag = element.tagName.toLowerCase();
    let type: string | undefined;
    if (tag === 'input') {
      type = element.getAttribute('type')?.toLowerCase() || undefined;
    }

    // Get options count (for select)
    let optionsCount: number | undefined;
    if (tag === 'select') {
      optionsCount = (element as HTMLSelectElement).options.length;
    }

    // Get group path (simplified - in prod would be computed properly)
    const group = getGroupPath(element);

    // Unexplained flag (set to true for cross-origin iframes, etc.)
    let unexplained: boolean | undefined;
    // This will be set by the caller when processing iframe elements

    // Yield the element data
    yield {
      element,
      index: ++elementIdCounter,
      frameId,
      rect,
      visible,
      enabled,
      focusable,
      valueState: getValueState(element),
      role,
      label,
      placeholder,
      tag,
      type,
      optionsCount,
      group,
      unexplained
    };

    // Recursively process shadow roots
    if (element.shadowRoot) {
      yield* processElementSubtree(element.shadowRoot, frameId, viewport);
    }
  }
}

/**
 * Get value state of form element
 */
function getValueState(element: Element): 'empty' | 'partial' | 'filled' | 'n/a' {
  const tag = element.tagName.toLowerCase();

  // Non-form elements
  if (!['input', 'select', 'textarea'].includes(tag)) {
    return 'n/a';
  }

  // Check based on element type
  switch (tag) {
    case 'input': {
      const type = element.getAttribute('type')?.toLowerCase() || 'text';
      // Skip hidden inputs and button-like inputs
      if (['hidden', 'button', 'submit', 'reset', 'image', 'file'].includes(type)) {
        return 'n/a';
      }

      // For checkbox/radio, check checked state
      if (type === 'checkbox' || type === 'radio') {
        return (element as HTMLInputElement).checked ? 'filled' : 'empty';
      }

      // For text-like inputs, check value length
      const value = (element as HTMLInputElement).value;
      if (value.length === 0) {
        return 'empty';
      } else {
        // Simplified: treat any non-empty as filled
        // In prod, might distinguish partial based on validation
        return 'filled';
      }
    }

    case 'textarea': {
      const value = (element as HTMLTextAreaElement).value;
      return value.length === 0 ? 'empty' : 'filled';
    }

    case 'select': {
      const select = element as HTMLSelectElement;
      return select.selectedIndex >= 0 ? 'filled' : 'empty';
    }

    default:
      return 'n/a';
  }
}

/**
 * Get group path for element (simplified implementation)
 * In production, this would traverse up to find form/fieldset/etc hierarchy
 */
function getGroupPath(element: Element): string {
  // Start with the element itself
  const parts: string[] = [];

  // Traverse up to find meaningful containers
  let current: Element | null = element;
  let levels = 0;
  const maxLevels = 5; // Limit depth to avoid overly long paths

  while (current && current !== document.body && levels < maxLevels) {
    // Check if this is a meaningful container for grouping
    const tag = current.tagName.toLowerCase();
    const id = current.getAttribute('id');

    // Add form, fieldset, section, etc. with ID if present
    if ((['form', 'fieldset', 'section', 'div'].includes(tag) ||
         current.hasAttribute('role')) && id) {
      parts.unshift(`${tag}#${CSS.escape(id)}`);
    } else if (['form', 'fieldset', 'section'].includes(tag)) {
      parts.unshift(tag);
    }

    current = current.parentElement as Element;
    levels++;
  }

  // Add the element itself if it has an ID
  const elementId = element.getAttribute('id');
  const elementTag = element.tagName.toLowerCase();
  if (elementId) {
    parts.push(`${elementTag}#${CSS.escape(elementId)}`);
  } else {
    parts.push(elementTag);
  }

  return parts.join(' > ');
}

// Type alias for DOMRect to avoid duplication
type DOMRectRaw = DOMRect;