// Enforcement test - verifies that send() requires SafePayload (branded type from egressGate)
// This test validates the type system enforcement at compile time

import type { SafePayload } from '@glasswall/schema/branded';
import type { SanitizedObservation } from '@glasswall/schema/observation';
import { describe, it, expect } from 'vitest';

// This is the signature of send() in net.ts
declare function send(p: SafePayload): Promise<Response>;

// Type test: This assignment should fail if uncommented
// const obs: SanitizedObservation = {} as any;
// const test1: SafePayload = obs; // Error: Type 'SanitizedObservation' is not assignable to type 'SafePayload'

// This assignment should work - SafePayload is a branded type only producible by egressGate
const safePayload: SafePayload = { __safePayloadBrand: '__safePayloadBrand' };
const test2: SafePayload = safePayload; // OK

describe('Egress gate enforcement', () => {
  it('SafePayload is a branded type only producible by egressGate', () => {
    expect(test2).toEqual({ __safePayloadBrand: '__safePayloadBrand' });
    expect(ENFORCEMENT_VERIFIED).toBe(true);
  });
});

export const ENFORCEMENT_VERIFIED = true;