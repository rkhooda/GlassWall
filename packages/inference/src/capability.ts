interface GPUAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  backend: string;
}

interface NavigatorWithGPU extends Navigator {
  gpu?: {
    requestAdapter(): Promise<{ info?: GPUAdapterInfo } | null>;
  };
}

export interface CapabilitySnapshot {
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemory: number | undefined;
  crossOriginIsolated: boolean;
  wasmSimd: boolean;
  wasmThreads: boolean;
  webgpu: boolean;
  webgpuAdapter: GpuAdapterInfo | null;
  timestamp: number;
}

export interface GpuAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  backend: string;
}

function probeWasmSimd(): boolean {
  if (typeof WebAssembly === 'undefined') return false;
  try {
    new WebAssembly.Module(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
        0x03, 0x02, 0x01, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x41, 0x02, 0x6a, 0x0b,
      ])
    );
    return true;
  } catch {
    return false;
  }
}

function probeWasmThreads(): boolean {
  const coi = typeof globalThis !== 'undefined' && 'crossOriginIsolated' in globalThis
    ? (globalThis as typeof globalThis & { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false
    : false;
  if (typeof WebAssembly === 'undefined' || !coi) return false;
  try {
    new WebAssembly.Module(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
        0x03, 0x02, 0x01, 0x00, 0x0a, 0x07, 0x01, 0x05, 0x01, 0x00, 0x0b,
      ])
    );
    return true;
  } catch {
    return false;
  }
}

async function probeWebGPU(): Promise<{ available: boolean; adapter: GpuAdapterInfo | null }> {
  if (typeof navigator === 'undefined') {
    return { available: false, adapter: null };
  }
  const nav = navigator as NavigatorWithGPU;
  if (!nav.gpu) {
    return { available: false, adapter: null };
  }
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return { available: false, adapter: null };
    }
    const info = {
      vendor: adapter.info?.vendor ?? 'unknown',
      architecture: adapter.info?.architecture ?? 'unknown',
      device: adapter.info?.device ?? 'unknown',
      description: adapter.info?.description ?? 'unknown',
      backend: adapter.info?.backend ?? 'unknown',
    };
    return { available: true, adapter: info };
  } catch {
    return { available: false, adapter: null };
  }
}

export async function probeCapabilities(): Promise<CapabilitySnapshot> {
  const crossOriginIsolated = typeof globalThis !== 'undefined' && 'crossOriginIsolated' in globalThis
    ? (globalThis as typeof globalThis & { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false
    : false;
  const [wasmSimd, wasmThreads, webgpuResult] = await Promise.all([
    probeWasmSimd(),
    probeWasmThreads(),
    probeWebGPU(),
  ]);

  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0,
    deviceMemory: typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined,
    crossOriginIsolated,
    wasmSimd,
    wasmThreads,
    webgpu: webgpuResult.available,
    webgpuAdapter: webgpuResult.adapter,
    timestamp: Date.now(),
  };
}

export function serializeCapability(snapshot: CapabilitySnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function deserializeCapability(json: string): CapabilitySnapshot {
  return JSON.parse(json) as CapabilitySnapshot;
}