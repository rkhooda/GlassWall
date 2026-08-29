// Scripted Provider Implementation - deterministic finite-state planner
// Zero network, used for CI and demo-day insurance

import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { Action, ActionEnvelope } from '@glasswall/schema/action';
import { Provider, ProviderResult } from './index';
import { getScriptedPlanner, buildScriptedAction, type TaskScript } from './scripted';

export class ScriptedProvider implements Provider {
  name = 'scripted';
  private script: TaskScript | null = null;
  private task: string = '';

  async plan(
    observation: SanitizedObservation,
    history: ActionEnvelope[],
    task: string
  ): Promise<ProviderResult> {
    // Initialize script on first call
    if (!this.script || this.task !== task) {
      this.task = task;
      this.script = getScriptedPlanner(task);
    }

    const stepIndex = history.length;
    const result = buildScriptedAction(this.script, stepIndex, observation, history);

    if (!result) {
      // Script exhausted - return DONE
      return {
        action: { type: 'DONE', outcome: 'impossible' as const },
        observation_id: observation.observation_id,
        step_index: stepIndex,
        session_id: observation.session_id,
        risk: 'low',
        requires_confirmation: false,
        reasoning: 'Scripted planner: all steps executed',
      } satisfies ProviderResult;
    }

    // Check done condition
    if (this.script.doneCondition && this.script.doneCondition(observation)) {
      return {
        action: { type: 'DONE', outcome: 'success' as const },
        observation_id: observation.observation_id,
        step_index: stepIndex,
        session_id: observation.session_id,
        risk: 'low',
        requires_confirmation: false,
        reasoning: `Scripted planner: ${this.script.name} done condition met`,
      } satisfies ProviderResult;
    }

    return {
      action: result.action,
      observation_id: observation.observation_id,
      step_index: stepIndex,
      session_id: observation.session_id,
      risk: result.risk,
      requires_confirmation: result.requiresConfirmation,
      reasoning: `Scripted planner (${this.script.name}): ${result.rationale}`,
    } satisfies ProviderResult;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// Export singleton instance
export const scriptedProvider = new ScriptedProvider();