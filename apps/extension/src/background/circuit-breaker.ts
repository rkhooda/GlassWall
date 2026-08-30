// Circuit breakers per subsystem — 3 failures disables that source,
// marks its regions unexplained, continues, 60s cooldown before re-enable
// PLAN.md §21 F6, PHASE 14

export type SubsystemName =
  | 'vision'
  | 'ocr'
  | 'ner'
  | 'deterministic'
  | 'fusion'
  | 'policy'
  | 'egress'
  | 'vault'
  | 'executor';

export interface CircuitBreakerState {
  name: SubsystemName;
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  cooldownUntil: number;
  disabledRegions: string[];
}

const MAX_FAILURES = 3;
const COOLDOWN_MS = 60_000;
const HALF_OPEN_TEST_INTERVAL = 30_000;

const breakers = new Map<SubsystemName, CircuitBreakerState>();

export function getBreaker(name: SubsystemName): CircuitBreakerState {
  if (!breakers.has(name)) {
    breakers.set(name, {
      name,
      failures: 0,
      lastFailure: 0,
      state: 'closed',
      cooldownUntil: 0,
      disabledRegions: [],
    });
  }
  return breakers.get(name)!;
}

export function recordFailure(name: SubsystemName, regionId?: string): void {
  const breaker = getBreaker(name);
  const now = Date.now();

  if (breaker.state === 'open') {
    // Already open, just update timestamp
    breaker.lastFailure = now;
    return;
  }

  breaker.failures++;
  breaker.lastFailure = now;

  if (breaker.failures >= MAX_FAILURES) {
    tripBreaker(name, regionId);
  }
}

export function recordSuccess(name: SubsystemName): void {
  const breaker = getBreaker(name);

  if (breaker.state === 'half-open') {
    // Successful test in half-open → close the breaker
    breaker.state = 'closed';
    breaker.failures = 0;
    breaker.disabledRegions = [];
    console.log(`[CircuitBreaker] ${name}: recovered, closed`);
  } else if (breaker.state === 'closed') {
    // Reset failure count on success
    breaker.failures = Math.max(0, breaker.failures - 1);
  }
}

function tripBreaker(name: SubsystemName, regionId?: string): void {
  const breaker = getBreaker(name);
  breaker.state = 'open';
  breaker.cooldownUntil = Date.now() + COOLDOWN_MS;

  if (regionId) {
    breaker.disabledRegions.push(regionId);
  }

  console.warn(`[CircuitBreaker] ${name}: TRIPPED after ${breaker.failures} failures, cooldown ${COOLDOWN_MS}ms`);
  if (regionId) {
    console.warn(`[CircuitBreaker] ${name}: marking region ${regionId} as unexplained`);
  }
}

export function isAvailable(name: SubsystemName): boolean {
  const breaker = getBreaker(name);
  const now = Date.now();

  if (breaker.state === 'closed') {
    return true;
  }

  if (breaker.state === 'open') {
    if (now >= breaker.cooldownUntil) {
      // Transition to half-open for testing
      breaker.state = 'half-open';
      console.log(`[CircuitBreaker] ${name}: entering half-open (test mode)`);
      return true; // Allow one test request
    }
    return false;
  }

  // half-open - allow one request
  if (now - breaker.lastFailure >= HALF_OPEN_TEST_INTERVAL) {
    return true;
  }
  return false;
}

export function getDisabledRegions(name: SubsystemName): string[] {
  return getBreaker(name).disabledRegions;
}

export function getBreakerStatus(name: SubsystemName): CircuitBreakerState {
  return { ...getBreaker(name) };
}

export function getAllBreakerStatuses(): CircuitBreakerState[] {
  return Array.from(breakers.values()).map((b) => ({ ...b }));
}

export function forceTrip(name: SubsystemName, regionId?: string): void {
  const breaker = getBreaker(name);
  breaker.failures = MAX_FAILURES;
  tripBreaker(name, regionId);
}

export function forceReset(name: SubsystemName): void {
  const breaker = getBreaker(name);
  breaker.state = 'closed';
  breaker.failures = 0;
  breaker.cooldownUntil = 0;
  breaker.disabledRegions = [];
  console.log(`[CircuitBreaker] ${name}: force reset`);
}

export function getDegradedSubsystems(): SubsystemName[] {
  const degraded: SubsystemName[] = [];
  for (const [name, breaker] of breakers) {
    if (breaker.state !== 'closed') {
      degraded.push(name);
    }
  }
  return degraded;
}

// Subsystem-specific failure handlers
export function handleVisionFailure(regionId?: string): void {
  recordFailure('vision', regionId);
}

export function handleOcrFailure(regionId?: string): void {
  recordFailure('ocr', regionId);
}

export function handleNerFailure(regionId?: string): void {
  recordFailure('ner', regionId);
}

export function handleDeterministicFailure(regionId?: string): void {
  recordFailure('deterministic', regionId);
}

export function handleFusionFailure(regionId?: string): void {
  recordFailure('fusion', regionId);
}

export function handlePolicyFailure(regionId?: string): void {
  recordFailure('policy', regionId);
}

export function handleEgressFailure(regionId?: string): void {
  recordFailure('egress', regionId);
}

export function handleVaultFailure(regionId?: string): void {
  recordFailure('vault', regionId);
}

export function handleExecutorFailure(regionId?: string): void {
  recordFailure('executor', regionId);
}