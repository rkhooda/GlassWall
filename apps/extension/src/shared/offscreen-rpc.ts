// Offscreen document RPC utilities
// Manages offscreen document lifecycle and provides RPC interface

import { bus } from './bus';

// InferenceHost interface from contract C3
export interface InferenceHost {
  init(cfg: { preferredEP: 'webgpu' | 'wasm' | 'auto' }): Promise<Capability>;
  load(modelId: string): Promise<{ ms: number; ep: string }>;
  run(modelId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
  bench(modelId: string, n: number): Promise<unknown>;
}

export interface Capability {
  webgpu: boolean;
  wasm: boolean;
}

export interface BenchResult {
  ms: number;
  ep: string;
}

// Simple echo handler for testing
export const echoHandler: InferenceHost = {
  init: async () => ({ webgpu: false, wasm: true }),
  load: async (modelId: string) => ({ ms: 0, ep: 'wasm' }),
  run: async (_modelId: string, inputs: Record<string, unknown>) => ({ ...inputs }), // Echo inputs back
  bench: async (_modelId: string, _n: number) => ({}),
};

// Send RPC request to offscreen document and wait for response
export function callOffscreenMethod(
  method: keyof InferenceHost,
  ...args: unknown[]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(2, 9);

    // Set up timeout for safety
    const timeoutId = setTimeout(() => {
      reject(new Error(`Offscreen RPC timeout for method ${method}`));
    }, 5000); // 5 second timeout

    // Listen for response
    const responseHandler = (message: { type: string; payload: { requestId: string; result?: unknown; error?: string } }) => {
      if (message.type === 'system:offscreen-response' && message.payload.requestId === requestId) {
        // Clean up
        clearTimeout(timeoutId);

        if (message.payload.error !== undefined) {
          reject(new Error(message.payload.error));
        } else {
          resolve(message.payload.result);
        }
      }
    };

    // Subscribe to responses
    bus.subscribe('system:offscreen-response', responseHandler as unknown as (message: any) => void);

    // Send request
    bus.publish({
      type: 'system:offscreen-request',
      payload: {
        method,
        args,
        requestId,
      }
    });
  });
}