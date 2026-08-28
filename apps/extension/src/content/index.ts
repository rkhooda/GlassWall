// Content script - DOM extraction and action execution entry point

import { bus } from '../shared/bus';
import './shared/types-chrome';
import { RawObservation } from '../../packages/schema/src/observation';

console.log('GLASSWALL content script starting');

let observationId = 0;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  // Handle capture request
  if (message.type === 'extension:capture-request') {
    // In a real implementation, we would:
    // 1. Extract DOM/A11y tree to create RawObservation
    // 2. Send observation ID back to service worker
    // 3. Request screenshot capture

    observationId++;
    const observationIdStr = `obs_${observationId}`;

    // Send observation ready notification
    sendResponse({
      type: 'extension:observation-ready',
      payload: { observation_id: observationIdStr }
    });

    return true; // Keep channel open for async response
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