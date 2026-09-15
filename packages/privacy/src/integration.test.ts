// The seam the orchestrator relies on: sanitize → egressGate → (net) and, on the way
// back, vault binding. Uses a realistic ShopLite-like observation, not a fixture built
// to pass.
import { describe, it, expect } from 'vitest';
import { sanitize } from './sanitize';
import { egressGate, resetRateLimitForTests } from './egress-gate';
import { PROFILES } from './policy';
import { createSessionSecrets } from './session-secrets';
import { resolveForBinding } from './resolve';
import { checkVaultTypeMatch, scanLiteralAgainstRegistry } from './validator-hooks';

import { checkoutPage, EMAIL, PHONE, AADHAAR } from './test-fixtures';

describe('sanitize → egressGate → vault, as the orchestrator uses them', () => {
  it('tokenizes every value, keeps labels, passes the gate, resolves from the vault, and blocks exfiltration', async () => {
    resetRateLimitForTests();
    const secrets = createSessionSecrets('s1');
    const policy = PROFILES.STRICT.policy;

    const result = await sanitize({ raw: checkoutPage(0), frame: null, task: 'Fill the form', step: 0, session: { session_id: 's1', policy_profile: 'STRICT', secrets } });
    const obs = result.observation as { elements: { id: string; label_raw: string; sensitivity_class?: string; available_actions?: string[] }[]; text_nodes: { text: string }[]; handles?: { handle: string; type: string }[] };
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
    const handlesOf = (r: typeof a) => (r.observation as { handles?: { handle: string; type: string }[] }).handles!.map(h => `${h.type}:${h.handle}`).sort();
    expect(handlesOf(b)).toEqual(handlesOf(a));
    expect(secrets.handleCount()).toBe(handlesOf(a).length);
  });

  it('substitutes a known value that reappears in prose on a later page', async () => {
    const secrets = createSessionSecrets('s4');
    await sanitize({ raw: checkoutPage(0), frame: null, task: 't', step: 0, session: { session_id: 's4', policy_profile: 'STRICT', secrets } });
    const later = { ...checkoutPage(1), text_nodes: [{ id: 't1', rect: [0, 0, 300, 20] as [number, number, number, number], text: `Ship to ${EMAIL} today?`, owner_element_id: null, source: 'dom' as const }, { id: 't2', rect: [0, 30, 300, 20] as [number, number, number, number], text: `Contact: ${PHONE.toUpperCase()}`, owner_element_id: null, source: 'dom' as const }] };
    const r = await sanitize({ raw: later, frame: null, task: 't', step: 1, session: { session_id: 's4', policy_profile: 'STRICT', secrets } });
    const text = (r.observation as { text_nodes: { text: string }[] }).text_nodes.map(t => t.text).join(' ');
    expect(text).not.toContain(EMAIL);
    expect(text).toMatch(/Ship to ⟦EMAIL#\d+⟧ today\?/);
    expect(text).toMatch(/Contact: ⟦PHONE#\d+⟧/);
  });

  it('substitutes known values in page metadata before the gate scans it', async () => {
    const secrets = createSessionSecrets('s5');
    secrets.record('ShopLite', 'PERSONAL', 3);
    const raw = { ...checkoutPage(0), page: { ...checkoutPage(0).page, url_template: '/shoplite/cart', title_raw: 'ShopLite Cart' } };
    const result = await sanitize({ raw, frame: null, task: 't', step: 0, session: { session_id: 's5', policy_profile: 'STRICT', secrets } });
    const obs = result.observation as { page: { url_template: string; title_raw: string } };

    expect(obs.page.url_template).toBe('/⟦PERSONAL#1⟧/cart');
    expect(obs.page.title_raw).toBe('⟦PERSONAL#1⟧ Cart');
    expect(egressGate({ path: '/v1/step', body: { session_id: 's5', observation: obs, history: [] } }, secrets.registry, PROFILES.STRICT.policy).ok).toBe(true);
  });

  it('does not scan a safe handle against a secret containing its type name', async () => {
    const secrets = createSessionSecrets('s6');
    const handle = secrets.record('personal', 'PERSONAL', 3);
    const sanitized = await sanitize({ raw: checkoutPage(0), frame: null, task: 't', step: 0, session: { session_id: 's6', policy_profile: 'STRICT', secrets } });
    const observation = { ...sanitized.observation, page: { ...sanitized.observation.page, url_template: handle } };
    const gate = egressGate({ path: '/v1/step', body: { session_id: 's6', observation, history: [] } }, secrets.registry, PROFILES.STRICT.policy);
    expect(gate.ok).toBe(true);
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
