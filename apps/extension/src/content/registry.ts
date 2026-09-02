// Maps observation element ids ("e17") to live DOM nodes for the most recent
// observation. The executor resolves targets here; it never receives selectors.
const elements = new Map<string, Element>();
let observationId: string | null = null;

export function beginObservation(id: string): void {
  observationId = id;
  elements.clear();
}

export function register(id: string, element: Element): void {
  elements.set(id, element);
}

export function currentObservationId(): string | null {
  return observationId;
}

export function resolve(id: string): Element | null {
  const el = elements.get(id);
  return el?.isConnected ? el : null;
}
