import { describe, it, expect, beforeEach, vi } from 'vitest';
import { egressGate } from './egress-gate';
import type { SecretRegistry } from '@glasswall/schema/branded';
import { normalize } from './registry/normalize';
import { PolicyConfig } from '@glasswall/schema/policy';
import { SanitizedObservation, Handle } from '@glasswall/schema/observation';
import { createTokenizer } from './tokenizer';

function createTestPolicy(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    name: 'STRICT',
    unexplained_prior: 0.8,
    screenshot: { enabled: false },
    thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
    tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'TOKENIZE', T4: 'ANNOTATE', T5: 'TOKENIZE' },
    url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
    text_block_max_chars: 400,
    fail_mode: 'CLOSED',
    high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
    require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
    max_elements: 400,
    max_payload_bytes: 250 * 1024,
    gateway_origin: 'https://gateway.glasswall.local',
    ...overrides,
  };
}

function createValidObservation(handles: Handle[] = [], overrides: Partial<SanitizedObservation> = {}): SanitizedObservation {
  return {
    observation_id: 'obs_test',
    session_id: 'session_test',
    step: 1,
    page: {
      origin_class: 'benchmark',
      url_template: '/test',
      title_raw: '⟦BRAND⟧',
      type_hint: 'form',
      modal_active: false,
      stability: 'stable',
    },
    viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
    elements: [
      {
        id: 'e1',
        id_hash: 'abc123',
        tag: 'input',
        role: 'textbox',
        type: 'email',
        label_raw: '⟦EMAIL#1⟧',
        placeholder_raw: '⟦EMAIL#1⟧',
        rect: [0, 0, 100, 30],
        visible: true,
        enabled: true,
        focusable: true,
        value_state: 'empty',
        options_count: undefined,
        group: 'form',
        frame: 0,
        sensitivity_class: 'EMAIL',
        available_actions: ['TYPE'],
      },
    ],
    text_nodes: [],
    frames: [],
    truncated: false,
    list_virtualized: false,
    handles,
    budget: { steps_left: 19, ms_left: 5 * 60 * 1000 },
    ...overrides,
  };
}

/** Builds the C6 contract registry: a Map of handle -> secret metadata. */
function createRegistryWithSecrets(secrets: Array<{ value: string; type: string; tier: number }>): SecretRegistry {
  const registry: SecretRegistry = new Map();
  secrets.forEach((secret, i) => {
    const handle = `\u27E6${secret.type}#${i}\u27E7`;
    registry.set(handle, {
      handle,
      pii_type: secret.type,
      tier: secret.tier,
      created_at: Date.now(),
      normalized_value: normalize(secret.value),
    });
  });
  return registry;
}

