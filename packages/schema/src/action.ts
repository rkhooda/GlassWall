import { z } from 'zod';

export const ActionTypeSchema = z.enum([
  'CLICK',
  'TYPE',
  'SCROLL',
  'SELECT',
  'PRESS_KEY',
  'NAVIGATE',
  'WAIT',
  'BACK',
  'DONE',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CLICK'),
    target_id: z.string(),
    target_id_hash: z.string(),
  }),
  z.object({
    type: z.literal('TYPE'),
    target_id: z.string(),
    target_id_hash: z.string(),
    value: z.string(),
    clear_first: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('SCROLL'),
    direction: z.enum(['down', 'up', 'left', 'right']),
    amount: z.number().optional(),
    target_id: z.string().optional(),
    target_id_hash: z.string().optional(),
  }),
  z.object({
    type: z.literal('SELECT'),
    target_id: z.string(),
    target_id_hash: z.string(),
    option_index: z.number(),
  }),
  z.object({
    type: z.literal('PRESS_KEY'),
    key: z.string(),
    target_id: z.string().optional(),
    target_id_hash: z.string().optional(),
  }),
  z.object({
    type: z.literal('NAVIGATE'),
    url_template: z.string(),
  }),
  z.object({
    type: z.literal('WAIT'),
    condition: z.enum(['stable', 'element', 'navigation']),
    target_id: z.string().optional(),
    target_id_hash: z.string().optional(),
    timeout_ms: z.number().default(5000),
  }),
  z.object({
    type: z.literal('BACK'),
  }),
  z.object({
    type: z.literal('DONE'),
    summary: z.string(),
  }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const ActionEnvelopeSchema = z
  .object({
    action: ActionSchema,
    observation_id: z.string(),
    step_index: z.number(),
    session_id: z.string(),
    risk: z.enum(['low', 'medium', 'high']),
    requires_confirmation: z.boolean().default(false),
    reasoning: z.string().optional(),
  })
  .strict();
export type ActionEnvelope = z.infer<typeof ActionEnvelopeSchema>;

export const ActionResultSchema = z
  .object({
    ok: z.boolean(),
    effect_observed: z.boolean(),
    error_code: z
      .enum([
        'NONE',
        'STALE_OBSERVATION',
        'IDENTITY_MISMATCH',
        'ELEMENT_NOT_FOUND',
        'ELEMENT_OBSCURED',
        'ELEMENT_DISABLED',
        'ELEMENT_NOT_FOCUSABLE',
        'NAVIGATION_FAILED',
        'EFFECT_NOT_OBSERVED',
        'VAULT_TYPE_MISMATCH',
        'AGENT_ERROR',
        'ABORTED',
      ])
      .default('NONE'),
    error_message: z.string().optional(),
  })
  .strict();
export type ActionResult = z.infer<typeof ActionResultSchema>;
