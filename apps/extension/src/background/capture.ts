// Screenshot capture and offscreen document lifecycle.
// No fetch here: the data URL is decoded by hand (hard rule 1).
import { OFFSCREEN_URL } from '../shared/config';
import type { PerceiveRequest, PerceiveResponse } from '../shared/perceive';

let creating: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (existing.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Runs local OCR/NER models and image redaction; the service worker cannot host WASM workers or canvases.',
      })
      .finally(() => { creating = null; });
  }
  await creating;
}

export async function captureVisibleTabDataUrl(windowId?: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId as number, { format: 'png' });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function perceiveInOffscreen(request: Omit<PerceiveRequest, 'type' | 'target'>, timeoutMs = 20_000): Promise<PerceiveResponse> {
  await ensureOffscreenDocument();
  const message: PerceiveRequest = { type: 'gw:perceive', target: 'offscreen', ...request };
  const timeout = new Promise<PerceiveResponse>(resolve => setTimeout(() => resolve({ ok: false, error: 'offscreen perceive timeout' }), timeoutMs));
  const reply = chrome.runtime.sendMessage(message) as Promise<PerceiveResponse | undefined>;
  const result = await Promise.race([reply.then(r => r ?? { ok: false as const, error: 'offscreen returned nothing' }), timeout]);
  return result;
}
