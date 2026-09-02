// Anthropic Claude via tool-use for a schema-constrained action. A fallback in the
// chain: the PS prefers open-weights models, but the demo must not fail if the
// primary endpoint is down.
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-sonnet-4-5)
import Anthropic from '@anthropic-ai/sdk';
import type { PlanInput, Provider } from './types';
import { assemblePrompt, SYSTEM_PROMPT, ACTION_ENVELOPE_JSON_SCHEMA } from '../prompt/assemble';

export function createAnthropicProvider(env: NodeJS.ProcessEnv = process.env): Provider | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5';
  const client = new Anthropic({ apiKey, timeout: Number(env.GLASSWALL_LLM_TIMEOUT_MS ?? 60_000) });
  return {
    name: `anthropic:${model}`,
    vision: true,
    async available() {
      return { ok: true, detail: `${model} (key set; verified on first call)` };
    },
    async plan(input: PlanInput) {
      const text = assemblePrompt(input);
      const content: Anthropic.MessageParam['content'] = input.screenshot
        ? [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.screenshot.data_base64 } }]
        : text;
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [{ name: 'emit_action', description: 'Emit the next browser action as an ActionEnvelope', input_schema: ACTION_ENVELOPE_JSON_SCHEMA as Anthropic.Tool['input_schema'] }],
        tool_choice: { type: 'tool', name: 'emit_action' },
        messages: [{ role: 'user', content }],
      });
      const toolUse = response.content.find(c => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') throw new Error('model did not call emit_action');
      return toolUse.input;
    },
  };
}
