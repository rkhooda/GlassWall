import { VaultStore, VaultEntry } from './vault';

declare const chrome: {
  storage: {
    session: {
      get(keys: string | string[], callback: (items: Record<string, unknown>) => void): void;
      set(items: Record<string, unknown>, callback: () => void): void;
      remove(keys: string | string[], callback: () => void): void;
      clear(callback: () => void): void;
    };
  };
  runtime: {
    lastError: { message: string } | undefined;
  };
} | undefined;

export interface StorageAdapter {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, unknown>();

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of keyArray) {
      if (this.store.has(key)) {
        result[key] = this.store.get(key);
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.store.set(key, value);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    for (const key of keyArray) {
      this.store.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

const VAULT_NAMESPACE = 'glasswall:vault:';

export class ChromeSessionStorageAdapter implements StorageAdapter {
  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
      throw new Error('chrome.storage.session not available');
    }
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const namespaced = keyArray.map(k => VAULT_NAMESPACE + k);
    return new Promise((resolve, reject) => {
      chrome!.storage.session.get(namespaced, (result) => {
        if (chrome!.runtime.lastError) {
          reject(chrome!.runtime.lastError);
        } else {
          const stripped: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(result)) {
            stripped[key.replace(VAULT_NAMESPACE, '')] = value;
          }
          resolve(stripped);
        }
      });
    });
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
      throw new Error('chrome.storage.session not available');
    }
    const namespaced: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(items)) {
      namespaced[VAULT_NAMESPACE + key] = value;
    }
    return new Promise((resolve, reject) => {
      chrome!.storage.session.set(namespaced, () => {
        if (chrome!.runtime.lastError) {
          reject(chrome!.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async remove(keys: string | string[]): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
      throw new Error('chrome.storage.session not available');
    }
    const keyArray = Array.isArray(keys) ? keys : [keys];
    const namespaced = keyArray.map(k => VAULT_NAMESPACE + k);
    return new Promise((resolve, reject) => {
      chrome!.storage.session.remove(namespaced, () => {
        if (chrome!.runtime.lastError) {
          reject(chrome!.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async clear(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
      throw new Error('chrome.storage.session not available');
    }
    // Only the vault's keys: the same storage area holds the audit log.
    const all = await new Promise<Record<string, unknown>>((resolve, reject) => {
      chrome!.storage.session.get(null, result => (chrome!.runtime.lastError ? reject(chrome!.runtime.lastError) : resolve(result)));
    });
    const mine = Object.keys(all).filter(k => k.startsWith(VAULT_NAMESPACE));
    if (mine.length === 0) return;
    return new Promise((resolve, reject) => {
      chrome!.storage.session.remove(mine, () => (chrome!.runtime.lastError ? reject(chrome!.runtime.lastError) : resolve()));
    });
  }
}

export class VaultStoreImpl implements VaultStore {
  private adapter: StorageAdapter;
  private cache = new Map<string, VaultEntry>();

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  async init(): Promise<void> {
    const all = await this.adapter.get([]);
    for (const [key, value] of Object.entries(all)) {
      this.cache.set(key, value as VaultEntry);
    }
  }

  async get(handle: string): Promise<VaultEntry | undefined> {
    if (this.cache.has(handle)) {
      return this.cache.get(handle);
    }
    const result = await this.adapter.get([handle]);
    if (result && result[handle]) {
      const entry = result[handle] as VaultEntry;
      this.cache.set(handle, entry);
      return entry;
    }
    return undefined;
  }

  async set(handle: string, entry: VaultEntry): Promise<void> {
    this.cache.set(handle, entry);
    await this.adapter.set({ [handle]: entry });
  }

  async delete(handle: string): Promise<boolean> {
    const existed = this.cache.delete(handle);
    if (existed) {
      await this.adapter.remove([handle]);
    }
    return existed;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    await this.adapter.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }
}

export function createVaultStore(adapter: StorageAdapter): VaultStoreImpl {
  const store = new VaultStoreImpl(adapter);
  return store;
}

export function createInMemoryVaultStore(): VaultStoreImpl {
  return createVaultStore(new InMemoryStorageAdapter());
}

export function createChromeSessionVaultStore(): VaultStoreImpl {
  return createVaultStore(new ChromeSessionStorageAdapter());
}