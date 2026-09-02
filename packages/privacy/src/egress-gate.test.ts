import { describe, it, expect, beforeEach } from 'vitest';
import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { StepRequest } from '@glasswall/schema/transport';
import { egressGate, resetRateLimitForTests } from './egress-gate';
import { PROFILES } from './policy';
import { createSessionSecrets } from './session-secrets';

const policy = PROFILES.STRICT.policy;

function observation(over: Partial<SanitizedObservation> = {}): SanitizedObservation {
  return {
    observation_id: 'obs_1',
    session_id: 'sess',
    step: 1,
    page: { origin_class: 'benchmark', url_template: '/shoplite/checkout', title_raw: 'ShopLite Checkout', type_hint: 'checkout', modal_active: false, stability: 'stable' },
    viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
    elements: [
      { id: 'e1', id_hash: 'h1', tag: 'input', role: 'textbox', type: 'email', label_raw: 'Email', placeholder_raw: 'you@example.com', rect: [0, 0, 100, 30], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'form', frame: 0, sensitivity_class: 'EMAIL', available_actions: ['TYPE', 'CLICK'] },
      { id: 'e2', id_hash: 'h2', tag: 'button', role: 'button', label_raw: 'Place order', rect: [0, 40, 100, 30], visible: true, enabled: true, focusable: true, value_state: 'n/a', group: 'form', frame: 0, available_actions: ['CLICK'] },
    ],
    text_nodes: [{ id: 't1', rect: [0, 80, 300, 20], text: 'Contact ⟦EMAIL#1⟧ or ⟦PHONE#2⟧', owner_element_id: 'e2', source: 'dom' }],
    frames: [{ id: 0, origin: 'same', rect: [0, 0, 1280, 720] }],
    truncated: false,
    list_virtualized: false,
    handles: [{ handle: '⟦EMAIL#1⟧', type: 'EMAIL', tier: 2, occurrences: 1, first_seen_step: 1 }],
    budget: { steps_left: 19, ms_left: 300000 },
    ...over,
  };
}

const step = (obs = observation()): StepRequest => ({ session_id: 'sess', observation: obs, history: [] });
const gate = (body: unknown, registry = new Map(), pol = policy, destination?: string) =>
  egressGate({ path: '/v1/step', body }, registry, pol, destination);

