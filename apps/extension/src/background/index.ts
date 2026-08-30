// Background service worker - orchestration and message bus host
// Manages offscreen document lifecycle, RPC transport, and the step loop

import { bus } from '../shared/bus';
import '../shared/types-chrome';
import { initialize } from './orchestrator';
import { ensureOffscreenDocument, captureScreenshot } from './capture';
import { checkAndRecover } from './persist';
import type { RawObservation, CapturedFrame } from '@glasswall/schema/observation';

// Service worker startup
console.log('GLASSWALL service worker starting');

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  // Handle task start from side panel
  if (message.type === 'extension:start-task') {
    try {
      const { task, policy_profile, site_allowlist } = message.payload;
      await initialize(task, policy_profile, site_allowlist);
      sendResponse({ status: 'ok' });
    } catch (error) {
      console.error('Failed to initialize task:', error);
      sendResponse({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return true;
  }

  // Handle observation ready from content script (legacy - orchestrator now polls)
  if (message.type === 'extension:observation-ready') {
    sendResponse({ status: 'ok' });
    return true;
  }

  // Handle capture request
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
    return true;
  }

  // Handle abort from side panel
  if (message.type === 'extension:abort') {
    sendResponse({ status: 'ok' });
    return true;
  }

  // Handle session query from side panel
  if (message.type === 'extension:get-session') {
    sendResponse({ status: 'ok' });
    return true;
  }

  // Forward other messages to bus
  bus.publish(message as any);
  sendResponse({ status: 'ok' });
  return true;
});

// Handle connection from offscreen document
chrome.runtime.onConnectExternal.addListener((port) => {
  console.log('Service worker connected to external port:', port.name);

  port.onMessage.addListener((msg) => {
    console.log('Service worker received message via port:', msg);
    bus.publish(msg as any);
  });
});

// Handle bus messages for demonstration
bus.subscribe('system:ping', (message) => {
  console.log('Received ping:', message);

  const pongMessage = {
    type: 'system:pong',
    payload: { timestamp: Date.now() }
  } as const;

  bus.publish(pongMessage);
});

bus.subscribe('extension:ready', () => {
  console.log('Extension reports ready via bus');
});

// Handle messages from offscreen document via message bus
bus.subscribe('system:offscreen-request', async (message) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'system:offscreen-request' && 'payload' in message) {
    const typedMessage = message as { type: string; payload: { method: string; args: unknown[]; requestId: string } };

    try {
      await ensureOffscreenDocument();

      console.log(`GLASSWALL: Processing offscreen RPC method ${typedMessage.payload.method}`);

      bus.publish({
        type: 'system:offscreen-response',
        payload: {
          requestId: typedMessage.payload.requestId,
          result: { status: 'method_received', method: typedMessage.payload.method }
        }
      });
    } catch (error) {
      console.error('Error processing offscreen RPC:', error);

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

// Service worker lifecycle
chrome.runtime.onInstalled.addListener(() => {
  console.log('GLASSWALL service worker installed');
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('GLASSWALL service worker started up');
  await ensureOffscreenDocument().catch(console.error);
  
  // Try to recover session
  const recovery = await checkAndRecover();
  if (recovery.recovered) {
    console.log('Session recovered:', recovery.message);
  }
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('GLASSWALL service worker suspending');
});

chrome.runtime.onSuspendCanceled.addListener(() => {
  console.log('GLASSWALL service worker resume cancelled');
});

// Expose bus for debugging
// @ts-ignore
(window as any).__GLASSWALL_bus = bus;

console.log('GLASSWALL service worker started');