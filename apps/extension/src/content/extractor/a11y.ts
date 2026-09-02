// Accessibility utilities for computing accessible names, roles, and states
// Uses dom-accessibility-api to avoid reimplementing the accessible name computation

import {
  computeAccessibleName,
  getRole,
  isDisabled,
  isInaccessible
} from 'dom-accessibility-api';

// Compute accessible name for an element
export function computeAccessibleNameForElement(element: Element): string {
  try {
    const name = computeAccessibleName(element);
    return name || '';
  } catch (e) {
    // Fallback to basic name computation if the API fails
    return getAccessibleNameFallback(element);
  }
}

// Fallback accessible name computation
function getAccessibleNameFallback(element: Element): string {
  // aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null && ariaLabel.trim() !== '') {
    return ariaLabel.trim();
  }

  // aria-labelledby
  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const ids = ariaLabelledBy.split(/\s+/);
    let name = '';
    for (const id of ids) {
      const labelledElement = document.getElementById(id);
      if (labelledElement) {
        name += labelledElement.textContent || '';
      }
    }
    if (name.trim() !== '') {
      return name.trim();
    }
  }

  // <label> element
  const labelElement = getAssociatedLabelElement(element);
  if (labelElement) {
    return labelElement.textContent.trim();
  }

  // placeholder (for input/textarea)
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const placeholder = element.getAttribute('placeholder');
    if (placeholder !== null) {
      return placeholder;
    }
  }

  // title attribute
  const title = element.getAttribute('title');
  if (title !== null && title.trim() !== '') {
    return title.trim();
  }

  // text content (last resort)
  return element.textContent?.trim() || '';
}

// Get associated label element for form controls
function getAssociatedLabelElement(element: Element): HTMLElement | null {
  // Check if element has id and there's a label[for] pointing to it
  const elementId = element.getAttribute('id');
  if (elementId) {
    const label = document.querySelector(`label[for="${CSS.escape(elementId)}"]`);
    if (label) {
      return label as HTMLElement;
    }
  }

  // Check if element is inside a label element
  let parent: Element | null = element.parentElement;
  while (parent) {
    if (parent.tagName === 'LABEL') {
      // We know this is an HTMLLabelElement which extends HTMLElement
      return parent as HTMLElement;
    }
    parent = parent.parentElement;
  }

  return null;
}

// Get computed role for an element
export function computeRoleForElement(element: Element): string {
  try {
    const role = getRole(element);
    return role || element.tagName.toLowerCase();
  } catch (e) {
    return getRoleFallback(element);
  }
}

// Fallback role computation
function getRoleFallback(element: Element): string {
  // Check explicit role attribute
  const roleAttr = element.getAttribute('role');
  if (roleAttr) {
    return roleAttr;
  }

  // Default roles based on tag name
  switch (element.tagName.toLowerCase()) {
    case 'input': {
      const type = element.getAttribute('type') || 'text';
      switch (type) {
        case 'checkbox': return 'checkbox';
        case 'radio': return 'radio';
        case 'button': case 'submit': case 'reset': case 'image': return 'button';
        case 'text': case 'password': case 'email': case 'url': case 'tel': case 'search':
        case 'number': case 'range': case 'color': case 'date': case 'datetime':
        case 'datetime-local': case 'month': case 'time': case 'week': return 'textbox';
        case 'file': return 'button';
        case 'hidden': return 'none';
        default: return 'textbox';
      }
    }
    case 'textarea': return 'textbox';
    case 'select': return 'combobox';
    case 'button': return 'button';
    case 'a': return (element as HTMLElement).hasAttribute('href') ? 'link' : 'button';
    case 'img': return (element as HTMLElement).hasAttribute('alt') ? 'img' : 'graphic';
    case 'ul': return 'list';
    case 'ol': return 'list';
    case 'li': return 'listitem';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'p': return 'paragraph';
    case 'div': return 'generic';
    case 'span': return 'generic';
    case 'header': return 'banner';
    case 'footer': return 'contentinfo';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'section': return 'region';
    case 'article': return 'article';
    case 'aside': return 'complementary';
    case 'table': return 'table';
    case 'thead': return 'rowgroup';
    case 'tbody': return 'rowgroup';
    case 'tfoot': return 'rowgroup';
    case 'tr': return 'row';
    case 'td': case 'th': return 'gridcell';
    default: return element.tagName.toLowerCase();
  }
}

// Check if element is disabled
export function isElementDisabled(element: Element): boolean {
  try {
    return isDisabled(element);
  } catch (e) {
    return isDisabledFallback(element);
  }
}

// Fallback disabled check
function isDisabledFallback(element: Element): boolean {
  // Native disabled attribute
  if (element.hasAttribute('disabled')) {
    return true;
  }

  // Check if inside a disabled fieldset
  let parent = element.parentElement;
  while (parent) {
    if (parent.tagName === 'FIELDSET' && parent.hasAttribute('disabled')) {
      return true;
    }
    parent = parent.parentElement;
  }

  return false;
}

// Check if element is hidden (inaccessible)
export function isElementHidden(element: Element): boolean {
  try {
    return isInaccessible(element);
  } catch (e) {
    return isHiddenFallback(element);
  }
}

// Fallback hidden check
function isHiddenFallback(element: Element): boolean {
  // aria-hidden
  if (element.getAttribute('aria-hidden') === 'true') {
    return true;
  }

  // Check computed style
  const style = window.getComputedStyle(element);
  if (style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0) {
    return true;
  }

  // Check if any ancestor is hidden
  let parent = element.parentElement;
  while (parent) {
    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.display === 'none' ||
        parentStyle.visibility === 'hidden' ||
        parseFloat(parentStyle.opacity) === 0) {
      return true;
    }
    parent = parent.parentElement;
  }

  return false;
}

// Check if element is focusable
export function isElementFocusable(element: Element): boolean {
  // Focusable elements
  const focusableTags = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

  if (focusableTags.has(element.tagName)) {
    // Check if disabled
    if (isElementDisabled(element)) {
      return false;
    }

    // Check tabindex
    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null) {
      const tabIndex = parseInt(tabindex, 10);
      return tabIndex >= 0;
    }

    // For anchors, check href
    if (element.tagName === 'A') {
      return element.hasAttribute('href');
    }

    return true;
  }

  // Check explicit tabindex
  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== null) {
    const tabIndex = parseInt(tabindex, 10);
    return tabIndex >= 0;
  }

  // Check role-based focusability
  const role = computeRoleForElement(element);
  const focusableRoles = new Set([
    'button', 'checkbox', 'combobox', 'link', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'radio', 'radiogroup', 'searchbox', 'slider', 'spinbutton',
    'switch', 'tab', 'textbox', 'treeitem'
  ]);

  return focusableRoles.has(role);
}

// Get element state (enabled/focusable/etc)
export function getElementState(element: Element): {
  enabled: boolean;
  focusable: boolean;
} {
  return {
    enabled: !isElementDisabled(element),
    focusable: isElementFocusable(element)
  };
}