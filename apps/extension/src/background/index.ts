// Service worker: the single message router. Owns the run (orchestrator), the
// offscreen document, and the only network call site (net.ts).
import type { PanelToWorker } from '../shared/messages';
import { startRun, abortRun, respondConfirmation, getState, getAudit, getHealth } from './orchestrator';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: unknown) => void) => {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  const m = message as PanelToWorker & { target?: string };
  if (m.target === 'offscreen') return false; // addressed to the offscreen document
  if (sender.tab) return false; // content scripts only reply, they do not initiate
  switch (m.type) {
    case 'gw:start':
      startRun(m.task, m.policy).then(() => sendResponse({ ok: true }), (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    case 'gw:abort':
      abortRun();
      sendResponse({ ok: true });
      return false;
    case 'gw:confirm-response':
      respondConfirmation(m.approved);
      sendResponse({ ok: true });
      return false;
    case 'gw:get-state':
      sendResponse(getState());
      return false;
    case 'gw:get-audit':
      getAudit().then(sendResponse);
      return true;
    case 'gw:get-health':
      getHealth().then(sendResponse);
      return true;
    default:
      return false;
  }
});
