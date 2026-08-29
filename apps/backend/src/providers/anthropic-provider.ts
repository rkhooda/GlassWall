// Anthropic Provider - real LLM provider using tool-use for constrained output
// Falls back to scripted provider if API key not configured or on error

import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { Action, ActionEnvelope } from '@glasswall/schema/action';
import { Provider, ProviderResult } from './index';
import { assemblePrompt, ACTION_ENVELOPE_JSON_SCHEMA } from '../prompt/assemble';
import { scriptedProvider } from './scripted-provider';
import Anthropic from '@anthropic-ai/sdk';

interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  private client: Anthropic | null = null;
  private config: AnthropicConfig | null = null;
  private scriptedFallback = scriptedProvider;

  constructor() {
    this.init();
  }

  private init(): void {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[AnthropicProvider] ANTHROPIC_API_KEY not set, will use scripted fallback');
      return;
    }

    this.config = {
      apiKey,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
      maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096', 10),
    };

    this.client = new Anthropic({ apiKey: this.config.apiKey });
  }

  async plan(
    observation: SanitizedObservation,
    history: ActionEnvelope[],
    task: string
  ): Promise<ProviderResult> {
    // If no client configured, use scripted fallback
    if (!this.client || !this.config) {
      return this.scriptedFallback.plan(observation, history, task);
    }

    const prompt = assemblePrompt(task, observation, history, { name: 'STRICT' } as any);

    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: 0.0, // Deterministic for reliability
        system: 'You are a browser automation agent. Emit exactly one ActionEnvelope JSON object.',
        tools: [
          {
            name: 'emit_action',
            description: 'Emit the next browser action as an ActionEnvelope',
            input_schema: ACTION_ENVELOPE_JSON_SCHEMA as any,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_action' },
        messages: [
          { role: 'user', content: prompt },
        ],
      });

      // Extract tool use result
      const toolUse = response.content.find(c => c.type === 'tool_use');
      if (!toolUse || toolUse.name !== 'emit_action') {
        throw new Error('Model did not call emit_action tool');
      }

      const result = toolUse.input as any;

      return {
        action: result.action,
        observation_id: result.observation_id,
        step_index: result.step_index,
        session_id: result.session_id,
        risk: result.risk,
        requires_confirmation: result.requires_confirmation,
        reasoning: result.reasoning,
      } satisfies ProviderResult;

    } catch (error) {
      console.error('[AnthropicProvider] Error, falling back to scripted:', error);
      return this.scriptedFallback.plan(observation, history, task);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client || !this.config) {
      return false;
    }
    try {
      // Quick health check - just verify client can be created
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const anthropicProvider = new AnthropicProvider();