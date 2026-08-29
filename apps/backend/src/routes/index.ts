// Backend routes - Fastify handlers for /v1/session, /v1/step, /v1/health

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SanitizedObservationSchema } from '@glasswall/schema/observation';
import { ActionEnvelopeSchema, type ActionEnvelope, type Action } from '@glasswall/schema/action';
import { PolicyConfigSchema, PolicyProfileSchema, type PolicyConfig } from '@glasswall/schema/policy';
import { scriptedProvider, anthropicProvider, Provider } from '../providers';
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

// Progress object - computed locally, sent to model (cheap, high-yield reliability tactic)
interface Progress {
  fields_filled: number;
  fields_remaining: number;
  page_type_sequence: string[];
}

function computeProgress(observation: any, history: ActionEnvelope[], task: string): Progress {
  // Count filled vs empty input fields
  const inputElements = observation.elements.filter((e: any) => 
    e.tag === 'input' && 
    ['text', 'email', 'tel', 'password', 'search', 'url', 'number'].includes(e.type || '')
  );
  const fields_filled = inputElements.filter((e: any) => e.value_state === 'filled').length;
  const fields_remaining = inputElements.filter((e: any) => e.value_state === 'empty' || e.value_state === 'partial').length;
  
  // Track page type sequence from history
  const page_type_sequence = [...new Set(history.map(h => h.action.type))].slice(-5);
  
  return { fields_filled, fields_remaining, page_type_sequence };
}

// Repeat-action detector: same action 3x -> force SCROLL or abort
function detectLoop(history: ActionEnvelope[]): string | null {
  if (history.length < 3) return null;
  
  const last3 = history.slice(-3);
  const first = last3[0];
  if (!first) return null;
  const firstAction = JSON.stringify(first.action);
  
  if (last3.every(h => JSON.stringify(h.action) === firstAction)) {
    const targetId = 'target' in first.action && first.action.target ? first.action.target.id : 'no-target';
    return `${first.action.type}:${targetId}`;
  }
  return null;
}

function isSameAction(action1: Action, action2: string): boolean {
  const [type, targetId] = action2.split(':');
  if (action1.type !== type) return false;
  if ('target' in action1 && action1.target) {
    return action1.target.id === targetId;
  }
  return targetId === 'no-target';
}

// Success predicate for DONE - prevents early victory declaration
function checkSuccessPredicate(
  action: { type: 'DONE'; outcome: string; evidence_element?: string },
  observation: any,
  task: string
): { met: boolean; reason: string } {
  if (action.outcome !== 'success') {
    return { met: true, reason: 'Non-success outcome accepted' };
  }

  // For form-filling tasks: check if required fields are filled
  const lowerTask = task.toLowerCase();
  if (lowerTask.includes('fill') && lowerTask.includes('form')) {
    const requiredInputs = observation.elements.filter((e: any) => 
      e.tag === 'input' && 
      e.visible && 
      e.enabled &&
      ['text', 'email', 'tel', 'password'].includes(e.type || '')
    );
    const unfilled = requiredInputs.filter((e: any) => e.value_state === 'empty' || e.value_state === 'partial');
    if (unfilled.length > 0) {
      return { met: false, reason: `${unfilled.length} required fields still empty` };
    }
  }

  // For search/add-to-cart tasks: check if we're on cart/confirmation page
  if (lowerTask.includes('search') && lowerTask.includes('cart')) {
    const url = observation.page.url_template || '';
    if (!url.includes('/cart') && !url.includes('/checkout')) {
      return { met: false, reason: 'Not on cart or checkout page' };
    }
  }

  // For checkout tasks: check if on confirmation page
  if (lowerTask.includes('checkout') || lowerTask.includes('submit')) {
    const url = observation.page.url_template || '';
    if (!url.includes('/confirm') && !url.includes('/success') && !url.includes('/order')) {
      return { met: false, reason: 'Not on confirmation/success page' };
    }
  }

  // Generic: if evidence_element provided, verify it exists and is visible
  if (action.evidence_element) {
    const evidence = observation.elements.find((e: any) => e.id === action.evidence_element);
    if (!evidence || !evidence.visible) {
      return { met: false, reason: `Evidence element ${action.evidence_element} not found or not visible` };
    }
  }

  return { met: true, reason: 'Success predicate satisfied' };
}

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

    // Select provider: real LLM if configured, else scripted
    const useRealProvider = await anthropicProvider.healthCheck();
    const provider: Provider = useRealProvider ? anthropicProvider : scriptedProvider;

    // Compute progress object locally (cheap, high-yield reliability tactic)
    const progress = computeProgress(observation, history, session.task);
    
    // Repeat-action detector (same action 3x -> force SCROLL or abort)
    const loopAction = detectLoop(history);
    const forceAlternative = loopAction !== null;

    // Try planning with validation + one repair retry
    let attempt = 0;
    let lastError: string | null = null;
    let envelope: ActionEnvelope | null = null;

    while (attempt < 2) {
      attempt++;
      
      let prompt = assemblePrompt(session.task, observation, history, session.policy);
      
      // Add progress and loop info to prompt for model awareness
      if (progress.fields_remaining > 0) {
        prompt += `\n\nProgress: ${progress.fields_filled} fields filled, ${progress.fields_remaining} remaining. Page types: ${progress.page_type_sequence.join(' -> ')}`;
      }
      if (forceAlternative) {
        prompt += `\n\nLOOP DETECTED: "${loopAction}" repeated 3 times. You MUST choose a different action (e.g., SCROLL to find new elements) or DONE with outcome="impossible".`;
      }

      // If this is a repair attempt, append the repair prompt
      if (attempt === 2 && lastError) {
        prompt = buildRepairPrompt(prompt, lastError);
      }

      const result = await provider.plan(observation, history, session.task);
      
      // If loop detected and model still returns same action, force alternative
      if (forceAlternative && isSameAction(result.action, loopAction)) {
        lastError = `Loop detected: repeated action "${loopAction}" not allowed`;
        continue;
      }

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

    // Success predicate check for DONE action
    if (envelope.action.type === 'DONE') {
      const predicateMet = checkSuccessPredicate(envelope.action as { type: 'DONE'; outcome: 'success' | 'blocked' | 'impossible'; evidence_element?: string }, observation, session.task);
      if (!predicateMet.met) {
        // Override DONE -> continue with SCROLL or force alternative
        envelope = {
          ...envelope,
          action: { type: 'SCROLL', direction: 'down', amount: 1 },
          risk: 'low',
          requires_confirmation: false,
          reasoning: `Success predicate not met: ${predicateMet.reason}. Forcing SCROLL to continue.`,
        };
      }
    }

    // Store in history (sanitized - last 5 only)
    session.history.push(envelope);
    if (session.history.length > 5) {
      session.history.shift();
    }

    return reply.send({ action_envelope: envelope, progress });
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