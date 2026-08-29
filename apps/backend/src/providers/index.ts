// Provider abstraction - supports scripted (deterministic) and real providers

import type { Action, ActionEnvelope } from '@glasswall/schema/action';
import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { ScriptedStep, TaskScript } from './scripted';

export interface Provider {
  name: string;
  plan(observation: SanitizedObservation, history: ActionEnvelope[], task: string): Promise<ProviderResult>;
  healthCheck?(): Promise<boolean>;
}

export interface ProviderResult {
  action: Action;
  observation_id: string;
  step_index: number;
  session_id: string;
  risk: 'low' | 'medium' | 'high';
  requires_confirmation: boolean;
  reasoning?: string;
}

export type { ScriptedStep, TaskScript } from './scripted';
export { scriptedProvider } from './scripted-provider';
export { anthropicProvider } from './anthropic-provider';