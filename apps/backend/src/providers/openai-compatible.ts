// Any OpenAI-compatible chat endpoint: Ollama (open-weights, offline), vLLM, Groq,
// OpenRouter, Together. This is the PS's preferred shape — an offline-deployable
// open model, optionally cloud-hosted for the hackathon.
//
//   GLASSWALL_LLM_BASE_URL   default http://localhost:11434/v1 (Ollama)
//   GLASSWALL_LLM_MODEL      e.g. llama3.1:8b, qwen2.5:7b, llama-3.3-70b-versatile
//   GLASSWALL_LLM_API_KEY    optional
//   GLASSWALL_LLM_VISION     "1" if the model accepts images (qwen2.5-vl, llava, ...)
import type { PlanInput, Provider } from './types';
import { assemblePrompt, SYSTEM_PROMPT } from '../prompt/assemble';

interface ChatMessage {
  role: 'system' | 'user';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('model output contains no JSON object');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function createOpenAiCompatibleProvider(env: NodeJS.ProcessEnv = process.env): Provider | null {
  const model = env.GLASSWALL_LLM_MODEL;
  if (!model) return null;
  const baseUrl = (env.GLASSWALL_LLM_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '');
  const apiKey = env.GLASSWALL_LLM_API_KEY;
  const vision = env.GLASSWALL_LLM_VISION === '1';
  const timeoutMs = Number(env.GLASSWALL_LLM_TIMEOUT_MS ?? 60_000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  let cachedAvailability: { at: number; result: { ok: boolean; detail?: string } } | null = null;

  return {
    name: `openai-compatible:${model}`,
    vision,
    async available() {
      if (cachedAvailability && Date.now() - cachedAvailability.at < 30_000) return cachedAvailability.result;
      let result: { ok: boolean; detail?: string };
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(`${baseUrl}/models`, { headers, signal: controller.signal });
        clearTimeout(timer);
        result = res.ok ? { ok: true, detail: `${baseUrl} · ${model}` } : { ok: false, detail: `${baseUrl}/models → ${res.status}` };
      } catch (e) {
        result = { ok: false, detail: `${baseUrl} unreachable: ${e instanceof Error ? e.message : String(e)}` };
      }
      cachedAvailability = { at: Date.now(), result };
      return result;
    },
    async plan(input: PlanInput) {
      const userText = assemblePrompt(input);
      const content: ChatMessage['content'] =
        vision && input.screenshot
          ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: `data:${input.screenshot.mime};base64,${input.screenshot.data_base64}` } }]
          : userText;
      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 800, response_format: { type: 'json_object' } }),
        });
        if (!res.ok) throw new Error(`${baseUrl}/chat/completions → ${res.status} ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('empty completion');
        return extractJson(text);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export { extractJson };
