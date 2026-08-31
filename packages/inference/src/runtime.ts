import { InferenceSession, Tensor } from 'onnxruntime-web';
import type { CapabilitySnapshot } from './capability';

export type ExecutionProvider = 'webgpu' | 'wasm';

export interface SessionCacheEntry {
  session: InferenceSession;
  modelId: string;
  ep: ExecutionProvider;
  createdAt: number;
  lastUsedAt: number;
}

export interface LoadResult {
  ms: number;
  ep: string;
  sessionId: string;
}

export interface RunResult {
  outputs: Record<string, Tensor>;
  ms: number;
}

export interface BenchResult {
  ms: number;
  ep: string;
  iterations: number;
  warmupMs: number;
  coldMs: number;
  warmMs: number;
}

export type EPPreference = 'webgpu' | 'wasm' | 'auto';

export interface RuntimeConfig {
  preferredEP: EPPreference;
  maxCacheSize: number;
  sessionTtlMs: number;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  preferredEP: 'auto',
  maxCacheSize: 10,
  sessionTtlMs: 5 * 60 * 1000,
};

function selectExecutionProvider(preferred: EPPreference, capability: CapabilitySnapshot): ExecutionProvider {
  if (preferred === 'webgpu' && capability.webgpu) return 'webgpu';
  if (preferred === 'wasm') return 'wasm';
  if (preferred === 'auto') {
    if (capability.webgpu) return 'webgpu';
    return 'wasm';
  }
  return 'wasm';
}

function getEPReason(preferred: EPPreference, capability: CapabilitySnapshot, selected: ExecutionProvider): string {
  if (preferred !== 'auto') {
    return `explicit preference: ${preferred}`;
  }
  if (selected === 'webgpu') {
    return capability.webgpu ? 'auto: webgpu available' : 'auto: fallback to wasm (webgpu unavailable)';
  }
  return capability.webgpu ? 'auto: wasm preferred over webgpu' : 'auto: webgpu unavailable, using wasm';
}

class ORTRuntime {
  private cache = new Map<string, SessionCacheEntry>();
  private config: RuntimeConfig;
  private capability: CapabilitySnapshot | null = null;
  private initPromise: Promise<CapabilitySnapshot> | null = null;

