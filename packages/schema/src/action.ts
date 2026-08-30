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

export const TargetSchema = z.object({
  id: z.string(),
  id_hash: z.string(),
});
export type Target = z.infer<typeof TargetSchema>;

export const LiteralValueSchema = z.object({
  kind: z.literal('literal'),
  text: z.string().max(200),
});
export type LiteralValue = z.infer<typeof LiteralValueSchema>;

export const VaultRefValueSchema = z.object({
  kind: z.literal('vault_ref'),
  handle: z.string(),
});
export type VaultRefValue = z.infer<typeof VaultRefValueSchema>;

export const UserInputValueSchema = z.object({
  kind: z.literal('user_input'),
  field_type: z.string(),
});
export type UserInputValue = z.infer<typeof UserInputValueSchema>;

export const ValueSchema = z.discriminatedUnion('kind', [
  LiteralValueSchema,
  VaultRefValueSchema,
  UserInputValueSchema,
]);
export type Value = z.infer<typeof ValueSchema>;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CLICK'),
    target: TargetSchema,
  }),
  z.object({
    type: z.literal('TYPE'),
    target: TargetSchema,
    value: ValueSchema,
    clear_first: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('SCROLL'),
    direction: z.enum(['down', 'up', 'left', 'right']),
    amount: z.number().optional(),
    target: TargetSchema.optional(),
  }),
  z.object({
    type: z.literal('SELECT'),
    target: TargetSchema,
    option_index: z.number(),
  }),
  z.object({
    type: z.literal('PRESS_KEY'),
    key: z.string(),
    target: TargetSchema.optional(),
  }),
  z.object({
    type: z.literal('NAVIGATE'),
    url_template: z.string(),
  }),
  z.object({
    type: z.literal('WAIT'),
    condition: z.enum(['stable', 'element', 'navigation']),
    target: TargetSchema.optional(),
    timeout_ms: z.number().default(5000),
  }),
  z.object({
    type: z.literal('BACK'),
  }),
  z.object({
    type: z.literal('DONE'),
    outcome: z.enum(['success', 'blocked', 'impossible']),
    evidence_element: z.string().optional(),
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
        'LITERAL_CONTAINS_SECRET',
        'EGRESS_GATE_VIOLATION',
        'AGENT_ERROR',
        'ABORTED',
        'UNKNOWN_TARGET',
        'ELEMENT_NOT_ACTIONABLE',
        'UNSUPPORTED_ACTION',
        'ORIGIN_NOT_ALLOWED',
      ])
      .default('NONE'),
    error_message: z.string().optional(),
  })
  .strict();
export type ActionResult = z.infer<typeof ActionResultSchema>;