// Offscreen document host - manages InferenceHost RPC and lifecycle
// Lane A provides the runtime, Lane B implements the handlers

import { bus } from '../shared/bus';
import { InferenceHost, echoHandler } from '../shared/offscreen-rpc';

console.log('GLASSWALL offscreen document loaded');

// Handler that Lane B will implement
// Starts as null to indicate Lane B hasn't implemented their handler yet
let hostHandler: InferenceHost | null = null;

// Set the handler for Lane B to implement
export function setInferenceHandler(handler: InferenceHost | null) {
  hostHandler = handler;
}

interface InferenceMessage {
  type: string;
  payload: {
    method: keyof InferenceHost;
    args: unknown[];
    requestId: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript.exit/no-unsafe-call
const runtime = chrome.runtime as unknown as {
  onMessageExternal: {
    addListener: (
      cb: (
        message: InferenceMessage,
        _sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    ) => void;
  };
};

runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message.type === 'INFERENCE_RPC') {
    const { method, args, requestId } = message.payload as {
      method: keyof InferenceHost;
      args: unknown[];
      requestId: string;
    };

    // Handle the request and send response
    (async () => {
      try {
        // Get the current handler
        const handler = hostHandler;

        // If no handler is registered by Lane B, return "not implemented"
        if (handler === null) {
          throw new Error('not implemented by lane B yet');
        }

        // Call the appropriate method
        let result: unknown;
        switch (method) {
          case 'init':
            result = await handler.init(args[0] as { preferredEP: 'webgpu' | 'wasm' | 'auto' });
            break;
          case 'load':
            result = await handler.load(args[0] as string);
            break;
          case 'run':
            result = await handler.run(args[0] as string, args[1] as Record<string, unknown>);
            break;
          case 'bench':
            result = await handler.bench(args[0] as string, args[1] as number);
            break;
          default:
            throw new Error(`Unknown method: ${method}`);
        }

        // Send success response
        sendResponse({
          type: 'OFFSCREEN_RPC_RESPONSE',
          payload: {
            requestId,
            result
          }
        });
      } catch (error) {
        // Send error response
        sendResponse({
          type: 'OFFSCREEN_RPC_RESPONSE',
          payload: {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    })();

    return true; // Keep message channel open for async response
  }
  return false;
});

// Also listen for messages via bus for internal communication
// Using system:* namespace for Lane A to Lane A communication
bus.subscribe('system:offscreen-request', async (message) => {
  // Type guard to ensure we're handling the right message type
  if (message && typeof message === 'object' && 'type' in message && message.type === 'system:offscreen-request' && 'payload' in message) {
    const typedMessage = message as { type: string; payload: { method: string; args: unknown[]; requestId: string } };

    try {
      // Get the current handler
      const handler = hostHandler;

      // If no handler is registered by Lane B, return "not implemented"
      if (handler === null) {
        throw new Error('not implemented by lane B yet');
      }

      // Call the appropriate method
      let result: unknown;
      switch (typedMessage.payload.method) {
        case 'init':
          result = await handler.init(typedMessage.payload.args[0] as { preferredEP: 'webgpu' | 'wasm' | 'auto' });
          break;
        case 'load':
          result = await handler.load(typedMessage.payload.args[0] as string);
          break;
        case 'run':
          result = await handler.run(typedMessage.payload.args[0] as string, typedMessage.payload.args[1] as Record<string, unknown>);
          break;
        case 'bench':
          result = await handler.bench(typedMessage.payload.args[0] as string, typedMessage.payload.args[1] as number);
          break;
        default:
          throw new Error(`Unknown method: ${typedMessage.payload.method}`);
      }

      // Send success response via bus
      bus.publish({
        type: 'system:offscreen-response',
        payload: {
          requestId: typedMessage.payload.requestId,
          result
        }
      });
    } catch (error) {
      // Send error response via bus
      bus.publish({
        type: 'system:offscreen-response',
        payload: {
          requestId: typedMessage.payload.requestId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
});

console.log('GLASSWALL offscreen document initialized');