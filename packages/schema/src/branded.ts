import { z } from 'zod';

// SafePayload: an outbound request that has passed every egress-gate check. It is
// the only thing net.ts will send, and only egressGate() constructs it.
export interface SafePayload {
  readonly __safePayloadBrand: '__safePayloadBrand';
  readonly destination: string;
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly body: unknown;
}

export const SafePayloadSchema = z.object({
  __safePayloadBrand: z.literal('__safePayloadBrand' as const),
  destination: z.string().url(),
  path: z.string().startsWith('/'),
  method: z.enum(['GET', 'POST']),
  body: z.unknown(),
});

// Brand for Sensitive<T> - represents data that should never be exposed in plaintext
// The toString() implementation returns "[redacted]" to prevent accidental leaks
export interface Sensitive<T> {
  readonly __sensitiveBrand: '__sensitiveBrand';
  readonly value: T;
}

// Zod schema factory for Sensitive<T>
// Takes an inner schema and returns a schema for Sensitive<InnerType>
export const SensitiveSchema = <T,>(
  innerSchema: z.ZodType<T>
) =>
  z.object({
    __sensitiveBrand: z.literal('__sensitiveBrand' as const),
    value: innerSchema,
  });

// Utility type to extract the inner type from Sensitive<T>
export type SensitiveValue<T> = T extends Sensitive<infer U> ? U : never;

// Brand for RedactedImage - represents an image that has been redacted and is safe to transmit
// This is the ONLY type that can carry image bytes out of the offscreen document
export interface RedactedImage {
  readonly __redactedImageBrand: '__redactedImageBrand';
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly format: 'png' | 'jpeg' | 'webp' | 'rgba';
}

// Zod schema for RedactedImage
export const RedactedImageSchema = z.object({
  __redactedImageBrand: z.literal('__redactedImageBrand' as const),
  data: z.instanceof(Uint8Array),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  format: z.enum(['png', 'jpeg', 'webp', 'rgba']),
});

// Result<T, E> - discriminated union for fallible operations (C6, C7, C8)
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ResultSchema = <T, E>(valueSchema: z.ZodType<T>, errorSchema: z.ZodType<E>) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }),
    z.object({ ok: z.literal(false), error: errorSchema }),
  ]);

// Violation - error type for privacy gate failures (C6, C7, C8)
export const ViolationSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type Violation = z.infer<typeof ViolationSchema>;

// SecretRegistry - map of vault handles to secret metadata (C6, C8)
export const SecretRegistryEntrySchema = z.object({
  handle: z.string(),
  pii_type: z.string(),
  tier: z.number(),
  created_at: z.number(),
  normalized_value: z.string(),
});
export type SecretRegistryEntry = z.infer<typeof SecretRegistryEntrySchema>;

export type SecretRegistry = Map<string, SecretRegistryEntry>;

// Helper to create ok result
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

// Helper to create err result
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}