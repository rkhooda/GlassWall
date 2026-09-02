// Gateway routes. The gateway is stateless apart from a short per-session history;
// it stores no observations and can dereference no handle.
import type { FastifyInstance } from 'fastify';
import { SessionRequestSchema, StepRequestSchema, type SessionResponse, type StepResponse, type HealthResponse } from '@glasswall/schema/transport';
import type { ActionEnvelope } from '@glasswall/schema/action';
import { POLICY_PRESETS, type PolicyConfig } from '@glasswall/schema/policy';
import { buildProviderChain, planWithFailover, type Provider } from '../providers/index.js';
import { validateActionEnvelope } from '../guard/validate.js';

interface Session {
  id: string;
  task: string;
  policy: PolicyConfig;
  siteAllowlist: string[];
  stepsLeft: number;
  createdAt: number;
  history: ActionEnvelope[];
}

const STEP_BUDGET = Number(process.env.GLASSWALL_STEP_BUDGET ?? 20);
const TIME_BUDGET_MS = Number(process.env.GLASSWALL_TIME_BUDGET_MS ?? 5 * 60 * 1000);
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface RouteOptions {
  providers?: Provider[];
}

export async function registerRoutes(app: FastifyInstance, opts: RouteOptions = {}): Promise<void> {
  const chain = opts.providers ?? buildProviderChain();
  const sessions = new Map<string, Session>();

  const sweep = () => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  };

  app.get('/v1/health', async (): Promise<HealthResponse> => {
    const providers = await Promise.all(chain.map(async p => ({ name: p.name, available: (await p.available()).ok, vision: p.vision, detail: (await p.available()).detail })));
    return { status: 'ok', providers, active: providers.find(p => p.available)?.name ?? 'none' };
  });

  app.post('/v1/session', async (request, reply) => {
    const parsed = SessionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.issues });
    sweep();
    const { task, policy_profile, site_allowlist } = parsed.data;
    const id = crypto.randomUUID();
    sessions.set(id, { id, task, policy: POLICY_PRESETS[policy_profile], siteAllowlist: site_allowlist, stepsLeft: STEP_BUDGET, createdAt: Date.now(), history: [] });
    const active = (await Promise.all(chain.map(async p => ((await p.available()).ok ? p.name : null)))).find(Boolean) ?? 'none';
    const body: SessionResponse = { session_id: id, budget: { steps_left: STEP_BUDGET, ms_left: TIME_BUDGET_MS }, provider: active };
    return reply.send(body);
  });

  app.post('/v1/step', async (request, reply) => {
    const started = Date.now();
    const parsed = StepRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.issues.slice(0, 5) });
    const { session_id, observation, history, last_result, screenshot } = parsed.data;
    const session = sessions.get(session_id);
    if (!session) return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    if (session.stepsLeft <= 0) return reply.code(429).send({ error: 'BUDGET_EXHAUSTED', type: 'steps' });
    if (Date.now() - session.createdAt > TIME_BUDGET_MS) return reply.code(429).send({ error: 'BUDGET_EXHAUSTED', type: 'time' });
    session.stepsLeft--;
    const stepIndex = STEP_BUDGET - session.stepsLeft - 1;

    // The gateway remembers the whole run (up to the step budget); the client's
    // five-entry window is what the schema allows on the wire.
    const fullHistory = session.history.length >= history.length ? session.history : history;
    // Loop detector: three identical actions in a row means the plan is stuck.
    const recent = fullHistory.slice(-3);
    const stuck = recent.length === 3 && recent.every(h => JSON.stringify(h.action) === JSON.stringify(recent[0]!.action));

    try {
      const { value, provider, attempts } = await planWithFailover(chain, {
        sessionId: session_id,
        stepIndex,
        task: session.task + (stuck ? ' (The same action was repeated three times without progress: choose a different action or finish with DONE.)' : ''),
        observation,
        history: fullHistory,
        lastResult: last_result,
        screenshot,
        policy: session.policy,
      }, raw => validateActionEnvelope(raw, observation, { sessionId: session_id, stepIndex }));

      let envelope = value;
      if (stuck && JSON.stringify(envelope.action) === JSON.stringify(recent[0]!.action)) {
        envelope = { ...envelope, action: { type: 'DONE', outcome: 'blocked' }, risk: 'low', requires_confirmation: false, reasoning: 'Loop detected: the same action repeated without effect.' };
      }
      session.history = [...session.history, envelope].slice(-STEP_BUDGET);
      app.log.info({ session_id, stepIndex, provider, attempts: attempts.length, action: envelope.action.type }, 'step planned');
      const body: StepResponse = { action_envelope: envelope, provider, latency_ms: Date.now() - started };
      return reply.send(body);
    } catch (e) {
      app.log.error({ session_id, err: e instanceof Error ? e.message : String(e) }, 'no provider produced an action');
      return reply.code(502).send({ error: 'PROVIDER_FAILED', message: e instanceof Error ? e.message : String(e) });
    }
  });
}
