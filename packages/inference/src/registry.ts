export interface ModelManifestEntry {
  modelId: string;
  name: string;
  description: string;
  path: string;
  inputShapes: Record<string, number[]>;
  outputNames: string[];
  tags: string[];
}

export interface ModelRegistry {
  getModelPath(modelId: string): string | undefined;
  getModelManifest(modelId: string): ModelManifestEntry | undefined;
  listModels(): ModelManifestEntry[];
  registerModel(entry: ModelManifestEntry): void;
}

declare const chrome: {
  runtime: {
    getURL(path: string): string;
  };
} | undefined;

const BUILTIN_MODELS: ModelManifestEntry[] = [
  {
    modelId: 'mlp-tiny',
    name: 'Tiny 2-Layer MLP',
    description: 'Minimal 2-layer MLP for inference spike testing (input: 4, hidden: 8, output: 2)',
    path: 'models/mlp-tiny.onnx',
    inputShapes: { input: [1, 4] },
    outputNames: ['output'],
    tags: ['test', 'spike', 'mlp'],
  },
];

function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof chrome !== 'undefined' && !!chrome?.runtime?.getURL;
}

function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node;
}

export function createModelRegistry(): ModelRegistry {
  const models = new Map<string, ModelManifestEntry>();

  for (const model of BUILTIN_MODELS) {
    models.set(model.modelId, model);
  }

  return {
    getModelPath(modelId: string): string | undefined {
      const entry = models.get(modelId);
      if (!entry) return undefined;

      if (isBrowserEnvironment()) {
        return chrome!.runtime.getURL(entry.path);
      }

      if (isNodeEnvironment()) {
        const { resolve } = require('path');
        const { fileURLToPath } = require('url');
        const __dirname = resolve(fileURLToPath(import.meta.url), '..');
        return resolve(__dirname, '..', '..', '..', 'ml', 'models', entry.path);
      }

      return entry.path;
    },

    getModelManifest(modelId: string): ModelManifestEntry | undefined {
      return models.get(modelId);
    },

    listModels(): ModelManifestEntry[] {
      return Array.from(models.values());
    },

    registerModel(entry: ModelManifestEntry): void {
      models.set(entry.modelId, entry);
    },
  };
}

export const modelRegistry = createModelRegistry();