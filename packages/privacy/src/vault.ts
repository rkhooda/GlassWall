import { Sensitive } from './sensitive';

export interface VaultEntry {
  value: string;
  type: string;
  tier: number;
  createdAt: number;
}

export interface VaultStore {
  get(handle: string): Promise<VaultEntry | undefined>;
  set(handle: string, entry: VaultEntry): Promise<void>;
  delete(handle: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export class Vault {
  private store: VaultStore;

  constructor(store: VaultStore) {
    this.store = store;
  }

  async storeValue(handle: string, value: string, type: string, tier: number): Promise<void> {
    const entry: VaultEntry = {
      value,
      type,
      tier,
      createdAt: Date.now(),
    };
    await this.store.set(handle, entry);
  }

  async retrieve(handle: string): Promise<Sensitive<string> | undefined> {
    const entry = await this.store.get(handle);
    if (!entry) return undefined;
    return this.createSensitive(entry.value);
  }

  async getType(handle: string): Promise<string | undefined> {
    const entry = await this.store.get(handle);
    return entry?.type;
  }

  async getTier(handle: string): Promise<number | undefined> {
    const entry = await this.store.get(handle);
    return entry?.tier;
  }

  async delete(handle: string): Promise<boolean> {
    return this.store.delete(handle);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  private createSensitive(value: string): Sensitive<string> {
    const obj = Object.create(null);
    Object.defineProperty(obj, '__sensitiveBrand', {
      value: '__sensitiveBrand',
      writable: false,
      enumerable: false,
      configurable: false,
    });
    Object.defineProperty(obj, 'value', {
      value,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    if (typeof Symbol !== 'undefined' && Symbol.for) {
      Object.defineProperty(obj, Symbol.for('nodejs.util.inspect.custom'), {
        value: () => '[redacted]',
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }
    return obj as Sensitive<string>;
  }
}

export function createVault(store: VaultStore): Vault {
  return new Vault(store);
}