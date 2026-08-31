import { env, pipeline, type TokenClassificationPipeline } from '@huggingface/transformers';
import { getAssetUrl } from '../registry';
import { chunkedNer, spansFromTokens, type Span, type TokenPrediction } from './chunk';

/**
 * Transformers.js defaults to fetching weights AND the ORT wasm runtime from a CDN.
 * Every one of those four settings closes one of those doors. Called at import time
 * so no code path can run the model before the lockdown is in place.
 *
 * `allowRemoteModels = false` alone is not enough: the ORT backend still pulls its
 * .wasm from jsdelivr unless `wasmPaths` points at bundled assets.
 */
export const MODEL_BASE_URL = getAssetUrl('models/');
export const ORT_WASM_BASE_URL = getAssetUrl('ort/');

export function lockdownTransformersEnv(modelBaseUrl: string = MODEL_BASE_URL): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelBaseUrl;
  env.useBrowserCache = false;
  const wasmBackend = env.backends?.onnx?.wasm;
  if (wasmBackend) wasmBackend.wasmPaths = ORT_WASM_BASE_URL;
}

lockdownTransformersEnv();

// The generic overloads of `pipeline` blow up TS's union budget; the task is fixed here.
type PipelineFactory = (
  task: 'token-classification',
  model: string,
  options: Record<string, unknown>
) => Promise<TokenClassificationPipeline>;
const createPipeline = pipeline as unknown as PipelineFactory;

export interface NerResult {
  spans: Span[];
  modelId: string;
  inferenceMs: number;
}

/** Local model directory name under MODEL_BASE_URL, never a hub id. */
const NER_MODEL_DIR = 'ner-base';

let nerPipeline: TokenClassificationPipeline | null = null;
let loadedEp: string | null = null;

/** 'cpu' exists for the node-side accuracy harness; the extension uses webgpu/wasm. */
export type NerDevice = 'webgpu' | 'wasm' | 'cpu';

export async function loadNerModel(
  device: NerDevice = 'wasm'
): Promise<{ ms: number; ep: string }> {
  if (nerPipeline && loadedEp === device) return { ms: 0, ep: loadedEp };
  if (nerPipeline) disposeNer();

  const start = performance.now();
  nerPipeline = await createPipeline('token-classification', NER_MODEL_DIR, {
    device,
    dtype: 'q8',
  });
  loadedEp = device;
  return { ms: performance.now() - start, ep: device };
}

/** One chunk through the model. Offsets are recovered here because the library
 *  returns wordpiece labels with no character positions. */
async function runChunk(text: string): Promise<Span[]> {
  const raw = await nerPipeline!(text);
  const tokens = (Array.isArray(raw) ? raw.flat() : [raw]) as TokenPrediction[];
  return spansFromTokens(text, tokens);
}

/** Chunked, boundary-merged, confidence-thresholded NER over one text blob. */
export async function runNer(text: string, threshold: number): Promise<NerResult> {
  if (!nerPipeline) throw new Error('ner model not loaded');

  const start = performance.now();
  const spans = await chunkedNer(text, runChunk, { threshold });
  return { spans, modelId: NER_MODEL_DIR, inferenceMs: performance.now() - start };
}

export function isNerAvailable(): boolean {
  return nerPipeline !== null;
}

export function disposeNer(): void {
  nerPipeline = null;
  loadedEp = null;
}
