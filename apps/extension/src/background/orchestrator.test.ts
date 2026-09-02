// The error matrix, against the real orchestrator with a fake tab, a fake gateway and
// a fake offscreen document. Every case here is a way a demo can go wrong.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionEnvelope } from '@glasswall/schema/action';
import type { StepRequest } from '@glasswall/schema/transport';
import { checkoutPage, EMAIL, AADHAAR } from '@glasswall/privacy/test-fixtures';
import { resetRateLimitForTests } from '@glasswall/privacy';

const wire: Array<{ path: string; body: string }> = [];
const tab: Array<{ type: string; action?: { type: string; value?: { kind: string; text?: string } } }> = [];
const panel: Array<{ type: string; [k: string]: unknown }> = [];
let plans: Array<(req: StepRequest) => ActionEnvelope>;
let sendImpl: (p: { path: string; body?: unknown }) => Promise<{ status: number; body: unknown }>;
let perceiveOk = true;
let observation = () => checkoutPage(0);

vi.mock('./net', () => ({ send: (p: { path: string; body?: unknown }) => sendImpl(p) }));
vi.mock('./capture', () => ({
  captureVisibleTabDataUrl: async () => ({ dataUrl: null }),
  warmUpInOffscreen: async () => ({ ok: true }),
  statsFromOffscreen: async () => null,
  redactInOffscreen: async () => ({ ok: false, error: 'no frame' }),
  perceiveInOffscreen: async () =>
    perceiveOk
      ? { ok: true, sources: [{ id: 'ner', evidence: [], degraded: [], unexplained: [], failed: false }], timings: { ner: 1 }, degraded: [] }
      : { ok: false, error: 'offscreen crashed' },
}));

const session: Record<string, unknown> = {};
const withCallback = <T,>(value: T, cb?: (v: T) => void) => { cb?.(value); return Promise.resolve(value); };
(globalThis as { chrome?: unknown }).chrome = {
  runtime: {
    lastError: undefined,
    sendMessage: (m: { type: string }) => { panel.push(m); return Promise.resolve(undefined); },
    getURL: (p: string) => `chrome-extension://id/${p}`,
  },
  tabs: {
    query: async () => [{ id: 7, url: 'http://localhost:5173/shoplite/checkout', active: true }],
    sendMessage: async (_id: number, m: { type: string; action?: never }) => {
      tab.push(m);
      if (m.type === 'gw:ping') return { type: 'gw:pong' };
      if (m.type === 'gw:observe') return { type: 'gw:observation', observation: observation() };
      if (m.type === 'gw:execute') return { type: 'gw:action-result', result: { ok: true, effect_observed: true, error_code: 'NONE' } };
      return { type: 'gw:ok' };
    },
  },
  scripting: { executeScript: async () => [] },
  storage: {
    session: {
      get: (keys: string[], cb?: (r: Record<string, unknown>) => void) => withCallback(Object.fromEntries(keys.length ? keys.filter(k => k in session).map(k => [k, session[k]]) : Object.entries(session)), cb),
      set: (items: Record<string, unknown>, cb?: () => void) => { Object.assign(session, items); return withCallback(undefined, cb); },
      remove: (keys: string[], cb?: () => void) => { for (const k of keys) delete session[k]; return withCallback(undefined, cb); },
      clear: (cb?: () => void) => { for (const k of Object.keys(session)) delete session[k]; return withCallback(undefined, cb); },
    },
  },
};

const { startRun, getState, getAudit, abortRun, respondConfirmation } = await import('./orchestrator');

function fakeGateway(): typeof sendImpl {
  let step = 0;
  return async p => {
    wire.push({ path: p.path, body: JSON.stringify(p.body ?? null) });
    if (p.path === '/v1/session') return { status: 200, body: { session_id: 'sess-1', provider: 'fake', budget: { steps_left: 20, ms_left: 300_000 } } };
    const req = p.body as StepRequest;
    const plan = plans[Math.min(step++, plans.length - 1)]!;
    return { status: 200, body: { action_envelope: plan(req), provider: 'fake', latency_ms: 1 } };
  };
}

const el = (req: StepRequest, id: string) => req.observation.elements.find(e => e.id === id)!;
const handleOf = (req: StepRequest, type: string) => req.observation.handles!.find(h => h.type === type)!.handle;
const envelope = (req: StepRequest, action: ActionEnvelope['action'], extra: Partial<ActionEnvelope> = {}): ActionEnvelope =>
  ({ observation_id: req.observation.observation_id, step_index: req.observation.step, session_id: req.session_id, action, risk: 'low', requires_confirmation: false, reasoning: '', ...extra }) as ActionEnvelope;
const done = (req: StepRequest) => envelope(req, { type: 'DONE', outcome: 'success' });

beforeEach(() => {
  wire.length = 0; tab.length = 0; panel.length = 0;
  for (const k of Object.keys(session)) delete session[k];
  perceiveOk = true;
  observation = () => checkoutPage(0);
  sendImpl = fakeGateway();
  resetRateLimitForTests();
});

