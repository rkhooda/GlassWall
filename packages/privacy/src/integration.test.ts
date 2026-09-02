// The seam the orchestrator relies on: sanitize → egressGate → (net) and, on the way
// back, vault binding. Uses a realistic ShopLite-like observation, not a fixture built
// to pass.
import { describe, it, expect } from 'vitest';
import type { RawObservation } from '@glasswall/schema/observation';
import { sanitize } from './sanitize';
import { egressGate, resetRateLimitForTests } from './egress-gate';
import { PROFILES } from './policy';
import { createSessionSecrets } from './session-secrets';
import { resolveForBinding } from './resolve';
import { checkVaultTypeMatch, scanLiteralAgainstRegistry } from './validator-hooks';

const EMAIL = 'anita.sharma42@zmail.in';
const PHONE = '+91 99194 14773';
const AADHAAR = '2345 6789 0124';

function checkoutPage(step = 0): RawObservation {
  return {
    observation_id: `obs_${step}`,
    session_id: 's1',
    step,
    page: { origin_class: 'benchmark', url_template: '/shoplite/checkout', title_raw: 'ShopLite Checkout', type_hint: 'checkout', modal_active: false, stability: 'stable' },
    viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1.4, dpr: 2 },
    elements: [
      { id: 'e1', id_hash: 'h1', tag: 'input', role: 'textbox', type: 'email', label_raw: 'Email', placeholder_raw: 'you@example.com', rect: [20, 100, 300, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'form', frame: 0, autocomplete: 'email', input_type: 'email' },
      { id: 'e2', id_hash: 'h2', tag: 'input', role: 'textbox', type: 'tel', label_raw: 'Phone', placeholder_raw: '+91 98765 43210', rect: [20, 140, 300, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'form', frame: 0, autocomplete: 'tel', input_type: 'tel' },
      { id: 'e3', id_hash: 'h3', tag: 'input', role: 'searchbox', type: 'search', label_raw: 'Search products', placeholder_raw: 'Search products', rect: [400, 10, 260, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'header', frame: 0, input_type: 'search' },
      { id: 'e4', id_hash: 'h4', tag: 'button', role: 'button', label_raw: 'Place order', rect: [20, 200, 120, 36], visible: true, enabled: true, focusable: true, value_state: 'n/a', group: 'form', frame: 0 },
      { id: 'e5', id_hash: 'h5', tag: 'input', role: 'textbox', type: 'password', label_raw: 'CVC', placeholder_raw: 'CVC', rect: [20, 260, 80, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'form', frame: 0, autocomplete: 'cc-csc', input_type: 'password' },
      { id: 'e6', id_hash: 'h6', tag: 'canvas', role: 'img', label_raw: '', rect: [700, 100, 300, 200], visible: true, enabled: false, focusable: false, value_state: 'n/a', group: 'main', frame: 0, unexplained: true },
    ],
    text_nodes: [
      { id: 't1', rect: [20, 40, 400, 20], text: 'Your saved details', owner_element_id: null, source: 'dom' },
      { id: 't2', rect: [20, 60, 400, 20], text: `Email ${EMAIL}`, owner_element_id: null, source: 'dom' },
      { id: 't3', rect: [20, 80, 400, 20], text: `Phone ${PHONE}`, owner_element_id: null, source: 'dom' },
      { id: 't4', rect: [20, 300, 400, 20], text: `KYC Aadhaar ${AADHAAR}`, owner_element_id: null, source: 'dom' },
      { id: 't5', rect: [400, 300, 400, 20], text: 'Aeron Chair - in stock', owner_element_id: null, source: 'dom' },
    ],
    frames: [{ id: 0, origin: 'same', rect: [0, 0, 1280, 720] }],
    truncated: false,
    list_virtualized: false,
  };
}

describe('sanitize → egressGate → vault, as the orchestrator uses them', () => {
  it('tokenizes every value, keeps labels, passes the gate, resolves from the vault, and blocks exfiltration', async () => {
    resetRateLimitForTests();
    const secrets = createSessionSecrets('s1');
    const policy = PROFILES.STRICT.policy;

    const result = await sanitize({ raw: checkoutPage(0), frame: null, task: 'Fill the form', step: 0, session: { session_id: 's1', policy_profile: 'STRICT', secrets } });
    const obs = result.observation as { elements: Array<{ id: string; label_raw: string; sensitivity_class?: string; available_actions?: string[] }>; text_nodes: Array<{ text: string }>; handles?: Array<{ handle: string; type: string }> };
    const text = obs.text_nodes.map(t => t.text).join('\n');

    // Values are gone, replaced by typed handles; public text survives.
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(AADHAAR.replace(/\s/g, ''));
    expect(text).toMatch(/⟦EMAIL#\d+⟧/);
    expect(text).toMatch(/⟦PHONE#\d+⟧/);
    expect(text).toMatch(/⟦AADHAAR#\d+⟧/);
    expect(text).toContain('Aeron Chair');

    // Labels are not values: the planner can still see which field is which.
    const email = obs.elements.find(e => e.id === 'e1')!;
    expect(email.label_raw).toBe('Email');
    expect(email.sensitivity_class).toBe('EMAIL');
    expect(email.available_actions).toContain('TYPE');
    expect(obs.elements.find(e => e.id === 'e5')!.sensitivity_class).toBe('CVC');
    expect(obs.elements.find(e => e.id === 'e3')!.sensitivity_class).toBeUndefined();

    // Unexplained canvas is masked.
    expect(result.redactions.some(r => Math.abs(r.rect[0] - 700) <= 8 && /canvas/.test(r.reason))).toBe(true);

    // The gate accepts exactly this payload.
    const gate = egressGate({ path: '/v1/step', body: { session_id: 's1', observation: obs, history: [] } }, secrets.registry, policy);
    expect(gate.ok).toBe(true);
    expect(JSON.stringify(gate.ok ? gate.value.body : null)).not.toContain('anita');

    // The vault resolves the handle into a matching field only.
    await secrets.flush();
    const emailHandle = obs.handles!.find(h => h.type === 'EMAIL')!.handle;
    const aadhaarHandle = obs.handles!.find(h => h.type === 'AADHAAR')!.handle;
    const bound = await resolveForBinding(emailHandle, { element_id: 'e1', sensitivity_class: 'EMAIL', accepts: ['EMAIL'] }, secrets.vault);
    expect(bound.ok && bound.value.value).toBe(EMAIL);
    const exfil = await resolveForBinding(aadhaarHandle, { element_id: 'e3', sensitivity_class: undefined, accepts: [] }, secrets.vault);
    expect(exfil.ok).toBe(false);
    if (!exfil.ok) {
      expect(exfil.error.code).toBe('VAULT_TYPE_MISMATCH');
      expect(JSON.stringify(exfil.error)).not.toContain('2345');
    }
    // Rung 7 catches it before execution, from the sanitized observation alone.
    const rung7 = checkVaultTypeMatch({ type: 'TYPE', target: { id: 'e3', id_hash: 'h3' }, value: { kind: 'vault_ref', handle: aadhaarHandle } }, obs as never);
    expect(rung7.ok).toBe(false);
    // Rung 8: a literal carrying the secret is refused too.
    expect(scanLiteralAgainstRegistry(`search ${AADHAAR}`, secrets.registry).ok).toBe(false);
    expect(scanLiteralAgainstRegistry('wireless earbuds', secrets.registry).ok).toBe(true);
  });

  it('keeps handles stable across steps with shared session secrets', async () => {
    const secrets = createSessionSecrets('s2');
    const a = await sanitize({ raw: checkoutPage(0), frame: null, task: 't', step: 0, session: { session_id: 's2', policy_profile: 'BALANCED', secrets } });
    const b = await sanitize({ raw: checkoutPage(1), frame: null, task: 't', step: 1, session: { session_id: 's2', policy_profile: 'BALANCED', secrets } });
    const handlesOf = (r: typeof a) => (r.observation as { handles?: Array<{ handle: string; type: string }> }).handles!.map(h => `${h.type}:${h.handle}`).sort();
    expect(handlesOf(b)).toEqual(handlesOf(a));
    expect(secrets.handleCount()).toBe(handlesOf(a).length);
  });

  it('substitutes a known value that reappears in prose on a later page', async () => {
    const secrets = createSessionSecrets('s4');
    await sanitize({ raw: checkoutPage(0), frame: null, task: 't', step: 0, session: { session_id: 's4', policy_profile: 'STRICT', secrets } });
    const later = { ...checkoutPage(1), text_nodes: [{ id: 't1', rect: [0, 0, 300, 20] as [number, number, number, number], text: `Ship to ${EMAIL} today?`, owner_element_id: null, source: 'dom' as const }, { id: 't2', rect: [0, 30, 300, 20] as [number, number, number, number], text: `Contact: ${PHONE.toUpperCase()}`, owner_element_id: null, source: 'dom' as const }] };
    const r = await sanitize({ raw: later, frame: null, task: 't', step: 1, session: { session_id: 's4', policy_profile: 'STRICT', secrets } });
    const text = (r.observation as { text_nodes: Array<{ text: string }> }).text_nodes.map(t => t.text).join(' ');
    expect(text).not.toContain(EMAIL);
    expect(text).toMatch(/Ship to ⟦EMAIL#\d+⟧ today\?/);
    expect(text).toMatch(/Contact: ⟦PHONE#\d+⟧/);
  });

  it('rejects a raw secret the sanitizer somehow missed', () => {
    resetRateLimitForTests();
    const secrets = createSessionSecrets('s3');
    const obs = { ...checkoutPage(0), elements: [], text_nodes: [{ id: 't1', rect: [0, 0, 10, 10] as [number, number, number, number], text: `Card 4539 5787 6362 1486`, owner_element_id: null, source: 'dom' as const }], handles: [] };
    const gate = egressGate({ path: '/v1/step', body: { session_id: 's3', observation: obs, history: [] } }, secrets.registry, PROFILES.STRICT.policy);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.error.code).toBe('TYPE_BRAND');
  });
});
