import { describe, it, expect } from 'vitest';
import { probeCapabilities, serializeCapability, deserializeCapability } from './capability';

describe('capability probe', () => {
  it('returns a valid capability snapshot', async () => {
    const caps = await probeCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.userAgent).toBe('string');
    expect(typeof caps.hardwareConcurrency).toBe('number');
    expect(typeof caps.crossOriginIsolated).toBe('boolean');
    expect(typeof caps.wasmSimd).toBe('boolean');
    expect(typeof caps.wasmThreads).toBe('boolean');
    expect(typeof caps.webgpu).toBe('boolean');
    expect(typeof caps.timestamp).toBe('number');
  });

  it('serializes and deserializes correctly', async () => {
    const caps = await probeCapabilities();
    const json = serializeCapability(caps);
    const restored = deserializeCapability(json);
    expect(restored).toEqual(caps);
  });

  it('has snapshot-serializable structure', async () => {
    const caps = await probeCapabilities();
    const json = JSON.stringify(caps);
    const parsed = JSON.parse(json) as unknown;
    expect(parsed).toEqual(caps);
  });
});