describe('egressGate - check 1: Schema Conformance', () => {
  const policy = createTestPolicy();
  const registry = createRegistryWithSecrets([]);

  it('accepts valid SanitizedObservation', () => {
    const obs = createValidObservation();
    const result = egressGate(obs, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('rejects unknown key at root level', () => {
    const obs = createValidObservation();
    const payload = { ...obs, unknown_field: 'value' } as any;
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('SCHEMA_CONFORMANCE');
  });

  it('rejects unknown key in page object', () => {
    const obs = createValidObservation();
    const payload = { ...obs, page: { ...obs.page, unknown_page_field: 'x' } as any };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('SCHEMA_CONFORMANCE');
  });

  it('rejects unknown key in element', () => {
    const obs = createValidObservation();
    const payload = {
      ...obs,
      elements: [{ ...obs.elements[0], unknown_element_field: 'x' } as any],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('SCHEMA_CONFORMANCE');
  });

  it('rejects missing required field', () => {
    const obs = createValidObservation();
    const { observation_id, ...payload } = obs;
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('SCHEMA_CONFORMANCE');
  });
});

describe('egressGate - check 2: Type Brand', () => {
  const policy = createTestPolicy();
  const registry = createRegistryWithSecrets([]);

  it('accepts handles as valid Sanitized strings', () => {
    const obs = createValidObservation([
      { handle: '⟦EMAIL#1⟧', type: 'EMAIL', tier: 2, occurrences: 1, first_seen_step: 1 },
    ]);
    const result = egressGate(obs, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('accepts Tier-1 handle without index', () => {
    const obs = createValidObservation([
      { handle: '⟦PASSWORD⟧', type: 'PASSWORD', tier: 1, occurrences: 1, first_seen_step: 1 },
    ]);
    const result = egressGate(obs, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('accepts redacted placeholder strings', () => {
    const obs = createValidObservation();
    const payload = {
      ...obs,
      elements: [{ ...obs.elements[0], label_raw: '[REDACTED]', placeholder_raw: '[REDACTED]' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('rejects raw string that never went through tokenizer', () => {
    const obs = createValidObservation();
    const payload = {
      ...obs,
      elements: [{ ...obs.elements[0], label_raw: 'raw@example.com' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TYPE_BRAND');
    expect(result.error.message).toContain('Unbranded string');
  });

  it('rejects raw string EVEN WHEN CAST as Sanitized', () => {
    const obs = createValidObservation();
    const rawString = 'raw@example.com' as any;
    const payload = {
      ...obs,
      elements: [{ ...obs.elements[0], label_raw: rawString }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TYPE_BRAND');
  });

  it('rejects raw phone number in text node', () => {
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 100, 20], text: '555-123-4567', owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TYPE_BRAND');
  });

  it('accepts text node with embedded handle', () => {
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 100, 20], text: 'Contact: ⟦EMAIL#1⟧', owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });
});

describe('egressGate - check 3: Registry Scan', () => {
  const policy = createTestPolicy();

  it('rejects exact normalized secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: 'Email: rahul@example.com and handle ⟦EMAIL#1⟧', owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects URL-encoded secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: 'Email: rahul%40example.com and handle ⟦EMAIL#1⟧', owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects double URL-encoded secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: 'Email: rahul%2540example.com and handle ⟦EMAIL#1⟧', owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects base64-encoded secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const b64 = btoa('rahul@example.com');
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Data: ${b64} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects base64url-encoded secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const b64 = btoa('rahul@example.com').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Data: ${b64} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects hex-encoded secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const hex = '726168756c406578616d706c652e636f6d';
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Hex: ${hex} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects HTML entity encoded secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const html = '&#114;&#97;&#104;&#117;&#108;&#64;&#101;&#120;&#97;&#109;&#112;&#108;&#101;&#46;&#99;&#111;&#109;';
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `HTML: ${html} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects JSON-escaped secret in text node with handle', () => {
    const registry = createRegistryWithSecrets([{ value: 'rahul@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const jsonEscaped = '\\u0072\\u0061\\u0068\\u0075\\u006c\\u0040\\u0065\\u0078\\u0061\\u006d\\u0070\\u006c\\u0065\\u002e\\u0063\\u006f\\u006d';
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `JSON: ${jsonEscaped} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('rejects 8-gram partial overlap for long secret in text node', () => {
    const longSecret = 'a'.repeat(50) + 'secretvalue' + 'b'.repeat(50);
    const registry = createRegistryWithSecrets([{ value: longSecret, type: 'API_KEY', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Partial: ${longSecret.slice(10, 40)} and handle ⟦API_KEY#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
    expect(result.error.message).toContain('8-gram');
  });

  it('ignores short secrets below minimum length for false-positive guard', () => {
    const registry = createRegistryWithSecrets([{ value: 'abc', type: 'API_KEY', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Short: abc and handle ⟦API_KEY#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });
});

describe('egressGate - check 4: Entropy Heuristic', () => {
  const policy = createTestPolicy();
  const registry = createRegistryWithSecrets([]);

it('rejects high-entropy token in pure handle field (caught by type-brand)', () => {
    const highEntropy = 'xK9mP2qR8vL4nM7w'; // ~4.2 bits/char
    const obs = createValidObservation();
    const payload = {
      ...obs,
      elements: [{ ...obs.elements[0], label_raw: highEntropy }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TYPE_BRAND');
  });

  it('accepts handle-like strings even with high entropy', () => {
    const obs = createValidObservation([
      { handle: '⟦API_KEY#1⟧', type: 'API_KEY', tier: 2, occurrences: 1, first_seen_step: 1 },
    ]);
    const payload = { ...obs, elements: [{ ...obs.elements[0], label_raw: '⟦API_KEY#1⟧' }] };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('accepts redacted placeholders', () => {
    const obs = createValidObservation();
    const payload = { ...obs, elements: [{ ...obs.elements[0], label_raw: '[REDACTED]' }] };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('accepts low-entropy strings in text node with handle', () => {
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: 'hello world hello world and handle ⟦EMAIL#1⟧', owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('ignores strings shorter than 12 chars', () => {
    const highEntropy = 'xK9mP2qR8v'; // 10 chars
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Token: ${highEntropy} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });
});

describe('egressGate - check 5: Size Budget', () => {
  const policy = createTestPolicy({ max_payload_bytes: 1000 });
  const registry = createRegistryWithSecrets([]);

  it('accepts payload under limit', () => {
    const obs = createValidObservation();
    const result = egressGate(obs, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('rejects payload over limit via large text node', () => {
    const largeText = 'x'.repeat(2000);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `${largeText} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('SIZE_BUDGET');
  });
});

describe('egressGate - check 6: Rate Limit', () => {
  const policy = createTestPolicy();
  const registry = createRegistryWithSecrets([]);

  it('currently passes (not implemented)', () => {
    const obs = createValidObservation();
    const result = egressGate(obs, registry, policy);
    expect(result.ok).toBe(true);
  });
});

describe('egressGate - check 7: Destination Pin', () => {
  const registry = createRegistryWithSecrets([]);

  it('accepts when gateway origin matches (via page.url_template)', () => {
    const policy = createTestPolicy({ gateway_origin: 'https://gateway.glasswall.local' });
    const obs = createValidObservation();
    // Use page.url_template as the destination indicator
    const payload = { ...obs, page: { ...obs.page, url_template: 'https://gateway.glasswall.local/v1/step' } };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(true);
  });

  it('rejects when gateway origin does not match', () => {
    const policy = createTestPolicy({ gateway_origin: 'https://gateway.glasswall.local' });
    const obs = createValidObservation();
    const payload = { ...obs, page: { ...obs.page, url_template: 'https://evil.com/steal' } };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('DESTINATION_PIN');
  });

  it('rejects when gateway origin not configured', () => {
    const policy = createTestPolicy({ gateway_origin: undefined as any });
    const obs = createValidObservation();
    const result = egressGate(obs, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('DESTINATION_PIN');
  });

  it('rejects invalid destination URL', () => {
    const policy = createTestPolicy({ gateway_origin: 'https://gateway.glasswall.local' });
    const obs = createValidObservation();
    const payload = { ...obs, page: { ...obs.page, url_template: 'http://not-a-url' } };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('DESTINATION_PIN');
  });
});

describe('egressGate - performance', () => {
  it('p95 under 15ms for 400-element payload against 200-entry registry', () => {
    const policy = createTestPolicy();
    const registry = createRegistryWithSecrets(
      Array.from({ length: 200 }, (_, i) => ({
        value: `secret-value-${i}-${'x'.repeat(20)}`,
        type: 'API_KEY',
        tier: 2,
      }))
    );

    const elements = Array.from({ length: 400 }, (_, i) => ({
      id: `e${i}`,
      id_hash: `hash${i}`,
      tag: 'input',
      role: 'textbox',
      type: 'text',
      label_raw: `⟦LABEL#${i}⟧`,
      placeholder_raw: `⟦PLACEHOLDER#${i}⟧`,
      rect: [i % 100 * 10, Math.floor(i / 100) * 40, 100, 30],
      visible: true,
      enabled: true,
      focusable: true,
      value_state: 'empty' as const,
      group: 'form',
      frame: 0,
      sensitivity_class: 'NONE',
      available_actions: ['TYPE'],
    }));

    const obs: SanitizedObservation = {
      observation_id: 'obs_perf',
      session_id: 'session_perf',
      step: 1,
      page: { origin_class: 'benchmark', url_template: '/perf', title_raw: 'Perf Test', type_hint: 'form', modal_active: false, stability: 'stable' },
      viewport: { w: 1920, h: 1080, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
      elements,
      text_nodes: [],
      frames: [],
      truncated: false,
      list_virtualized: false,
      handles: [],
      budget: { steps_left: 19, ms_left: 5 * 60 * 1000 },
    };

    // Warm up: the first call builds the registry automaton, which is cached for
    // the life of the registry. Steady state is what the 15ms budget describes.
    egressGate(obs, registry, policy);

    const iterations = 100;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      egressGate(obs, registry, policy);
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(iterations * 0.95)];
    expect(p95).toBeLessThan(15);
  });
});

import { generateEncodings } from './registry/encodings';

describe('egressGate - property test: accepted payload contains no registry entry in any encoding', () => {
  it('property: for any accepted payload, no registry entry appears in serialized form in any encoding', () => {
    const policy = createTestPolicy();
    const secrets = [
      { value: 'rahul@example.com', type: 'EMAIL', tier: 2 },
      { value: '555-123-4567', type: 'PHONE', tier: 2 },
      { value: '123456789012', type: 'AADHAAR', tier: 1 },
      { value: 'ABCDE1234F', type: 'PAN', tier: 2 },
      { value: 'sk_test_abcdefghijklmnopqrstuvwxyz', type: 'API_KEY', tier: 2 },
    ];

    for (const secret of secrets) {
      const registry = createRegistryWithSecrets([secret]);
      const tokenizer = createTokenizer('test-salt-' + secret.value);
      const handle = tokenizer.tokenize(secret.value, secret.type, secret.tier);

      const obs = createValidObservation([
        { handle, type: secret.type, tier: secret.tier, occurrences: 1, first_seen_step: 1 },
      ]);
      obs.elements[0].label_raw = handle;

      const result = egressGate(obs, registry, policy);
      expect(result.ok).toBe(true);

      const serialized = JSON.stringify(obs);
      const normalized = serialized.toLowerCase().replace(/\s+/g, ' ').trim();

      const encodings = generateEncodings(secret.value.toLowerCase().replace(/\s+/g, ' ').trim());

      for (const encoding of encodings) {
        expect(normalized).not.toContain(encoding);
      }
    }
  });
});

describe('egressGate - encoding-specific tests', () => {
  const policy = createTestPolicy();

  it('encoding: URL encoding blocked', () => {
    const registry = createRegistryWithSecrets([{ value: 'test@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: 'Email: test%40example.com and handle ⟦EMAIL#1⟧', owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('encoding: base64 blocked', () => {
    const registry = createRegistryWithSecrets([{ value: 'test@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Data: ${btoa('test@example.com')} and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('encoding: hex blocked', () => {
    const registry = createRegistryWithSecrets([{ value: 'test@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `Hex: 74657374406578616d706c652e636f6d and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });

  it('encoding: HTML entities blocked', () => {
    const registry = createRegistryWithSecrets([{ value: 'test@example.com', type: 'EMAIL', tier: 2 }]);
    const obs = createValidObservation();
    const payload = {
      ...obs,
      text_nodes: [{ id: 't1', rect: [0, 0, 200, 20], text: `HTML: &#116;&#101;&#115;&#116;&#64;&#101;&#120;&#97;&#109;&#112;&#108;&#101;&#46;&#99;&#111;&#109; and handle ⟦EMAIL#1⟧`, owner_element_id: 'e1', source: 'dom' }],
    };
    const result = egressGate(payload, registry, policy);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REGISTRY_SCAN');
  });
});