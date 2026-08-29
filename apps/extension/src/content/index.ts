// Content script - DOM extraction and action execution entry point

import { bus } from '../shared/bus';
import '../shared/types-chrome';
import type { RawObservation, Rect, Viewport, PageInfo } from '@glasswall/schema';
import { traverseElements } from './extractor/walk';
import { waitForFullStability } from './extractor/stability';
import {
  computeAccessibleNameForElement,
  computeRoleForElement,
  getElementState,
  isElementHidden
} from './extractor/a11y';

console.log('GLASSWALL content script starting');

let observationId = 0;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  // Handle capture request
  if (message.type === 'extension:capture-request') {
    try {
      // Wait for DOM and route stability before extracting
      const stabilityResult = await waitForFullStability();
      console.log('Stability check result:', stabilityResult);

      // Extract DOM/A11y tree to create RawObservation
      observationId++;
      const observationIdStr = `obs_${observationId}`;

      // Get viewport info
      const [viewportInfo] = await chrome.scripting.executeScript({
        target: { tabId: sender.tab?.id ?? -1 },
        func: () => ({
          w: window.innerWidth,
          h: window.innerHeight,
          scroll_y_pct: window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100,
          doc_h_ratio: document.body.scrollHeight / window.innerHeight,
          dpr: window.devicePixelRatio
        })
      });

      const viewport: Viewport = {
        w: viewportInfo?.result?.w ?? window.innerWidth,
        h: viewportInfo?.result?.h ?? window.innerHeight,
        scroll_y_pct: viewportInfo?.result?.scroll_y_pct ?? (window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100),
        doc_h_ratio: viewportInfo?.result?.doc_h_ratio ?? (document.body.scrollHeight / window.innerHeight),
        dpr: viewportInfo?.result?.dpr ?? window.devicePixelRatio
      };

      // Get page info
      const pageInfo: PageInfo = {
        origin_class: window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')
          ? 'benchmark'
          : 'external',
        url_template: window.location.pathname.replace(/\/[^\/]+/g, '/{id}'), // Simple template
        title_raw: document.title,
        type_hint: 'other', // Simplified - would need ML classification in reality
        modal_active: false, // Simplified
        stability: stabilityResult.isStable ? 'stable' : 'timeout'
      };

      // Extract elements using our tree walker
      const elements = [];
      const textNodes = [];

      for (const elementData of traverseElements(viewport)) {
        const { element, index, rect, visible, enabled, focusable, valueState, role, label, placeholder, tag, type, optionsCount, group, frame, unexplained } = elementData;

        // Skip if element is hidden
        if (isElementHidden(element)) {
          continue;
        }

        // Create element object
        const rawElement = {
          id: `e${index}`,
          id_hash: '', // Would be computed with crypto in real implementation
          tag,
          role,
          type: type ?? undefined,
          label_raw: label || '',
          placeholder_raw: placeholder ?? undefined,
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)] as [number, number, number, number],
          visible,
          enabled,
          focusable,
          value_state: valueState,
          options_count: optionsCount ?? undefined,
          group: group || '',
          frame: frame ?? 0,
          unexplained: unexplained ?? false,
          autocomplete: undefined, // Simplified
          input_type: type ?? undefined
        };

        elements.push(rawElement);

        // Extract text nodes if element has text content
        if (element.textContent && element.textContent.trim()) {
          const textRect = element.getBoundingClientRect();
          const rawTextNode = {
            id: `t${elements.length}`, // Simple ID for text nodes
            rect: [Math.round(textRect.left), Math.round(textRect.top), Math.round(textRect.width), Math.round(textRect.height)] as [number, number, number, number],
            text: element.textContent.trim(),
            owner_element_id: `e${index}`,
            source: 'dom' as const
          };
          textNodes.push(rawTextNode);
        }
      }

      // Create frames info (simplified)
      const frames = [{
        id: 0,
        origin: 'same' as const,
        rect: [0, 0, viewport.w, viewport.h] as [number, number, number, number]
      }];

      // Build RawObservation
      const rawObservation: RawObservation = {
        observation_id: observationIdStr,
        session_id: 'placeholder-session-id', // Would come from service worker
        step: 0, // Would come from service worker
        page: pageInfo,
        viewport,
        elements,
        text_nodes: textNodes,
        frames,
        truncated: false,
        list_virtualized: false
      };

      // Send observation to service worker
      sendResponse({
        type: 'extension:observation-ready',
        payload: { observation: rawObservation }
      });

      // Request screenshot capture
      chrome.runtime.sendMessage({
        type: 'extension:screenshot-request',
        payload: { observation_id: observationIdStr }
      });

      return true; // Keep channel open for async response
    } catch (error) {
      const err = error as Error;
      console.error('Error in capture request:', err);
      sendResponse({
        type: 'extension:capture-error',
        payload: { error: err.message }
      });
      return true;
    }
  }

  // Handle execute action request
  if (message.type === 'extension:execute-action') {
    console.log('Executing action:', message.payload);
    // In real implementation, we would:
    // 1. Validate action against current observation
    // 2. Execute the action in the page
    // 3. Verify effect and return result

    sendResponse({
      type: 'extension:action-result',
      payload: { ok: true, effect_observed: true }
    });

    return true;
  }

  sendResponse({ status: 'ok' });
  return true;
});

// Report ready to bus (in real implementation, this would be via message to SW)
// For skeleton, we'll just log
console.log('Content script reporting ready');

// Try to send ready message to service worker
try {
  chrome.runtime.sendMessage(
    { type: 'extension:ready', payload: {} },
    (response) => {
      console.log('Content script ready acknowledgment:', response);
    }
  );
} catch (error) {
  console.warn('Could not send ready message (may be expected in skeleton):', error);
}

// Expose for debugging
// @ts-ignore
(window as any).__GLASSWALL_content = {
  sendMessage: (msg: any) => chrome.runtime.sendMessage(msg),
  observationId
};

console.log('GLASSWALL content script started');