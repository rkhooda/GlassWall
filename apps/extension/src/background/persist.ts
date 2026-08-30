// Session recovery after service worker restart — persist step state to
// chrome.storage.session after EVERY SINGLE STEP
// PLAN.md §21 F17, PHASE 14

import type { SessionState } from './orchestrator';
import type { RawObservation } from '@glasswall/schema/observation';

const SESSION_KEY = 'glasswall:session';
const OBSERVATION_HISTORY_KEY = 'glasswall:observation-history';
const MAX_HISTORY_LENGTH = 10;

export interface PersistedSession {
  sessionId: string;
  task: string;
  policy: SessionState['policy'];
  siteAllowlist: string[];
  budget: SessionState['budget'];
  stepIndex: number;
  consecutiveFailures: number;
  aborted: boolean;
  sanitizedMemory: SessionState['sanitizedMemory'];
  persistedAt: number;
}

export interface PersistedObservation {
  observation: RawObservation;
  stepIndex: number;
  timestamp: number;
}

export async function persistSession(session: SessionState): Promise<void> {
  const toPersist: PersistedSession = {
    sessionId: session.sessionId,
    task: session.task,
    policy: session.policy,
    siteAllowlist: session.siteAllowlist,
    budget: session.budget,
    stepIndex: session.stepIndex,
    consecutiveFailures: session.consecutiveFailures,
    aborted: session.aborted,
    sanitizedMemory: session.sanitizedMemory,
    persistedAt: Date.now(),
  };

  await chrome.storage.session.set({ [SESSION_KEY]: toPersist });
}

export async function persistObservation(observation: RawObservation, stepIndex: number): Promise<void> {
  const data = await chrome.storage.session.get(OBSERVATION_HISTORY_KEY);
  const history: PersistedObservation[] = data[OBSERVATION_HISTORY_KEY] || [];

  history.push({
    observation,
    stepIndex,
    timestamp: Date.now(),
  });

  if (history.length > MAX_HISTORY_LENGTH) {
    history.shift();
  }

  await chrome.storage.session.set({ [OBSERVATION_HISTORY_KEY]: history });
}

export async function restoreSession(): Promise<PersistedSession | null> {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return data[SESSION_KEY] || null;
}

export async function restoreObservationHistory(): Promise<PersistedObservation[]> {
  const data = await chrome.storage.session.get(OBSERVATION_HISTORY_KEY);
  return data[OBSERVATION_HISTORY_KEY] || [];
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove([SESSION_KEY, OBSERVATION_HISTORY_KEY]);
}

export async function getLastObservation(): Promise<RawObservation | null> {
  const history = await restoreObservationHistory();
  if (history.length === 0) return null;
  return history[history.length - 1]!.observation;
}

import { createChromeSessionVaultStore } from '@glasswall/privacy';

export function createSessionStateFromPersisted(persisted: PersistedSession): SessionState {
  const vaultStore = createChromeSessionVaultStore();
  // Note: vaultStore.init() should be called by the caller if needed
  
  return {
    sessionId: persisted.sessionId,
    task: persisted.task,
    policy: persisted.policy,
    siteAllowlist: persisted.siteAllowlist,
    budget: persisted.budget,
    stepIndex: persisted.stepIndex,
    consecutiveFailures: persisted.consecutiveFailures,
    aborted: persisted.aborted,
    secretRegistry: new Map(), // Re-initialize on restore
    vaultStore,
    workingMemory: {
      observationHistory: [],
      domSnapshots: new Map(),
    },
    sanitizedMemory: persisted.sanitizedMemory,
  };
}

// Auto-persist wrapper — call after every step
export async function autoPersist(session: SessionState): Promise<void> {
  try {
    await persistSession(session);
  } catch (error) {
    console.error('[Persist] Failed to persist session:', error);
  }
}

// Recovery check — called on SW startup
export async function checkAndRecover(): Promise<{ recovered: boolean; session?: SessionState; message: string }> {
  const persisted = await restoreSession();
  if (!persisted) {
    return { recovered: false, message: 'No persisted session found' };
  }

  // Check if session is recent (within last hour)
  const age = Date.now() - persisted.persistedAt;
  if (age > 60 * 60 * 1000) {
    await clearSession();
    return { recovered: false, message: 'Persisted session expired (>1h)' };
  }

  // Check if session was already complete or aborted
  if (persisted.aborted || persisted.budget.stepsLeft <= 0 || persisted.budget.msLeft <= 0) {
    await clearSession();
    return { recovered: false, message: 'Session was already complete/aborted' };
  }

  const session = createSessionStateFromPersisted(persisted);
  // Initialize the vault store
  await session.vaultStore.init();
  
  return {
    recovered: true,
    session,
    message: `Recovered session ${persisted.sessionId.slice(0, 8)} at step ${persisted.stepIndex}`,
  };
}