// Single source for deployment constants. manifest.json must agree with these;
// config.test.ts asserts it.
export const GATEWAY_ORIGIN = 'http://localhost:3000';
export const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
export const DEFAULT_STEP_BUDGET = 20;
export const DEFAULT_TIME_BUDGET_MS = 5 * 60 * 1000;
