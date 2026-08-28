import { describe, it, expect } from 'vitest';
import {
  RawObservationSchema,
  RawElementSchema,
  ActionSchema,
  ActionEnvelopeSchema,
  PolicyConfigSchema,
  STRICT_POLICY,
} from './index';

describe('Schema validation', () => {
  it('validates a minimal RawObservation', () => {
    const obs = {
      observation_id: 'obs-1',
      session_id: 'sess-1',
      step: 1,
      page: {
        origin_class: 'benchmark' as const,
        url_template: '/login',
        title_raw: 'Login',
        type_hint: 'auth' as const,
        modal_active: false,
        stability: 'stable' as const,
      },
      viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
      elements: [],
      text_nodes: [],
      frames: [],
      truncated: false,
      list_virtualized: false,
    };
    const result = RawObservationSchema.safeParse(obs);
    expect(result.success).toBe(true);
  });

  it('rejects RawObservation with unknown keys (additionalProperties: false)', () => {
    const obs = {
      observation_id: 'obs-1',
      session_id: 'sess-1',
      step: 1,
      page: {
        origin_class: 'benchmark',
        url_template: '/login',
        title_raw: 'Login',
        type_hint: 'auth',
        modal_active: false,
        stability: 'stable',
      },
      viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
      elements: [],
      text_nodes: [],
      frames: [],
      truncated: false,
      list_virtualized: false,
      extra_field: 'not allowed',
    };
    const result = RawObservationSchema.safeParse(obs);
    expect(result.success).toBe(false);
  });

  it('validates RawElement with required fields', () => {
    const el = {
      id: 'e1',
      id_hash: 'abc123',
      tag: 'input',
      role: 'textbox',
      type: 'email',
      label_raw: 'Email',
      placeholder_raw: 'Enter email',
      rect: [100, 100, 200, 30],
      visible: true,
      enabled: true,
      focusable: true,
      value_state: 'empty' as const,
      options_count: 0,
      group: 'form#login',
      frame: 0,
      autocomplete: 'email',
      input_type: 'email',
    };
    const result = RawElementSchema.safeParse(el);
    expect(result.success).toBe(true);
  });

  it('validates all Action types', () => {
    const actions = [
      { type: 'CLICK', target_id: 'e1', target_id_hash: 'abc123' },
      {
        type: 'TYPE',
        target_id: 'e1',
        target_id_hash: 'abc123',
        value: '@vault:EMAIL#1',
        clear_first: true,
      },
      { type: 'SCROLL', direction: 'down' as const, amount: 300 },
      { type: 'SELECT', target_id: 'e1', target_id_hash: 'abc123', option_index: 0 },
      { type: 'PRESS_KEY', key: 'Enter' },
      { type: 'NAVIGATE', url_template: '/dashboard' },
      { type: 'WAIT', condition: 'stable' as const, timeout_ms: 5000 },
      { type: 'BACK' },
      { type: 'DONE', summary: 'Task completed' },
    ];

    for (const action of actions) {
      const result = ActionSchema.safeParse(action);
      expect(result.success, `Failed for ${action.type}`).toBe(true);
    }
  });

  it('validates ActionEnvelope', () => {
    const envelope = {
      action: { type: 'CLICK', target_id: 'e1', target_id_hash: 'abc123' },
      observation_id: 'obs-1',
      step_index: 1,
      session_id: 'sess-1',
      risk: 'low' as const,
      requires_confirmation: false,
    };
    const result = ActionEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('validates STRICT_POLICY', () => {
    const result = PolicyConfigSchema.safeParse(STRICT_POLICY);
    expect(result.success).toBe(true);
  });
});
