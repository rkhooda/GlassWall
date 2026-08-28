// Background service worker - orchestrator and message bus host

import { bus } from '../shared/bus';
import './shared/types-chrome';

// Service worker startup
console.log('GLASSWALL service worker starting');

// Handle messages from content script, side panel, etc.
// In MV3, we use chrome.runtime.onMessageExternal or chrome.runtime.onMessage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Service worker received message:', message);

  // Forward to our internal bus if needed
  // bus.publish(message as any);

  // Send response if needed
  sendResponse({ status: 'ok' });
  return true; // Keep message channel open for async response
});

// Handle connection from offscreen document
chrome.runtime.onConnectExternal.addListener((port) => {
  console.log('Service worker connected to external port:', port.name);

  port.onMessage.addListener((msg) => {
    console.log('Service worker received message via port:', msg);
    // Forward to bus
    bus.publish(msg as any);
  });
});

// Handle bus messages for demonstration
const unsubscribe = bus.subscribe('system:ping', (message) => {
  console.log('Received ping:', message);

  // Send pong back
  const pongMessage = {
    type: 'system:pong',
    payload: { timestamp: Date.now() }
  } as const;

  bus.publish(pongMessage);
});

// Log when bus is ready
bus.subscribe('extension:ready', () => {
  console.log('Extension reports ready via bus');
});

// Expose bus for debugging (remove in production)
// @ts-ignore
(window as any).__GLASSWALL_bus = bus;

console.log('GLASSWALL service worker started');