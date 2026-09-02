import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { SanitizedObservation } from '@glasswall/schema/observation';
import { registerRoutes } from './routes/index.js';
import { planWithFailover, scriptedProvider, type Provider } from './providers/index.js';
import { validateActionEnvelope } from './guard/validate.js';
import { extractJson } from './providers/openai-compatible.js';

function checkout(over: Partial<SanitizedObservation> = {}): SanitizedObservation {
  const el = (id: string, tag: string, label: string, extra: Partial<SanitizedObservation['elements'][number]> = {}) => ({
    id, id_hash: `h_${id}`, tag, role: tag === 'button' ? 'button' : 'textbox', label_raw: label, rect: [0, 0, 100, 30] as [number, number, number, number],
    visible: true, enabled: true, focusable: true, value_state: 'empty' as const, group: 'form', frame: 0, available_actions: tag === 'button' ? ['CLICK'] : ['TYPE', 'CLICK'], ...extra,
  });
  return {
    observation_id: 'obs_1', session_id: 's', step: 0,
    page: { origin_class: 'benchmark', url_template: '/shoplite/checkout', title_raw: 'Checkout', type_hint: 'checkout', modal_active: false, stability: 'stable' },
    viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
    elements: [
      el('e1', 'input', 'Full name', { type: 'text', autocomplete: 'name', sensitivity_class: 'PERSON_NAME' }),
      el('e2', 'input', 'Email', { type: 'email', autocomplete: 'email', sensitivity_class: 'EMAIL' }),
      el('e3', 'input', 'Phone', { type: 'tel', autocomplete: 'tel', sensitivity_class: 'PHONE' }),
      el('e4', 'input', 'Street address', { type: 'text', autocomplete: 'street-address', sensitivity_class: 'STREET_ADDRESS' }),
      el('e5', 'input', 'City', { type: 'text', autocomplete: 'address-level2', sensitivity_class: 'CITY' }),
      el('e6', 'input', 'PIN code', { type: 'text', autocomplete: 'postal-code', sensitivity_class: 'POSTAL_CODE' }),
      el('e7', 'input', 'Card number', { type: 'text', autocomplete: 'cc-number', sensitivity_class: 'CREDIT_CARD' }),
      el('e8', 'button', 'Place order', { value_state: 'n/a' }),
    ],
    text_nodes: [],
    frames: [],
    truncated: false,
    list_virtualized: false,
    handles: [
      { handle: '⟦PERSON_NAME#1⟧', type: 'PERSON_NAME', tier: 3, occurrences: 1, first_seen_step: 0 },
      { handle: '⟦EMAIL#2⟧', type: 'EMAIL', tier: 2, occurrences: 1, first_seen_step: 0 },
      { handle: '⟦PHONE#3⟧', type: 'PHONE', tier: 2, occurrences: 1, first_seen_step: 0 },
      { handle: '⟦STREET_ADDRESS#4⟧', type: 'STREET_ADDRESS', tier: 3, occurrences: 1, first_seen_step: 0 },
      { handle: '⟦CITY#5⟧', type: 'CITY', tier: 3, occurrences: 1, first_seen_step: 0 },
      { handle: '⟦POSTAL_CODE#6⟧', type: 'POSTAL_CODE', tier: 3, occurrences: 1, first_seen_step: 0 },
    ],
    budget: { steps_left: 20, ms_left: 300000 },
    ...over,
  };
}

const flaky = (name: string, behaviour: 'unavailable' | 'throws' | 'garbage' | 'repairs'): Provider => {
  let calls = 0;
  return {
    name,
    vision: false,
    available: async () => ({ ok: behaviour !== 'unavailable' }),
    plan: async input => {
      calls++;
      if (behaviour === 'throws') throw new Error('boom');
      if (behaviour === 'garbage') return { nonsense: true };
      // repairs: wrong id_hash first, fixed after the repair prompt
      return { action: { type: 'CLICK', target: { id: 'e8', id_hash: calls === 1 && !input.repairError ? 'wrong' : 'h_e8' } }, observation_id: 'obs_1', risk: 'high', requires_confirmation: true };
    },
  };
};

