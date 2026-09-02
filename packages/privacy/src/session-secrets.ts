// Per-session secret state shared by every step: the registry the egress gate scans,
// the tokenizer that keeps ⟦EMAIL#1⟧ stable across observations, and the vault the
// executor resolves handles from.
//
// Values live here and in the page. They are serialized only to chrome.storage.session
// (wiped when the browser closes) so a service-worker restart mid-task can resume.
import type { SecretRegistry, SecretRegistryEntry } from '@glasswall/schema/branded';
import type { Tokenizer} from './tokenizer';
import { createTokenizer, tokenizeAndRegister } from './tokenizer';
import type { VaultStore, VaultEntry } from './vault';
import { createInMemoryVaultStore } from './vault-store';

export interface SessionSecretsSnapshot {
  session_id: string;
  registry: SecretRegistryEntry[];
  tokenizer: [string, number][];
  vault: [string, VaultEntry][];
}

export class SessionSecrets {
  readonly registry: SecretRegistry = new Map();
  readonly tokenizer: Tokenizer;
  private pending = new Map<string, VaultEntry>();
  /** Every surface form seen for a handle, so a value reappearing anywhere on a later page is substituted. */
  private surfaces = new Map<string, Set<string>>();

  constructor(readonly sessionId: string, readonly vault: VaultStore = createInMemoryVaultStore()) {
    this.tokenizer = createTokenizer(sessionId);
  }

  /** Tokenize a detected value: registers it for the gate and queues it for the vault. */
  record(value: string, piiType: string, tier: number): string {
    const handle = tokenizeAndRegister(this.tokenizer, this.registry, value, piiType, tier);
    if (!this.pending.has(handle)) this.pending.set(handle, { value, type: piiType, tier, createdAt: Date.now() });
    let forms = this.surfaces.get(handle);
    if (!forms) this.surfaces.set(handle, (forms = new Set()));
    forms.add(value);
    return handle;
  }

  /** Known values and their handles, for substitution in text the detectors did not flag. */
  knownValues(): { value: string; handle: string }[] {
    const out: { value: string; handle: string }[] = [];
    for (const [handle, forms] of this.surfaces) for (const value of forms) out.push({ value, handle });
    return out;
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
    const vault: [string, VaultEntry][] = [];
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
    for (const [handle, entry] of snapshot.vault) {
      await vault.set(handle, entry);
      secrets.surfaces.set(handle, new Set([entry.value]));
    }
    return secrets;
  }
}

export function createSessionSecrets(sessionId: string, vault?: VaultStore): SessionSecrets {
  return new SessionSecrets(sessionId, vault);
}