  constructor(config: Partial<RuntimeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(preferredEP: EPPreference = 'auto'): Promise<CapabilitySnapshot> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const { probeCapabilities } = await import('./capability');
      this.capability = await probeCapabilities();
      return this.capability;
    })();

    return this.initPromise;
  }

  getCapability(): CapabilitySnapshot | null {
    return this.capability;
  }

  getPreferredEP(preferredEP: EPPreference): ExecutionProvider {
    if (!this.capability) {
      throw new Error('Runtime not initialized. Call init() first.');
    }
    return selectExecutionProvider(preferredEP, this.capability);
  }

  private getCacheKey(modelId: string, ep: ExecutionProvider): string {
    return `${modelId}@${ep}`;
  }

  private evictOldSessions(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastUsedAt > this.config.sessionTtlMs) {
        entry.session.release();
        this.cache.delete(key);
      }
    }

    if (this.cache.size >= this.config.maxCacheSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastUsedAt < oldestTime) {
          oldestTime = entry.lastUsedAt;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        const entry = this.cache.get(oldestKey)!;
        entry.session.release();
        this.cache.delete(oldestKey);
      }
    }
  }

  async load(modelId: string, modelPath: string, preferredEP: EPPreference = 'auto'): Promise<LoadResult> {
    if (!this.capability) {
      await this.init(preferredEP);
    }
    const ep = this.getPreferredEP(preferredEP);
    const reason = getEPReason(preferredEP, this.capability!, ep);
    const cacheKey = this.getCacheKey(modelId, ep);

    const existing = this.cache.get(cacheKey);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return { ms: 0, ep, sessionId: cacheKey };
    }

    this.evictOldSessions();

    const start = performance.now();
    let session: InferenceSession;

    try {
      if (ep === 'webgpu') {
        session = await InferenceSession.create(modelPath, { executionProviders: ['webgpu'] });
      } else {
        session = await InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
      }
    } catch (error) {
      if (ep === 'webgpu') {
        const wasmKey = this.getCacheKey(modelId, 'wasm');
        const wasmStart = performance.now();
        session = await InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
        const wasmMs = performance.now() - wasmStart;
        this.cache.set(wasmKey, {
          session,
          modelId,
          ep: 'wasm',
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        });
        return { ms: wasmMs, ep: 'wasm', sessionId: wasmKey };
      }
      throw error;
    }

    const ms = performance.now() - start;
    this.cache.set(cacheKey, {
      session,
      modelId,
      ep,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    return { ms, ep, sessionId: cacheKey };
  }

  async run(modelId: string, inputs: Record<string, Tensor>, preferredEP: EPPreference = 'auto'): Promise<RunResult> {
    if (!this.capability) {
      await this.init(preferredEP);
    }
    const ep = this.getPreferredEP(preferredEP);
    const cacheKey = this.getCacheKey(modelId, ep);

    const entry = this.cache.get(cacheKey);
    if (!entry) {
      throw new Error(`Model ${modelId} not loaded for EP ${ep}. Call load() first.`);
    }

    entry.lastUsedAt = Date.now();
    const start = performance.now();
    const outputs = await entry.session.run(inputs);
    const ms = performance.now() - start;

    return { outputs, ms };
  }

  async bench(modelId: string, n: number, preferredEP: EPPreference = 'auto'): Promise<BenchResult> {
    if (!this.capability) {
      await this.init(preferredEP);
    }
    const ep = this.getPreferredEP(preferredEP);
    const cacheKey = this.getCacheKey(modelId, ep);

    const entry = this.cache.get(cacheKey);
    if (!entry) {
      throw new Error(`Model ${modelId} not loaded for EP ${ep}. Call load() first.`);
    }

    const inputShapes: Record<string, number[]> = {};
    for (const meta of entry.session.inputMetadata) {
      if (meta.isTensor && Array.isArray(meta.shape)) {
        inputShapes[meta.name] = meta.shape.map((d) => (typeof d === 'number' ? d : 1));
      }
    }

    const dummyInputs: Record<string, Tensor> = {};
    for (const [name, shape] of Object.entries(inputShapes)) {
      const size = shape.reduce((a, b) => a * b, 1);
      dummyInputs[name] = new Tensor('float32', new Float32Array(size), shape);
    }

    await entry.session.run(dummyInputs);

    const warmupStart = performance.now();
    await entry.session.run(dummyInputs);
    const warmupMs = performance.now() - warmupStart;

    const coldStart = performance.now();
    await entry.session.run(dummyInputs);
    const coldMs = performance.now() - coldStart;

    let totalMs = 0;
    for (let i = 0; i < n; i++) {
      const runStart = performance.now();
      await entry.session.run(dummyInputs);
      totalMs += performance.now() - runStart;
    }
    const warmMs = totalMs / n;

    entry.lastUsedAt = Date.now();

    return {
      ms: warmMs,
      ep,
      iterations: n,
      warmupMs,
      coldMs,
      warmMs,
    };
  }

  dispose(modelId?: string): void {
    if (modelId) {
      for (const [key, entry] of this.cache.entries()) {
        if (entry.modelId === modelId) {
          entry.session.release();
          this.cache.delete(key);
        }
      }
    } else {
      for (const entry of this.cache.values()) {
        entry.session.release();
      }
      this.cache.clear();
    }
  }

  getCacheStats(): { size: number; entries: { modelId: string; ep: ExecutionProvider; ageMs: number }[] } {
    const now = Date.now();
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.values()).map((e) => ({
        modelId: e.modelId,
        ep: e.ep,
        ageMs: now - e.createdAt,
      })),
    };
  }
}

export const runtime = new ORTRuntime();