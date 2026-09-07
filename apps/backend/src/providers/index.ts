// Provider registry and failover. Order (env GLASSWALL_PROVIDER_ORDER, default
// "openai,anthropic,scripted"): try each configured provider; on transport or
// validation failure move to the next. "openai" expands to one provider per model
// in GLASSWALL_LLM_MODEL, so a spent quota falls through to the next model. The
// scripted planner is always last, so a step always returns an action even with no
// network and no key.
import type { Provider, PlanInput } from './types';
import { createOpenAiCompatibleProviders } from './openai-compatible';
import { createAnthropicProvider } from './anthropic';
import { scriptedProvider } from './scripted';
import { hijackedProvider } from './hijacked';

export type { Provider, PlanInput } from './types';
export { scriptedProvider, planScripted } from './scripted';

export function buildProviderChain(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const order = (env.GLASSWALL_PROVIDER_ORDER ?? 'openai,anthropic,scripted').split(',').map(s => s.trim());
  const byName: Record<string, Provider[]> = {
    openai: createOpenAiCompatibleProviders(env),
    anthropic: [createAnthropicProvider(env)].filter((p): p is Provider => p !== null),
    scripted: [scriptedProvider],
  };
  const chain = order.flatMap(n => byName[n] ?? []);
  if (!chain.includes(scriptedProvider)) chain.push(scriptedProvider);
  // Demo switch: a simulated prompt-injected planner goes first so judges can watch the client block it.
  if (env.GLASSWALL_DEMO_HIJACKED === '1') chain.unshift(hijackedProvider);
  return chain;
}

export interface PlanAttempt {
  provider: string;
  ok: boolean;
  error?: string;
}

/**
 * Ask providers in order until one returns something the validator accepts.
 * `validate` is the guard; a provider gets one repair retry with the error text
 * before the chain moves on.
 */
export async function planWithFailover<T>(
  chain: Provider[],
  input: PlanInput,
  validate: (raw: unknown) => { ok: true; value: T } | { ok: false; error: string },
): Promise<{ value: T; provider: string; attempts: PlanAttempt[] }> {
  const attempts: PlanAttempt[] = [];
  for (const provider of chain) {
    const health = await provider.available();
    if (!health.ok) {
      attempts.push({ provider: provider.name, ok: false, error: health.detail ?? 'unavailable' });
      continue;
    }
    let repairError: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await provider.plan({ ...input, repairError });
        const result = validate(raw);
        if (result.ok) {
          attempts.push({ provider: provider.name, ok: true });
          return { value: result.value, provider: provider.name, attempts };
        }
        repairError = result.error;
        attempts.push({ provider: provider.name, ok: false, error: `invalid action: ${result.error}` });
      } catch (e) {
        attempts.push({ provider: provider.name, ok: false, error: e instanceof Error ? e.message : String(e) });
        break; // transport failure: do not retry this provider
      }
    }
  }
  throw new Error(`No provider produced a valid action: ${attempts.map(a => `${a.provider}: ${a.error ?? 'ok'}`).join('; ')}`);
}