describe('egressGate', () => {
  beforeEach(resetRateLimitForTests);

  it('accepts a realistic sanitized step request', () => {
    const r = gate(step());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.destination).toBe('http://localhost:3000');
      expect(r.value.path).toBe('/v1/step');
      expect(r.value.method).toBe('POST');
      expect(r.value.body).toEqual(step());
    }
  });

  it('1 schema: rejects unknown keys anywhere', () => {
    const body = step();
    (body.observation as unknown as Record<string, unknown>).cookies = 'a=b';
    const r = gate(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SCHEMA_CONFORMANCE');
  });

  it('1 schema: health takes no body, session takes a SessionRequest', () => {
    expect(egressGate({ path: '/v1/health' }, new Map(), policy).ok).toBe(true);
    expect(egressGate({ path: '/v1/session', body: { task: 'Fill the form', policy_profile: 'STRICT', site_allowlist: [] } }, new Map(), policy).ok).toBe(true);
    expect(egressGate({ path: '/v1/session', body: { task: '' } }, new Map(), policy).ok).toBe(false);
  });

  it.each([
    ['email', 'rahul@zmail.in', 'EMAIL'],
    ['aadhaar', '2345 6789 0124', 'AADHAAR'],
    ['card', '4539 5787 6362 1486', 'CREDIT_CARD'],
    ['pan', 'ABCPE1234F', 'PAN'],
  ])('2 sweep: an unredacted %s in a label is a violation', (_n, value, type) => {
    const obs = observation();
    obs.elements[0]!.label_raw = `Your ${value}`;
    const r = gate(step(obs));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('TYPE_BRAND');
      expect(JSON.stringify(r.error)).not.toContain(value.replace(/\s/g, ''));
      expect(r.error.message).toContain(type === 'CREDIT_CARD' ? 'CARD' : type);
    }
  });

  it('2 sweep: a malformed handle is rejected', () => {
    const obs = observation({ handles: [{ handle: 'EMAIL#1', type: 'EMAIL', tier: 2, occurrences: 1, first_seen_step: 1 }] });
    const r = gate(step(obs));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TYPE_BRAND');
  });

  it('2 sweep: plain labels, product names and page titles pass', () => {
    const obs = observation();
    obs.text_nodes.push({ id: 't2', rect: [0, 100, 200, 20], text: 'Aeron Chair - in stock', owner_element_id: null, source: 'dom' });
    expect(gate(step(obs)).ok).toBe(true);
  });

  describe('3 registry scan', () => {
    const secrets = createSessionSecrets('sess');
    const secret = 'anita.sharma42@zmail.in';
    secrets.record(secret, 'EMAIL', 2);
    const withText = (text: string) => {
      const obs = observation();
      obs.text_nodes.push({ id: 't9', rect: [0, 0, 10, 10], text, owner_element_id: null, source: 'dom' });
      return step(obs);
    };
    // The sweep would catch the raw email first, so exercise the registry with forms no recognizer matches.
    it.each([
      ['url-encoded', encodeURIComponent(secret)],
      ['base64', Buffer.from(secret).toString('base64')],
      ['hex', Buffer.from(secret).toString('hex')],
      ['html entities', [...secret].map(c => `&#${c.charCodeAt(0)};`).join('')],
      ['8-gram fragment', `id ${secret.slice(2, 14)} ok`],
    ])('catches a registered secret in %s form', (_n, form) => {
      const r = gate(withText(form), secrets.registry);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('REGISTRY_SCAN');
        expect(JSON.stringify(r.error)).not.toContain('anita');
      }
    });
  });

  it('4 entropy: a long random token in a text node is rejected, a sentence is not', () => {
    // Prefixed 'demo' so the SECRET recognizer skips it and the entropy check is what fires.
    const token = 'demoX9f2LqP0mZb7Vt3KwR8sYd1NcH5jA4eG6uT2QiB0';
    const obs = observation();
    obs.text_nodes.push({ id: 't3', rect: [0, 0, 10, 10], text: token, owner_element_id: null, source: 'dom' });
    const r = gate(step(obs));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ENTROPY_HEURISTIC');
    const ok = observation();
    ok.text_nodes.push({ id: 't3', rect: [0, 0, 10, 10], text: 'Delivery within five working days across India', owner_element_id: null, source: 'dom' });
    expect(gate(step(ok)).ok).toBe(true);
  });

  it('5 size: rejects payloads over the policy budget', () => {
    const r = gate(step(), new Map(), { ...policy, max_payload_bytes: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SIZE_BUDGET');
  });

  it('6 rate: refuses a runaway loop', () => {
    let last = gate(step());
    for (let i = 0; i < 95 && last.ok; i++) last = gate(step());
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error.code).toBe('RATE_LIMIT');
  });

  it('7 destination: only the configured gateway origin is released to', () => {
    const r = gate(step(), new Map(), policy, 'https://evil.example');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DESTINATION_PIN');
    const none = gate(step(), new Map(), { ...policy, gateway_origin: undefined });
    expect(none.ok).toBe(false);
  });

  it('performance: steady-state p50 < 30ms, p95 < 60ms for 400 elements against a 200-entry registry', () => {
    const secrets = createSessionSecrets('perf');
    for (let i = 0; i < 200; i++) secrets.record(`person${i}.name${i}@example.com`, 'EMAIL', 2);
    const obs = observation({
      elements: Array.from({ length: 400 }, (_, i) => ({ id: `e${i}`, id_hash: `h${i}`, tag: 'button', role: 'button', label_raw: `Button ${i}`, rect: [0, i, 10, 10] as [number, number, number, number], visible: true, enabled: true, focusable: true, value_state: 'n/a' as const, group: '', frame: 0 })),
    });
    // First call builds the registry index (~40ms once per session); time the steady state.
    expect(gate(step(obs), secrets.registry).ok).toBe(true);
    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      resetRateLimitForTests();
      const t = performance.now();
      expect(gate(step(obs), secrets.registry).ok).toBe(true);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    // ~9ms in isolation on an M1; the bound leaves room for a loaded test runner.
    expect(times[Math.floor(times.length * 0.5)]!).toBeLessThan(30);
    expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(60);
  });
});