describe('startRun', () => {
  it('fills a field from the vault: the literal reaches the tab, the wire only ever sees handles', async () => {
    plans = [
      req => envelope(req, { type: 'TYPE', target: { id: 'e1', id_hash: el(req, 'e1').id_hash }, value: { kind: 'vault_ref', handle: handleOf(req, 'EMAIL') }, clear_first: true }),
      done,
    ];
    await startRun('Fill the email field', 'STRICT');
    expect(getState()).toMatchObject({ status: 'done', outcome: 'success', provider: 'fake' });
    const typed = tab.find(m => m.type === 'gw:execute')!;
    expect(typed.action?.value).toEqual({ kind: 'literal', text: EMAIL });
    expect(wire.length).toBe(3);
    for (const w of wire) {
      expect(w.body).not.toContain(EMAIL);
      expect(w.body).not.toContain(AADHAAR.replace(/\s/g, ''));
    }
    const audit = await getAudit();
    expect(audit.map(a => [a.action, a.validation])).toEqual([['TYPE', 'ok'], ['DONE', 'ok']]);
    expect(audit[0]!.handle_count).toBeGreaterThan(0);
  });

  it('blocks a hijacked plan that types the Aadhaar handle into the search box', async () => {
    plans = [
      req => envelope(req, { type: 'TYPE', target: { id: 'e3', id_hash: el(req, 'e3').id_hash }, value: { kind: 'vault_ref', handle: handleOf(req, 'AADHAAR') }, clear_first: true }),
      done,
    ];
    await startRun('Search for my order', 'STRICT');
    expect(getState().status).toBe('done');
    expect(tab.some(m => m.type === 'gw:execute')).toBe(false);
    expect((await getAudit())[0]!.validation).toBe('VAULT_TYPE_MISMATCH');
    expect(panel.some(m => m.type === 'gw:error' && m.code === 'VAULT_TYPE_MISMATCH')).toBe(true);
    for (const w of wire) expect(w.body).not.toContain(AADHAAR.replace(/\s/g, ''));
  });

  it('refuses a literal that contains a registered secret and a stale observation', async () => {
    plans = [
      req => envelope(req, { type: 'TYPE', target: { id: 'e3', id_hash: el(req, 'e3').id_hash }, value: { kind: 'literal', text: `find ${EMAIL}` }, clear_first: true }),
      req => ({ ...envelope(req, { type: 'CLICK', target: { id: 'e4', id_hash: el(req, 'e4').id_hash } }), observation_id: 'obs_old' }),
      done,
    ];
    await startRun('t', 'STRICT');
    expect((await getAudit()).map(a => a.validation)).toEqual(['LITERAL_CONTAINS_SECRET', 'STALE_OBSERVATION', 'ok']);
  });

  it('stops after three blocked actions in a row', async () => {
    plans = [req => envelope(req, { type: 'CLICK', target: { id: 'e99', id_hash: 'nope' } })];
    await startRun('t', 'STRICT');
    expect(getState()).toMatchObject({ status: 'error' });
    expect(getState().message).toMatch(/3 blocked actions.*UNKNOWN_TARGET/);
  });

  it('asks before placing an order and honours a denial', async () => {
    plans = [req => envelope(req, { type: 'CLICK', target: { id: 'e4', id_hash: el(req, 'e4').id_hash } }), done];
    const run = startRun('Place the order', 'STRICT');
    await vi.waitFor(() => expect(getState().status).toBe('waiting_confirmation'));
    expect(panel.find(m => m.type === 'gw:confirm-request')).toMatchObject({ context: { actionType: 'CLICK', targetLabel: 'Place order', risk: 'high' } });
    respondConfirmation(false);
    await run;
    expect(getState()).toMatchObject({ status: 'aborted', message: 'User denied the action' });
    expect(tab.some(m => m.type === 'gw:execute')).toBe(false);
  });

  it('fails loudly when the gateway is down', async () => {
    sendImpl = async () => { throw new TypeError('Failed to fetch'); };
    await startRun('t', 'STRICT');
    expect(getState().status).toBe('error');
    expect(getState().message).toMatch(/Gateway unreachable/);
    expect(panel.some(m => m.type === 'gw:error' && m.code === 'GATEWAY_UNREACHABLE')).toBe(true);
  });

  it('surfaces a provider failure from the gateway as an error, never a hang', async () => {
    const gateway = fakeGateway();
    sendImpl = async p => (p.path === '/v1/step' ? { status: 502, body: { error: 'ALL_PROVIDERS_FAILED', message: 'every provider failed' } } : gateway(p));
    await startRun('t', 'STRICT');
    expect(getState()).toMatchObject({ status: 'error', message: 'every provider failed' });
  });

  it('completes with more redaction when the local models are unavailable', async () => {
    perceiveOk = false;
    plans = [done];
    await startRun('t', 'STRICT');
    expect(getState().status).toBe('done');
    const audit = await getAudit();
    expect(audit[0]!.degraded.some(d => /ner/.test(d))).toBe(true);
    for (const w of wire) expect(w.body).not.toContain(EMAIL);
  });

  it('can be aborted while running', async () => {
    plans = [req => envelope(req, { type: 'SCROLL', direction: 'down', amount: 50 })];
    const run = startRun('t', 'STRICT');
    await vi.waitFor(() => expect(tab.some(m => m.type === 'gw:execute')).toBe(true));
    abortRun();
    await run;
    expect(getState().status).toBe('aborted');
  });

  it('needs a web page', async () => {
    (globalThis as unknown as { chrome: { tabs: { query: () => Promise<unknown[]> } } }).chrome.tabs.query = async () => [{ id: 1, url: 'chrome://extensions' }];
    await startRun('t', 'STRICT');
    expect(getState()).toMatchObject({ status: 'error' });
    expect(getState().message).toMatch(/web page/);
  });
});
