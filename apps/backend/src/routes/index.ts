// Backend routes - Fastify handlers for /v1/session, /v1/step, /v1/health

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SanitizedObservationSchema } from '@glasswall/schema/observation';
import { ActionEnvelopeSchema, type ActionEnvelope, type Action } from '@glasswall/schema/action';
import { PolicyConfigSchema, PolicyProfileSchema, type PolicyConfig } from '@glasswall/schema/policy';
import { scriptedProvider } from '../providers/scripted-provider';
import { validateActionEnvelope, buildRepairPrompt } from '../guard';
import { assemblePrompt, ACTION_ENVELOPE_JSON_SCHEMA } from '../prompt';

// In-memory session store (stateless per step except short sanitized history)
interface Session {
  id: string;
  task: string;
  policy: PolicyConfig;
  siteAllowlist: string[];
  budget: { stepsLeft: number; msLeft: number };
  createdAt: number;
  history: ActionEnvelope[];
}

const sessions = new Map<string, Session>();

// Request/Response schemas
const CreateSessionSchema = z.object({
  task: z.string().min(1).max(5000),
  policy_profile: PolicyProfileSchema.default('STRICT'),
  site_allowlist: z.array(z.string().url()).default([]),
});

const StepRequestSchema = z.object({
  session_id: z.string().uuid(),
  observation: SanitizedObservationSchema,
  history: z.array(ActionEnvelopeSchema).max(5).default([]),
});

const StepResponseSchema = z.object({
  action_envelope: ActionEnvelopeSchema,
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Health check
  app.get('/v1/health', async () => ({ status: 'ok' }));

  // Create session
  app.post<{ Body: z.infer<typeof CreateSessionSchema> }>('/v1/session', async (request, reply) => {
    const parsed = CreateSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.errors });
    }

    const { task, policy_profile, site_allowlist } = parsed.data;
    const sessionId = crypto.randomUUID();
    
    // Get policy preset
    const policy = getPolicyPreset(policy_profile);
    
    // Initialize budget (configurable, default 20 steps / 5 min)
    const budget = { stepsLeft: 20, msLeft: 5 * 60 * 1000 };

    const session: Session = {
      id: sessionId,
      task,
      policy,
      siteAllowlist: site_allowlist,
      budget,
      createdAt: Date.now(),
      history: [],
    };

    sessions.set(sessionId, session);

    return reply.send({ session_id: sessionId, budget });
  });

  // Execute step
  app.post<{ Body: z.infer<typeof StepRequestSchema> }>('/v1/step', async (request, reply) => {
    const startTime = Date.now();
    
    const parsed = StepRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.errors });
    }

    const { session_id, observation, history } = parsed.data;
    
    const session = sessions.get(session_id);
    if (!session) {
      return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    }

    // Check budget
    if (session.budget.stepsLeft <= 0) {
      return reply.code(429).send({ error: 'BUDGET_EXHAUSTED', type: 'steps' });
    }
    if (session.budget.msLeft <= 0) {
      return reply.code(429).send({ error: 'BUDGET_EXHAUSTED', type: 'time' });
    }

    // Update budget
    session.budget.stepsLeft--;
    session.budget.msLeft -= Date.now() - startTime;

    // Use scripted provider (deterministic, no network)
    const provider = scriptedProvider;

    // Try planning with validation + one repair retry
    let attempt = 0;
    let lastError: string | null = null;
    let envelope: ActionEnvelope | null = null;

    while (attempt < 2) {
      attempt++;
      
      let prompt = assemblePrompt(session.task, observation, history, session.policy);
      
      // If this is a repair attempt, append the repair prompt
      if (attempt === 2 && lastError) {
        prompt = buildRepairPrompt(prompt, lastError);
      }

      const result = await provider.plan(observation, history, session.task);
      
      // Validate the result
      const validation = validateActionEnvelope(
        {
          action: result.action,
          observation_id: result.observation_id,
          step_index: result.step_index,
          session_id: result.session_id,
          risk: result.risk,
          requires_confirmation: result.requires_confirmation,
          reasoning: result.reasoning,
        },
        observation
      );

      if (validation.success && validation.envelope) {
        envelope = validation.envelope;
        break;
      }

      lastError = validation.error ?? 'Unknown validation error';
      
      if (attempt === 2 || validation.repairAttempted) {
        // No more retries or repair already attempted
        break;
      }
    }

    if (!envelope) {
      // Return AGENT_ERROR - orchestrator will handle recovery
      return reply.code(500).send({ 
        error: 'AGENT_ERROR', 
        message: lastError ?? 'Provider returned invalid action after repair attempt' 
      });
    }

    // Store in history (sanitized - last 5 only)
    session.history.push(envelope);
    if (session.history.length > 5) {
      session.history.shift();
    }

    return reply.send({ action_envelope: envelope });
  });

  // Helper to get policy preset
  function getPolicyPreset(profile: z.infer<typeof PolicyProfileSchema>): PolicyConfig {
    switch (profile) {
      case 'BALANCED':
        return {
          name: 'BALANCED',
          unexplained_prior: 0.4,
          screenshot: { enabled: true },
          thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
          tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'GENERALIZE', T4: 'ANNOTATE', T5: 'TOKENIZE' },
          url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
          text_block_max_chars: 400,
          fail_mode: 'CLOSED',
          high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
          require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
          max_elements: 400,
        };
      case 'PERMISSIVE':
        return {
          name: 'PERMISSIVE',
          unexplained_prior: 0.1,
          screenshot: { enabled: true },
          thresholds: { tokenize: 0.6, mask: 0.8, drop: 0.95 },
          tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'PASS', T4: 'ANNOTATE', T5: 'TOKENIZE' },
          url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
          text_block_max_chars: 400,
          fail_mode: 'CLOSED',
          high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
          require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
          max_elements: 400,
        };
      default: // STRICT
        return {
          name: 'STRICT',
          unexplained_prior: 0.8,
          screenshot: { enabled: false },
          thresholds: { tokenize: 0.35, mask: 0.5, drop: 0.8 },
          tiers: { T1: 'VAULT_ONLY', T2: 'TOKENIZE', T3: 'TOKENIZE', T4: 'ANNOTATE', T5: 'TOKENIZE' },
          url: { query: 'DROP', fragment: 'DROP', path: 'TEMPLATE' },
          text_block_max_chars: 400,
          fail_mode: 'CLOSED',
          high_risk_actions: ['SUBMIT_LIKE', 'NAVIGATE_EXTERNAL', 'PAYMENT', 'DELETE'],
          require_confirmation: ['PAYMENT', 'DELETE', 'NAVIGATE_EXTERNAL'],
          max_elements: 400,
        };
    }
  }
}