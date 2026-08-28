import { z } from 'zod';

// Brand for SafePayload - represents data that has passed through the egress gate
// and is safe to send over the network
export type SafePayload = {
  readonly __safePayloadBrand: '__safePayloadBrand';
};

// Zod schema for SafePayload - this is a marker interface
// The actual payload structure will be defined by whoever creates it
export const SafePayloadSchema = z.object({
  __safePayloadBrand: z.literal('__safePayloadBrand' as const),
});

// Brand for Sensitive<T> - represents data that should never be exposed in plaintext
// The toString() implementation returns "[redacted]" to prevent accidental leaks
export type Sensitive<T> = {
  readonly __sensitiveBrand: '__sensitiveBrand';
  readonly value: T;
};

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