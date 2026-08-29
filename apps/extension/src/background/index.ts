// Background service worker - orchestration and message bus host
// Manages offscreen document lifecycle, RPC transport, and screenshot capture

import { bus } from '../shared/bus';
import '../shared/types-chrome';
import type { CapturedFrame, RawObservation } from '@glasswall/schema/observation';
import { send } from './net';

// Offscreen document management
let offscreenDocumentId: string | null = null;
let offscreenDocumentUrl: string | null = null;

// Session state
let sessionId: string | null = null;
let stepIndex: number = 0;

// Service worker startup
console.log('GLASSWALL service worker starting');

// Handle messages from content script
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log('Service worker received message:', message);

  // Handle observation ready from content script
  if (message.type === 'extension:observation-ready') {
    try {
      const observation = message.payload.observation as RawObservation;

      // Initialize session if needed
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        stepIndex = 0;
      } else {
        stepIndex++;
      }

      // Update observation with session and step info
      observation.session_id = sessionId;
      observation.step = stepIndex;

      // Store observation for screenshot processing
      // In a real implementation, we'd pass this to the offscreen document
      console.log('Received observation:', observation.observation_id);

      // Request screenshot capture
      const captureResult = await captureScreenshot(sender.tab?.id ?? -1);

      // Process observation and screenshot together (simplified for now)
      // In reality, we'd send both to offscreen document for processing

      // For now, just send observation to backend (would include screenshot data after processing)
      try {
        const response = await send({
          observation,
          // screenshot data would be added here after offscreen processing
          // For stub, we'll send observation only
        });

        // Handle backend response (would contain action)
        console.log('Backend response:', response);

        sendResponse({
          type: 'extension:observation-processed',
          payload: {
            observation_id: observation.observation_id,
            step: stepIndex
          }
        });
      } catch (backendError) {
        const err = backendError as Error;
        console.error('Backend communication failed:', err);
        sendResponse({
          type: 'extension:backend-error',
          payload: { error: err.message }
        });
      }
} catch (error: unknown) {
    console.error('Observation processing failed:', error);
    sendResponse({
      type: 'extension:observation-error',
      payload: { error: (error as Error).message }
    });
  }
    return true; // Keep message channel open for async response
  }

  // Handle screenshot ready from content script (alternative approach)
  if (message.type === 'extension:screenshot-ready') {
    try {
      console.log('Screenshot received:', message.payload.screenshot_id);
      // In full implementation, we'd combine observation and screenshot data
      sendResponse({ status: 'ok' });
    } catch (error) {
      const err = error as Error;
      console.error('Screenshot handling failed:', err);
      sendResponse({ status: 'error', error: err.message });
    }
    return true;
  }

  // Handle capture request (legacy - kept for compatibility)
  if (message.type === 'extension:capture-request') {
    try {
      const captureResult = await captureScreenshot(sender.tab?.id ?? -1);
      sendResponse({
        type: 'extension:capture-result',
        payload: captureResult
      });
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      sendResponse({
        type: 'extension:capture-error',
        payload: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
    }
    return true; // Keep message channel open for async response
  }

  // Handle other messages (forward to bus if needed)
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
    // Using 'WORKERS' reason as it's appropriate for ML inference and image processing
    await chrome.offscreen.createDocument({
      url: preferredUrl,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Needed for ML inference and image processing'
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

// Capture screenshot using chrome.tabs.captureVisibleTab
async function captureScreenshot(tabId: number): Promise<CapturedFrame> {
  // Ensure offscreen document is available for processing
  await ensureOffscreenDocument();

  // Capture visible tab
  const screenshotBlob = await new Promise<Blob>((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      tabId,
      { format: 'png' },
      (imageUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // Convert data URL to blob
        fetch(imageUrl)
          .then(response => response.blob())
          .then(resolve)
          .catch(reject);
      }
    );
  });

  // Get viewport dimensions and DPR from the tab
  const [viewportInfo] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    })
  });

  const viewportWidth = viewportInfo?.result?.viewportWidth ?? 0;
  const viewportHeight = viewportInfo?.result?.viewportHeight ?? 0;
  const devicePixelRatio = viewportInfo?.result?.devicePixelRatio ?? 1;

  // Create captured frame object
  const capturedFrame: CapturedFrame = {
    bitmap: screenshotBlob, // This will be processed further in offscreen document
    dpr: devicePixelRatio,
    viewport_w: viewportWidth,
    viewport_h: viewportHeight,
    captured_at: Date.now(),
    stale: false
  };

  return capturedFrame;
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