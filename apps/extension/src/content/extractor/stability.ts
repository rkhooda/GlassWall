// DOM stability checking for validation ladder (WAIT_STABLE)
// Implements PLAN.md section 12.4: Validation ladder

import { createRect, area, intersects, quantizeRect } from '@glasswall/perception';
import {
  computeAccessibleNameForElement,
  computeRoleForElement,
  getElementState,
  isElementHidden
} from './a11y';

// Import types from schema
import type { Rect } from '@glasswall/schema';

// Configuration for stability checking
const STABILITY_CHECK_INTERVAL = 50; // ms between stability checks
const STABILITY_TIMEOUT = 2000; // max time to wait for stability (ms)
const STABLE_DURATION_REQUIRED = 150; // ms of stable state required

interface StabilityResult {
  isStable: boolean;
  reason: string;
}

/**
 * Checks if the DOM has been stable for the required duration
 * Returns a promise that resolves when stability is achieved or timeout occurs
 */
export async function waitForStability(
  timeout: number = STABILITY_TIMEOUT,
  stableDurationRequired: number = STABLE_DURATION_REQUIRED
): Promise<StabilityResult> {
  return new Promise((resolve) => {
    let lastCheckTime = Date.now();
    let stableSince = 0;
    let timeoutId: NodeJS.Timeout | null = null;
    let mutationObserver: MutationObserver | null = null;

    // Track if we've seen any mutations recently
    let hasRecentMutation = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
    };

    const checkStability = () => {
      const now = Date.now();
      const timeSinceLastCheck = now - lastCheckTime;
      lastCheckTime = now;

      if (hasRecentMutation) {
        // Reset stable timer if we had a mutation
        stableSince = 0;
        hasRecentMutation = false;
      } else {
        // Accumulate stable time
        stableSince += timeSinceLastCheck;
      }

      // Check if we've been stable long enough
      if (stableSince >= stableDurationRequired) {
        cleanup();
        resolve({ isStable: true, reason: `DOM stable for ${stableSince}ms` });
        return;
      }

      // Check for timeout
      if (now - (stableSince > 0 ? now - stableSince : now) >= timeout) {
        cleanup();
        resolve({ isStable: false, reason: `Stability timeout after ${timeout}ms` });
        return;
      }

      // Schedule next check
      timeoutId = setTimeout(checkStability, STABILITY_CHECK_INTERVAL);
    };

    // Set up mutation observer to detect DOM changes
    mutationObserver = new MutationObserver((mutations) => {
      hasRecentMutation = true;
    });

    // Start observing mutations
    mutationObserver.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeOldValue: false,
      characterDataOldValue: false
    });

    // Initial check
    timeoutId = setTimeout(checkStability, STABILITY_CHECK_INTERVAL);
  });
}

/**
 * Detects SPA route changes by monitoring URL changes
 * Returns a promise that resolves when no route change detected for specified duration
 */
export async function waitForRouteStability(
  timeout: number = STABILITY_TIMEOUT,
  stableDurationRequired: number = STABLE_DURATION_REQUIRED
): Promise<StabilityResult> {
  return new Promise((resolve) => {
    let lastCheckTime = Date.now();
    let stableSince = 0;
    let timeoutId: NodeJS.Timeout | null = null;
    let lastUrl = window.location.href;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      window.removeEventListener('popstate', handleHistoryChange);
      window.removeEventListener('hashchange', handleHashChange);
    };

    const handleHistoryChange = () => {
      stableSince = 0;
      lastUrl = window.location.href;
    };

    const handleHashChange = () => {
      stableSince = 0;
      lastUrl = window.location.href;
    };

    const checkRouteStability = () => {
      const now = Date.now();
      const timeSinceLastCheck = now - lastCheckTime;
      lastCheckTime = now;

      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        // URL changed, reset stable timer
        stableSince = 0;
        lastUrl = currentUrl;
      } else {
        // URL stable, accumulate stable time
        stableSince += timeSinceLastCheck;
      }

      // Check if we've been stable long enough
      if (stableSince >= stableDurationRequired) {
        cleanup();
        resolve({ isStable: true, reason: `URL stable for ${stableSince}ms` });
        return;
      }

      // Check for timeout
      if (now - (stableSince > 0 ? now - stableSince : now) >= timeout) {
        cleanup();
        resolve({ isStable: false, reason: `Route stability timeout after ${timeout}ms` });
        return;
      }

      // Schedule next check
      timeoutId = setTimeout(checkRouteStability, STABILITY_CHECK_INTERVAL);
    };

    // Set up event listeners for route changes
    window.addEventListener('popstate', handleHistoryChange);
    window.addEventListener('hashchange', handleHashChange);

    // Initial check
    timeoutId = setTimeout(checkRouteStability, STABILITY_CHECK_INTERVAL);
  });
}

/**
 * Combined stability check that waits for both DOM and route stability
 */
export async function waitForFullStability(
  timeout: number = STABILITY_TIMEOUT,
  stableDurationRequired: number = STABLE_DURATION_REQUIRED
): Promise<{
  isStable: boolean;
  domStable: boolean;
  routeStable: boolean;
  reason: string;
}> {
  // Run both checks in parallel
  const [domResult, routeResult] = await Promise.all([
    waitForStability(timeout, stableDurationRequired),
    waitForRouteStability(timeout, stableDurationRequired)
  ]);

  return {
    isStable: domResult.isStable && routeResult.isStable,
    domStable: domResult.isStable,
    routeStable: routeResult.isStable,
    reason: `DOM: ${domResult.reason}; Route: ${routeResult.reason}`
  };
}

// Export constants for use in other modules
export { STABILITY_CHECK_INTERVAL, STABILITY_TIMEOUT, STABLE_DURATION_REQUIRED };