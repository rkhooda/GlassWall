// Per-session secret state shared by every step: the registry the egress gate scans,
// the tokenizer that keeps ⟦EMAIL#1⟧ stable across observations, and the vault the
// executor resolves handles from.
//
// Values live here and in the page. They are serialized only to chrome.storage.session
// (wiped when the browser closes) so a service-worker restart mid-task can resume.
import type { SecretRegistry, SecretRegistryEntry } from '@glasswall/schema/branded';
import { createTokenizer, Tokenizer, tokenizeAndRegister } from './tokenizer';
import type { VaultStore, VaultEntry } from './vault';
import { createInMemoryVaultStore } from './vault-store';

export interface SessionSecretsSnapshot {
  session_id: string;
  registry: SecretRegistryEntry[];
  tokenizer: Array<[string, number]>;
  vault: Array<[string, VaultEntry]>;
}

export class SessionSecrets {
  readonly registry: SecretRegistry = new Map();
  readonly tokenizer: Tokenizer;
  private pending = new Map<string, VaultEntry>();

  constructor(readonly sessionId: string, readonly vault: VaultStore = createInMemoryVaultStore()) {
    this.tokenizer = createTokenizer(sessionId);
  }

  /** Tokenize a detected value: registers it for the gate and queues it for the vault. */
  record(value: string, piiType: string, tier: number): string {
    const handle = tokenizeAndRegister(this.tokenizer, this.registry, value, piiType, tier);
    if (!this.pending.has(handle)) this.pending.set(handle, { value, type: piiType, tier, createdAt: Date.now() });
    return handle;
  }

  /** Persist queued values to the vault store. Call once per step after sanitize(). */
  async flush(): Promise<number> {
    let n = 0;
    for (const [handle, entry] of this.pending) {
      if (!(await this.vault.get(handle))) {
        await this.vault.set(handle, entry);
        n++;
      }
    }
    this.pending.clear();
    return n;
  }

  handleCount(): number {
    return this.registry.size;
  }

  async snapshot(): Promise<SessionSecretsSnapshot> {
    await this.flush();
    const vault: Array<[string, VaultEntry]> = [];
    for (const handle of await this.vault.keys()) {
      const entry = await this.vault.get(handle);
      if (entry) vault.push([handle, entry]);
    }
    return { session_id: this.sessionId, registry: [...this.registry.values()], tokenizer: this.tokenizer.exportCounter(), vault };
  }

  static async restore(snapshot: SessionSecretsSnapshot, vault: VaultStore = createInMemoryVaultStore()): Promise<SessionSecrets> {
    const secrets = new SessionSecrets(snapshot.session_id, vault);
    for (const entry of snapshot.registry) secrets.registry.set(entry.handle, entry);
    secrets.tokenizer.importCounter(snapshot.tokenizer);
    for (const [handle, entry] of snapshot.vault) await vault.set(handle, entry);
    return secrets;
  }
}

export function createSessionSecrets(sessionId: string, vault?: VaultStore): SessionSecrets {
  return new SessionSecrets(sessionId, vault);
}