describe('gateway', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await registerRoutes(app, { providers: [flaky('primary', 'throws'), scriptedProvider] });
    await app.ready();
  });
  afterAll(() => app.close());

  it('reports provider health', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.providers.map((p: { name: string }) => p.name)).toEqual(['primary', 'scripted']);
    expect(body.active).toBe('primary');
  });

  it('rejects malformed requests and unknown sessions', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/session', payload: { task: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/step', payload: { session_id: 'nope', observation: checkout(), history: [] } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/step', payload: { session_id: 'x', observation: { ...checkout(), extra: 1 }, history: [] } })).statusCode).toBe(400);
  });

  it('fills a form field by field with vault references, falling over to the scripted planner', async () => {
    const session = (await app.inject({ method: 'POST', url: '/v1/session', payload: { task: 'Fill the shipping form with my saved details and place the order', policy_profile: 'STRICT', site_allowlist: [] } })).json();
    expect(session.session_id).toBeDefined();
    const history: unknown[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/step', payload: { session_id: session.session_id, observation: checkout(), history } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.provider).toBe('scripted');
      const action = body.action_envelope.action;
      seen.push(action.type === 'TYPE' ? `${action.target.id}←${action.value.handle}` : action.type);
      history.push(body.action_envelope);
      if (history.length > 5) history.shift(); // the client sends the last five, as the schema requires
      if (action.type === 'CLICK') break;
    }
    expect(seen).toEqual(['e1←⟦PERSON_NAME#1⟧', 'e2←⟦EMAIL#2⟧', 'e3←⟦PHONE#3⟧', 'e4←⟦STREET_ADDRESS#4⟧', 'e5←⟦CITY#5⟧', 'e6←⟦POSTAL_CODE#6⟧', 'CLICK']);
    // The card field was skipped: the task said nothing about payment.
    expect(seen.some(s => s.startsWith('e7'))).toBe(false);
  });

  it('answers a search-and-add task and a lookup task', async () => {
    const session = (await app.inject({ method: 'POST', url: '/v1/session', payload: { task: 'Search for wireless earbuds and add the top result to cart', policy_profile: 'STRICT', site_allowlist: [] } })).json();
    const products = checkout({
      elements: [
        { id: 'e1', id_hash: 'h1', tag: 'input', role: 'searchbox', type: 'search', label_raw: 'Search products', rect: [0, 0, 100, 30], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'header', frame: 0, available_actions: ['TYPE', 'CLICK'] },
        { id: 'e2', id_hash: 'h2', tag: 'button', role: 'button', label_raw: 'Add Wireless Earbuds to cart', rect: [0, 0, 100, 30], visible: true, enabled: true, focusable: true, value_state: 'n/a', group: 'main', frame: 0, available_actions: ['CLICK'] },
      ],
      handles: [],
    });
    const history: unknown[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const body = (await app.inject({ method: 'POST', url: '/v1/step', payload: { session_id: session.session_id, observation: products, history } })).json();
      const a = body.action_envelope.action;
      seen.push(a.type === 'TYPE' ? `TYPE:${a.value.text}` : a.type === 'DONE' ? `DONE:${a.outcome}` : a.type);
      history.push(body.action_envelope);
      if (a.type === 'DONE') break;
    }
    expect(seen).toEqual(['TYPE:wireless earbuds', 'PRESS_KEY', 'CLICK', 'DONE:success']);
  });

  it('gives up honestly on a task it cannot script', async () => {
    const session = (await app.inject({ method: 'POST', url: '/v1/session', payload: { task: 'Compose a haiku about the page', policy_profile: 'STRICT', site_allowlist: [] } })).json();
    const body = (await app.inject({ method: 'POST', url: '/v1/step', payload: { session_id: session.session_id, observation: checkout(), history: [] } })).json();
    expect(body.action_envelope.action).toEqual({ type: 'DONE', outcome: 'impossible' });
  });
});

describe('planWithFailover', () => {
  const input = { sessionId: 's', stepIndex: 0, task: 't', observation: checkout(), history: [], policy: { name: 'STRICT', require_confirmation: [] } as never };
  const validate = (raw: unknown) => validateActionEnvelope(raw, checkout(), { sessionId: 's', stepIndex: 0 });

  it('skips unavailable providers and repairs a fixable answer', async () => {
    const r = await planWithFailover([flaky('down', 'unavailable'), flaky('fixable', 'repairs')], input, validate);
    expect(r.provider).toBe('fixable');
    expect(r.attempts.map(a => `${a.provider}:${a.ok}`)).toEqual(['down:false', 'fixable:false', 'fixable:true']);
    expect(r.value.action).toEqual({ type: 'CLICK', target: { id: 'e8', id_hash: 'h_e8' } });
  });

  it('moves on from garbage and transport errors to the scripted planner', async () => {
    const r = await planWithFailover([flaky('garbage', 'garbage'), flaky('throws', 'throws'), scriptedProvider], { ...input, task: 'Fill the form' }, validate);
    expect(r.provider).toBe('scripted');
    expect(r.attempts.filter(a => a.provider === 'garbage')).toHaveLength(2);
    expect(r.attempts.filter(a => a.provider === 'throws')).toHaveLength(1);
  });

  it('throws when nothing works', async () => {
    await expect(planWithFailover([flaky('throws', 'throws')], input, validate)).rejects.toThrow(/No provider/);
  });
});

describe('guard', () => {
  it('normalizes loose model output and rejects references outside the observation', () => {
    const obs = checkout();
    expect(validateActionEnvelope({ action: { type: 'CLICK', target: 'e8' } }, obs, { sessionId: 's', stepIndex: 2 })).toMatchObject({ ok: true, value: { step_index: 2, action: { target: { id_hash: 'h_e8' } } } });
    expect(validateActionEnvelope({ action: { type: 'CLICK', target: { id: 'e99', id_hash: 'x' } }, observation_id: 'obs_1' }, obs, { sessionId: 's', stepIndex: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('UNKNOWN_TARGET') });
    expect(validateActionEnvelope({ action: { type: 'TYPE', target: 'e2', value: { kind: 'vault_ref', handle: '⟦AADHAAR#9⟧' } } }, obs, { sessionId: 's', stepIndex: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('UNKNOWN_HANDLE') });
    expect(validateActionEnvelope({ action: { type: 'CLICK', target: 'e8' }, observation_id: 'obs_0' }, obs, { sessionId: 's', stepIndex: 0 })).toMatchObject({ ok: false, error: expect.stringContaining('STALE') });
  });

  it('extracts JSON from fenced or chatty completions', () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('{"a":{"b":2}} trailing')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json here')).toThrow();
  });
});
