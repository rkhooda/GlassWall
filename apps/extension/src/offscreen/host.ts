// Offscreen document: hosts local models (OCR, NER) and image processing, which
// need DOM, OffscreenCanvas and WASM that a service worker does not provide.
// It answers 'gw:perceive' requests from the service worker and performs no
// network I/O; every asset loads through chrome.runtime.getURL().
import type { PerceiveRequest, PerceiveResponse } from '../shared/perceive';
import { perceive } from './pipeline/perceive';

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: PerceiveResponse) => void) => {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as { type?: string; target?: string } & Partial<PerceiveRequest>;
  if (m.target !== 'offscreen' || m.type !== 'gw:perceive') return false;
  perceive(m as PerceiveRequest)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
