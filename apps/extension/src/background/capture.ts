// Screenshot capture and the offscreen document: lifecycle plus typed request helpers.
// No fetch here: data URLs are decoded by hand (hard rule 1).
import { OFFSCREEN_URL } from '../shared/config';
import type { PerceiveRequest, PerceiveResponse, RedactRequest, RedactResponse, WarmupRequest, WarmupResponse, StatsResponse } from '../shared/perceive';

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

/**
 * PNG data URL of the target tab, or null if capture is not possible (no permission
 * on this origin). captureVisibleTab only sees the active tab of a window, so the
 * target is activated first; a run acts on a visible page anyway.
 */
export async function captureVisibleTabDataUrl(tabId: number): Promise<{ dataUrl: string | null; error?: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      await chrome.tabs.update(tabId, { active: true });
      await new Promise(r => setTimeout(r, 120));
    }
    return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }) };
  } catch (e) {
    return { dataUrl: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function askOffscreen<T>(message: { target: 'offscreen'; type: string }, timeoutMs: number, fallback: T): Promise<T> {
  await ensureOffscreenDocument();
  const timeout = new Promise<T>(resolve => setTimeout(() => resolve(fallback), timeoutMs));
  const reply = (chrome.runtime.sendMessage(message)).then(r => r ?? fallback).catch(() => fallback);
  return Promise.race([reply, timeout]);
}

export function perceiveInOffscreen(request: Omit<PerceiveRequest, 'type' | 'target'>, timeoutMs = 25_000): Promise<PerceiveResponse> {
  return askOffscreen<PerceiveResponse>({ type: 'gw:perceive', target: 'offscreen', ...request }, timeoutMs, { ok: false, error: 'offscreen perceive timeout' });
}

export function redactInOffscreen(request: Omit<RedactRequest, 'type' | 'target'>, timeoutMs = 8_000): Promise<RedactResponse> {
  return askOffscreen<RedactResponse>({ type: 'gw:redact', target: 'offscreen', ...request }, timeoutMs, { ok: false, error: 'offscreen redact timeout' });
}

export function warmUpInOffscreen(request: Omit<WarmupRequest, 'type' | 'target'>, timeoutMs = 60_000): Promise<WarmupResponse> {
  return askOffscreen<WarmupResponse>({ type: 'gw:warmup', target: 'offscreen', ...request }, timeoutMs, { ok: false, error: 'warm-up timeout' });
}

export function statsFromOffscreen(timeoutMs = 3_000): Promise<StatsResponse | null> {
  return askOffscreen<StatsResponse | null>({ type: 'gw:stats', target: 'offscreen' }, timeoutMs, null);
}
