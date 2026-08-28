// This is the ONLY file allowed to use fetch
export async function send(payload: unknown): Promise<Response> {
  return fetch('http://localhost:3000/v1/step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
