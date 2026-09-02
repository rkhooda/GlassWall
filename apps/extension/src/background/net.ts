// The only network call site in the extension (hard rule 1). It sends a SafePayload
// and nothing else; SafePayload is constructed solely by egressGate() (hard rule 2).
import type { SafePayload } from '@glasswall/schema/branded';

export interface GatewayReply {
  status: number;
  body: unknown;
}

export async function send(p: SafePayload): Promise<GatewayReply> {
  const response = await fetch(p.destination + p.path, {
    method: p.method,
    headers: p.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: p.method === 'POST' ? JSON.stringify(p.body) : undefined,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}
