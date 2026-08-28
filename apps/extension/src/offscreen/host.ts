console.log('GLASSWALL offscreen document loaded');

interface InferenceHost {
  init(cfg: { preferredEP: 'webgpu' | 'wasm' | 'auto' }): Promise<unknown>;
  load(modelId: string): Promise<{ ms: number; ep: string }>;
  run(modelId: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
  bench(modelId: string, n: number): Promise<unknown>;
}

const host: InferenceHost = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async init(): Promise<{ webgpu: boolean; wasm: boolean }> {
    return { webgpu: false, wasm: true };
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async load(): Promise<{ ms: number; ep: string }> {
    return { ms: 0, ep: 'wasm' };
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async run(): Promise<Record<string, unknown>> {
    return {};
  },
  // eslint-disable-next-line @typescript-eslint/require-await
  async bench(): Promise<unknown> {
    return {};
  },
};

interface InferenceMessage {
  type: string;
  payload: {
    method: keyof InferenceHost;
    args: unknown[];
  };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
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
    const { method, args } = message.payload;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    (host[method] as (...args: unknown[]) => Promise<unknown>)(...args)
      .then(sendResponse)
      .catch((e: Error) => sendResponse({ error: e.message }));
    return true;
  }
  return false;
});
