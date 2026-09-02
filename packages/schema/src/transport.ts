import { z } from 'zod';
import { SanitizedObservationSchema } from './observation';
import { ActionEnvelopeSchema } from './action';
import { PolicyProfileSchema } from './policy';

// What crosses the network, exactly. Every schema is strict so an extra field is a
// gate violation, not a surprise on the server.

/** A pixel-redacted screenshot. Only the offscreen redaction pipeline produces the brand. */
export const RedactedImagePayloadSchema = z
  .object({
    __redactedImageBrand: z.literal('__redactedImageBrand'),
    mime: z.literal('image/png'),
    data_base64: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    redaction_count: z.number().int().nonnegative(),
  })
  .strict();
export type RedactedImagePayload = z.infer<typeof RedactedImagePayloadSchema>;

export const SessionRequestSchema = z
  .object({
    task: z.string().min(1).max(2000),
    policy_profile: PolicyProfileSchema,
    site_allowlist: z.array(z.string()).max(20).default([]),
    client: z.object({ extension_version: z.string(), capability: z.object({ webgpu: z.boolean(), wasm: z.boolean() }).optional() }).strict().optional(),
  })
  .strict();
export type SessionRequest = z.infer<typeof SessionRequestSchema>;

export const SessionResponseSchema = z
  .object({ session_id: z.string(), budget: z.object({ steps_left: z.number(), ms_left: z.number() }).strict(), provider: z.string() })
  .strict();
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const StepRequestSchema = z
  .object({
    session_id: z.string(),
    observation: SanitizedObservationSchema,
    history: z.array(ActionEnvelopeSchema).max(5).default([]),
    /** Last executor result, so the planner knows the previous action failed. */
    last_result: z.object({ ok: z.boolean(), error_code: z.string().optional(), effect_observed: z.boolean() }).strict().optional(),
    screenshot: RedactedImagePayloadSchema.optional(),
  })
  .strict();
export type StepRequest = z.infer<typeof StepRequestSchema>;

export const StepResponseSchema = z
  .object({
    action_envelope: ActionEnvelopeSchema,
    provider: z.string(),
    latency_ms: z.number(),
  })
  .strict();
export type StepResponse = z.infer<typeof StepResponseSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    providers: z.array(z.object({ name: z.string(), available: z.boolean(), vision: z.boolean(), detail: z.string().optional() }).strict()),
    active: z.string(),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const GATEWAY_PATHS = { session: '/v1/session', step: '/v1/step', health: '/v1/health' } as const;
