// Executor types - shared types for action execution

import type { Action, ActionResult, Target, Value } from '@glasswall/schema/action';
import type { SanitizedObservation } from '@glasswall/schema/observation';

export interface ExecutionContext {
  observation: SanitizedObservation;
  viewport: { w: number; h: number; dpr: number; scrollX: number; scrollY: number };
  vault: Map<string, string>; // handle -> real value
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Re-export for convenience
export type { Action, ActionResult, Target, Value, SanitizedObservation };
export type { SanitizedElement } from '@glasswall/schema/observation';