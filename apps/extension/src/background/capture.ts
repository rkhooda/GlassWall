// Screenshot capture - extracted from index.ts for reuse by orchestrator

import type { CapturedFrame } from '@glasswall/schema/observation';

// Offscreen document management
let offscreenDocumentId: string | null = null;
let offscreenDocumentUrl: string | null = null;

export async function ensureOffscreenDocument(preferredUrl: string = 'offscreen.html') {
  if (offscreenDocumentId && offscreenDocumentUrl === preferredUrl) {
    return offscreenDocumentId;
  }

  if (offscreenDocumentId) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (error) {
      console.warn('Failed to close existing offscreen document:', error);
    }
    offscreenDocumentId = null;
    offscreenDocumentUrl = null;
  }

  try {
    await chrome.offscreen.createDocument({
      url: preferredUrl,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Needed for ML inference and image processing'
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const contexts = await chrome.runtime.getContexts({
      documentUrls: [preferredUrl]
    });

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

    if (preferredUrl !== 'sandbox.html') {
      try {
        await chrome.offscreen.createDocument({
          url: 'sandbox.html',
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification: 'Fallback for ML inference when CSP blocks workers in offscreen.html'
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        const contexts = await chrome.runtime.getContexts({
          documentUrls: ['sandbox.html']
        });

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
      throw error;
    }
  }
}

export async function captureScreenshot(tabId: number): Promise<CapturedFrame> {
  await ensureOffscreenDocument();

  const screenshotBlob = await new Promise<Blob>((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      tabId,
      { format: 'png' },
      (imageUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        fetch(imageUrl)
          .then(response => response.blob())
          .then(resolve)
          .catch(reject);
      }
    );
  });

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

  const capturedFrame: CapturedFrame = {
    bitmap: screenshotBlob,
    dpr: devicePixelRatio,
    viewport_w: viewportWidth,
    viewport_h: viewportHeight,
    captured_at: Date.now(),
    stale: false
  };

  return capturedFrame;
}