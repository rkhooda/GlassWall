// Offscreen document: hosts the local models (OCR, NER) and image redaction, which
// need DOM, OffscreenCanvas and WASM that a service worker does not provide. It
// answers the worker's requests and performs no network I/O; every asset loads
// through chrome.runtime.getURL().
import type { OffscreenRequest } from '../shared/perceive';
import { perceive, redactFrame, warmup, stats } from './pipeline/perceive';

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: unknown) => void) => {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Partial<OffscreenRequest>;
  if (m.target !== 'offscreen' || !m.type) return false;
  const work =
    m.type === 'gw:perceive' ? perceive(m as Extract<OffscreenRequest, { type: 'gw:perceive' }>)
    : m.type === 'gw:redact' ? redactFrame(m as Extract<OffscreenRequest, { type: 'gw:redact' }>)
    : m.type === 'gw:warmup' ? warmup(m as Extract<OffscreenRequest, { type: 'gw:warmup' }>)
    : m.type === 'gw:stats' ? stats()
    : null;
  if (!work) return false;
  work.then(sendResponse).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
