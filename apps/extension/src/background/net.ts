// This is the ONLY file allowed to use fetch
// C6 CONTRACT: send() accepts ONLY SafePayload (branded type from egressGate)
// Bypassing the gate is a compile error, not a review note.

import type { SafePayload } from '@glasswall/schema/branded';

export async function send(p: SafePayload): Promise<Response> {
  return fetch('http://localhost:3000/v1/step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
}
