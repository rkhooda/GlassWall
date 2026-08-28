// Background service worker - orchestration and message bus host
// Manages offscreen document lifecycle and RPC transport

import { bus } from '../shared/bus';
import './shared/types-chrome';

// Offscreen document management
let offscreenDocumentId: string | null = null;
let offscreenDocumentUrl: string | null = null;

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

// Manage offscreen document lifecycle
async function ensureOffscreenDocument(preferredUrl: string = 'offscreen.html') {
  if (offscreenDocumentId && offscreenDocumentUrl === preferredUrl) {
    // Note: In a real implementation, we would check if the document is still valid
    // For simplicity in this skeleton, we'll assume it's valid if we have an ID
    return offscreenDocumentId;
  }

  // If we have a different URL or no ID, we need to recreate
  if (offscreenDocumentId) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (error) {
      console.warn('Failed to close existing offscreen document:', error);
    }
    offscreenDocumentId = null;
    offscreenDocumentUrl = null;
  }

  // Create or recreate offscreen document
  try {
    // Try to create offscreen document with the preferred URL
    // Using 'WORKERS' reason as it's appropriate for ML inference
    await chrome.offscreen.createDocument({
      url: preferredUrl,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Needed for ML inference'
    });

    // Wait a bit for the document to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get the context ID for the created document using runtime.getContexts
    const contexts = await chrome.runtime.getContexts({
      // Filter by document URL to find our context
      documentUrls: [preferredUrl]
    });

    // Find our context (should be the first match)
    const context = contexts.find(ctx => ctx.documentUrl === preferredUrl);
    if (context && context.contextId) {
      offscreenDocumentId = context.contextId;
      offscreenDocumentUrl = preferredUrl;
      console.log('GLASSWALL: Created offscreen document with ID:', context.contextId, 'URL:', preferredUrl);
      return context.contextId;
    } else {
      throw new Error('Failed to find context for created offscreen document');
    }
  } catch (error) {
    console.error('Failed to create offscreen document with URL', preferredUrl, ':', error);

    // Fallback to sandbox.html if CSP blocks worker creation in offscreen.html
    if (preferredUrl !== 'sandbox.html') {
      try {
        await chrome.offscreen.createDocument({
          url: 'sandbox.html',
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification: 'Fallback for ML inference when CSP blocks workers in offscreen.html'
        });

        // Wait a bit for the document to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get the context ID for the created document using runtime.getContexts
        const contexts = await chrome.runtime.getContexts({
          // Filter by document URL to find our context
          documentUrls: ['sandbox.html']
        });

        // Find our context (should be the first match)
        const context = contexts.find(ctx => ctx.documentUrl === 'sandbox.html');
        if (context && context.contextId) {
          offscreenDocumentId = context.contextId;
          offscreenDocumentUrl = 'sandbox.html';
          console.log('GLASSWALL: Created fallback offscreen document (sandbox) with ID:', context.contextId);
          return context.contextId;
        } else {
          throw new Error('Failed to find context for fallback offscreen document');
        }
      } catch (fallbackError) {
        console.error('Failed to create fallback offscreen document:', fallbackError);
        throw fallbackError;
      }
    } else {
      // If we're already trying sandbox.html and it failed, rethrow
      throw error;
    }
  }
}

// Handle messages from offscreen document via message bus
// Using system:* namespace for Lane A to Lane A communication
bus.subscribe('system:offscreen-request', async (message) => {
  // Type guard to ensure we're handling the right message type
  if (message && typeof message === 'object' && 'type' in message && message.type === 'system:offscreen-request' && 'payload' in message) {
    const typedMessage = message as { type: string; payload: { method: string; args: unknown[]; requestId: string } };

    try {
      // Ensure offscreen document is available
      await ensureOffscreenDocument();

      // For now, we'll handle this locally with a simple response
      // In Phase 2, Lane B will implement the actual handlers that run in the offscreen document
      console.log(`GLASSWALL: Processing offscreen RPC method ${typedMessage.payload.method}`);

      // Send response back through bus
      bus.publish({
        type: 'system:offscreen-response',
        payload: {
          requestId: typedMessage.payload.requestId,
          result: { status: 'method_received', method: typedMessage.payload.method }
        }
      });
    } catch (error) {
      console.error('Error processing offscreen RPC:', error);

      // Send error response
      bus.publish({
        type: 'system:offscreen-response',
        payload: {
          requestId: (message as any).payload.requestId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
});

// Handle service worker lifecycle events
chrome.runtime.onInstalled.addListener(() => {
  console.log('GLASSWALL service worker installed');
});

// Handle service worker startup
chrome.runtime.onStartup.addListener(() => {
  console.log('GLASSWALL service worker started up');
  // Ensure offscreen document is ready
  ensureOffscreenDocument().catch(console.error);
});

// Handle service worker shutdown (attempt to cleanup)
chrome.runtime.onSuspend.addListener(() => {
  console.log('GLASSWALL service worker suspending');
});

// Handle service worker resume
chrome.runtime.onSuspendCanceled.addListener(() => {
  console.log('GLASSWALL service worker resume cancelled');
});

// Expose bus for debugging (remove in production)
// @ts-ignore
(window as any).__GLASSWALL_bus = bus;

console.log('GLASSWALL service worker started');