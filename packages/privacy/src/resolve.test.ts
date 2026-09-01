import { describe, expect, it } from 'vitest';
import { createInMemoryVaultStore } from './vault-store';
import { extractPiiTypeFromHandle, resolveForBinding, type BindingTarget } from './resolve';

/**
 * C7 — deferred value binding, and the type match that guards it.
 *
 * This is the mechanism the whole privacy–utility argument rests on: the agent emits
 * `TYPE(target=e17, value=@vault:EMAIL#1)`, and the value goes **vault → page**, never
 * through the network or the model. It is also the A4 control — a hijacked reasoner
 * asking for an Aadhaar to be typed into a public search box is refused here.
 *
 * `PLAN.md` §11.5 calls the type match "one of the more interesting security
 * properties in the system". It had no test until P15-B, which is exactly the kind of
 * claim that should not survive into a document unchecked.
 */
async function vaultWith(entries: { handle: string; type: string; value: string }[]) {
  const store = createInMemoryVaultStore();
  for (const e of entries) {
    await store.set(e.handle, {
      handle: e.handle,
      type: e.type,
      tier: e.type === 'AADHAAR' || e.type === 'PASSWORD' ? 1 : 2,
      value: e.value,
      provenance: { source: 'dom', step: 0 },
      bindable: true,
    } as never);
  }
  return store;
}

const target = (over: Partial<BindingTarget> = {}): BindingTarget => ({
  element_id: 'e17',
  sensitivity_class: 'EMAIL',
  accepts: ['EMAIL'],
  ...over,
});

describe('resolveForBinding', () => {
  it('returns the value for a type-matched target', async () => {
    const vault = await vaultWith([{ handle: '⟦EMAIL#1⟧', type: 'EMAIL', value: 'anita@example.in' }]);

    const result = await resolveForBinding('⟦EMAIL#1⟧', target(), vault);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe('anita@example.in');
  });

  it('refuses to bind an Aadhaar into a field that does not accept one', async () => {
    // The exfiltration shape: a hijacked reasoner asks for an identity number to be
    // typed into a public search box. The type match is what stops it.
    const vault = await vaultWith([{ handle: '⟦AADHAAR#1⟧', type: 'AADHAAR', value: '234123412346' }]);

    const result = await resolveForBinding(
      '⟦AADHAAR#1⟧',
      target({ element_id: 'search', sensitivity_class: 'none', accepts: ['EMAIL'] }),
      vault
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VAULT_TYPE_MISMATCH');
      // The violation must be loggable without logging the value.
      expect(JSON.stringify(result.error)).not.toContain('234123412346');
    }
  });

  it('refuses an unknown handle rather than typing nothing silently', async () => {
    const vault = await vaultWith([]);

    const result = await resolveForBinding('⟦EMAIL#9⟧', target(), vault);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('HANDLE_NOT_FOUND');
  });

  it('accepts the documented cross-type compatibilities and nothing else', async () => {
    const vault = await vaultWith([
      { handle: '⟦CARD#1⟧', type: 'CARD', value: '4539578763621486' },
      { handle: '⟦DOB#1⟧', type: 'DOB', value: '1991-04-02' },
    ]);

    // CARD binds into a CREDIT_CARD field: same thing under two names.
    await expect(
      resolveForBinding('⟦CARD#1⟧', target({ accepts: ['CREDIT_CARD'] }), vault).then(r => r.ok)
    ).resolves.toBe(true);

    // DOB binds into BDAY, but not into a phone field.
    await expect(
      resolveForBinding('⟦DOB#1⟧', target({ accepts: ['BDAY'] }), vault).then(r => r.ok)
    ).resolves.toBe(true);
    await expect(
      resolveForBinding('⟦DOB#1⟧', target({ accepts: ['PHONE'] }), vault).then(r => r.ok)
    ).resolves.toBe(false);
  });

  it('carries the value only inside the Sensitive brand', async () => {
    const vault = await vaultWith([{ handle: '⟦EMAIL#1⟧', type: 'EMAIL', value: 'anita@example.in' }]);

    const result = await resolveForBinding('⟦EMAIL#1⟧', target(), vault);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The brand is what makes an accidental log or an accidental send a type error
      // rather than a review note.
      expect(result.value.__sensitiveBrand).toBe('__sensitiveBrand');
    }
  });
});

describe('extractPiiTypeFromHandle', () => {
  it('reads the type from an indexed handle', () => {
    expect(extractPiiTypeFromHandle('⟦EMAIL#3⟧')).toBe('EMAIL');
  });

  it('reads the type from a Tier-1 handle, which carries no index', () => {
    expect(extractPiiTypeFromHandle('⟦PASSWORD⟧')).toBe('PASSWORD');
  });
});
