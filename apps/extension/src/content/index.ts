// Content script: extracts observations, executes validated actions, draws the
// overlay. It talks only to the service worker over chrome.runtime messaging and
// performs no network I/O.
import type { WorkerToContent, ContentReply } from '../shared/messages';
import { observePage } from './extractor/observe';
import { executeAction } from './executor';
import { showOverlay, clearOverlay } from './overlay';

const EVAL_ATTR_PREFIX = 'gwEval';

function setEvalHook(key: string, value: string): void {
  // Read by the Playwright harness via page.evaluate; attributes are visible from
  // the page's main world while content-script variables are not.
  document.documentElement.dataset[`${EVAL_ATTR_PREFIX}${key[0]!.toUpperCase()}${key.slice(1)}`] = value;
}

async function handle(message: WorkerToContent): Promise<ContentReply> {
  switch (message.type) {
    case 'gw:ping':
      return { type: 'gw:pong' };
    case 'gw:observe': {
      const observation = await observePage({ observationId: message.observationId, sessionId: message.sessionId, step: message.step });
      return { type: 'gw:observation', observation };
    }
    case 'gw:execute': {
      const result = await executeAction(message.action, message.observation);
      return { type: 'gw:action-result', result };
    }
    case 'gw:overlay':
      showOverlay(message.observation, message.redactions);
      return { type: 'gw:ok' };
    case 'gw:overlay-clear':
      clearOverlay();
      return { type: 'gw:ok' };
    case 'gw:eval-hook':
      setEvalHook(message.key, message.value);
      return { type: 'gw:ok' };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (reply: ContentReply) => void) => {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  const typed = message as WorkerToContent;
  if (!String(typed.type).startsWith('gw:')) return false;
  handle(typed)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ type: 'gw:content-error', message: error instanceof Error ? error.message : String(error) }));
  return true;
});

setEvalHook('ready', '1');
