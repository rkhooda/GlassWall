// ErrorState.tsx — User-facing error taxonomy with actionable copy
// PLAN.md §21, PHASE 14
// PROJECTOR MODE: minimum 14px, high contrast, larger touch targets

import React from 'react';

export type ErrorCategory =
  | 'perception'
  | 'sanitization'
  | 'network'
  | 'execution'
  | 'validation'
  | 'privacy'
  | 'system'
  | 'user_abort';

export interface ErrorInfo {
  code: string;
  category: ErrorCategory;
  title: string;
  message: string;
  actionable: boolean;
  actions: ErrorAction[];
  recoverable: boolean;
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface ErrorAction {
  label: string;
  action: 'retry' | 'reobserve' | 'abort' | 'settings' | 'report' | 'dismiss';
  primary?: boolean;
}

const ERROR_TAXONOMY: Record<string, ErrorInfo> = {
  // Perception errors
  CAPTURE_FAILED: {
    code: 'CAPTURE_FAILED',
    category: 'perception',
    title: 'Screenshot Capture Failed',
    message: 'Could not capture the page. The page may be a chrome:// URL, or capture was throttled.',
    actionable: true,
    actions: [
      { label: 'Retry with DOM Only', action: 'retry', primary: true },
      { label: 'Open Permissions', action: 'settings' },
    ],
    recoverable: true,
    severity: 'warning',
  },
  CAPTURE_THROTTLED: {
    code: 'CAPTURE_THROTTLED',
    category: 'perception',
    title: 'Capture Throttled — Using Last Frame',
    message: 'Chrome limited screenshot frequency. Using previous frame (vision confidence reduced).',
    actionable: false,
    actions: [{ label: 'Continue', action: 'dismiss' }],
    recoverable: true,
    severity: 'info',
  },
  EXTRACTION_INCOMPLETE: {
    code: 'EXTRACTION_INCOMPLETE',
    category: 'perception',
    title: 'Page Extraction Incomplete',
    message: 'Some elements could not be read (cross-origin iframes, closed shadow DOM, tainted canvas). These regions are withheld.',
    actionable: false,
    actions: [{ label: 'Continue', action: 'dismiss' }],
    recoverable: true,
    severity: 'warning',
  },
  ELEMENT_NOT_FOUND: {
    code: 'ELEMENT_NOT_FOUND',
    category: 'perception',
    title: 'Target Element Not Found',
    message: 'The element the agent tried to interact with no longer exists in the DOM.',
    actionable: true,
    actions: [
      { label: 'Re-observe Page', action: 'reobserve', primary: true },
      { label: 'Abort Task', action: 'abort' },
    ],
    recoverable: true,
    severity: 'error',
  },
  STALE_OBSERVATION: {
    code: 'STALE_OBSERVATION',
    category: 'perception',
    title: 'Observation Out of Date',
    message: 'The page changed since the agent last observed it. The agent will re-read the page.',
    actionable: true,
    actions: [{ label: 'Re-observe', action: 'reobserve', primary: true }],
    recoverable: true,
    severity: 'warning',
  },

  // Sanitization errors
  SANITIZATION_TIMEOUT: {
    code: 'SANITIZATION_TIMEOUT',
    category: 'sanitization',
    title: 'Sanitization Timed Out',
    message: 'Local perception took too long. Some detectors were skipped; redaction is stricter.',
    actionable: true,
    actions: [
      { label: 'Continue (Degraded)', action: 'retry', primary: true },
      { label: 'Abort', action: 'abort' },
    ],
    recoverable: true,
    severity: 'warning',
  },
  VISION_DISABLED: {
    code: 'VISION_DISABLED',
    category: 'sanitization',
    title: 'Vision Detector Disabled',
    message: 'The visual sensitive-region detector failed repeatedly and is temporarily disabled. Stricter redaction active.',
    actionable: false,
    actions: [{ label: 'Continue', action: 'dismiss' }],
    recoverable: true,
    severity: 'warning',
  },
  OCR_FAILED: {
    code: 'OCR_FAILED',
    category: 'sanitization',
    title: 'OCR Failed on Image Regions',
    message: 'Could not read text from some image/canvas regions. Those regions are withheld.',
    actionable: false,
    actions: [{ label: 'Continue', action: 'dismiss' }],
    recoverable: true,
    severity: 'warning',
  },

  // Network errors
  NETWORK_UNAVAILABLE: {
    code: 'NETWORK_UNAVAILABLE',
    category: 'network',
    title: 'Network Unavailable — Using Local Planner',
    message: 'Cannot reach the reasoning backend. Switching to scripted planner (offline mode).',
    actionable: true,
    actions: [
      { label: 'Continue Offline', action: 'retry', primary: true },
      { label: 'Check Connection', action: 'settings' },
    ],
    recoverable: true,
    severity: 'warning',
  },
  BACKEND_ERROR: {
    code: 'BACKEND_ERROR',
    category: 'network',
    title: 'Reasoning Backend Error',
    message: 'The remote model returned an error. Retrying once, then falling back to local planner.',
    actionable: true,
    actions: [{ label: 'Retry', action: 'retry', primary: true }],
    recoverable: true,
    severity: 'error',
  },
  PROVIDER_RATE_LIMITED: {
    code: 'PROVIDER_RATE_LIMITED',
    category: 'network',
    title: 'Rate Limited — Switching Provider',
    message: 'The current model provider is rate limited. Attempting failover.',
    actionable: false,
    actions: [{ label: 'Wait', action: 'dismiss' }],
    recoverable: true,
    severity: 'warning',
  },

  // Execution errors
  EXECUTION_FAILED: {
    code: 'EXECUTION_FAILED',
    category: 'execution',
    title: 'Action Execution Failed',
    message: 'The browser could not perform the requested action. The element may be covered, disabled, or removed.',
    actionable: true,
    actions: [
      { label: 'Retry', action: 'retry', primary: true },
      { label: 'Re-observe', action: 'reobserve' },
      { label: 'Abort', action: 'abort' },
    ],
    recoverable: true,
    severity: 'error',
  },
  ELEMENT_NOT_ACTIONABLE: {
    code: 'ELEMENT_NOT_ACTIONABLE',
    category: 'execution',
    title: 'Element Not Interactable',
    message: 'The target element is not visible, enabled, or in the viewport.',
    actionable: true,
    actions: [
      { label: 'Scroll to Element', action: 'reobserve', primary: true },
      { label: 'Abort', action: 'abort' },
    ],
    recoverable: true,
    severity: 'error',
  },
  IDENTITY_MISMATCH: {
    code: 'IDENTITY_MISMATCH',
    category: 'execution',
    title: 'Element Identity Changed',
    message: 'The page re-rendered and the element\'s identity hash no longer matches. Re-observing.',
    actionable: true,
    actions: [{ label: 'Re-observe', action: 'reobserve', primary: true }],
    recoverable: true,
    severity: 'warning',
  },

  // Validation errors
  VAULT_TYPE_MISMATCH: {
    code: 'VAULT_TYPE_MISMATCH',
    category: 'validation',
    title: 'Blocked: Type Mismatch in Vault Binding',
    message: 'The agent attempted to place a sensitive value (e.g., email) into an incompatible field (e.g., search box). This is logged as a potential exfiltration attempt.',
    actionable: false,
    actions: [{ label: 'View Audit Log', action: 'report' }],
    recoverable: false,
    severity: 'critical',
  },
  LITERAL_CONTAINS_SECRET: {
    code: 'LITERAL_CONTAINS_SECRET',
    category: 'validation',
    title: 'Blocked: Literal Contains Secret',
    message: 'The agent attempted to send a raw sensitive value. Only vault handles are permitted.',
    actionable: false,
    actions: [{ label: 'View Audit Log', action: 'report' }],
    recoverable: false,
    severity: 'critical',
  },
  EGRESS_GATE_VIOLATION: {
    code: 'EGRESS_GATE_VIOLATION',
    category: 'privacy',
    title: 'Egress Gate Blocked Outbound Data',
    message: 'A privacy check failed on the outbound payload. The step was aborted to prevent leakage.',
    actionable: false,
    actions: [{ label: 'View Audit Log', action: 'report' }],
    recoverable: false,
    severity: 'critical',
  },
  UNKNOWN_TARGET: {
    code: 'UNKNOWN_TARGET',
    category: 'validation',
    title: 'Unknown Target Element',
    message: 'The agent referenced an element not present in the current observation.',
    actionable: true,
    actions: [{ label: 'Re-observe', action: 'reobserve', primary: true }],
    recoverable: true,
    severity: 'error',
  },
  UNSUPPORTED_ACTION: {
    code: 'UNSUPPORTED_ACTION',
    category: 'validation',
    title: 'Unsupported Action for Element',
    message: 'The agent requested an action this element does not support (e.g., typing into a button).',
    actionable: true,
    actions: [{ label: 'Re-observe', action: 'reobserve', primary: true }],
    recoverable: true,
    severity: 'error',
  },
  ORIGIN_NOT_ALLOWED: {
    code: 'ORIGIN_NOT_ALLOWED',
    category: 'validation',
    title: 'Navigation Blocked — Origin Not Allowed',
    message: 'The agent tried to navigate outside the allowed site list.',
    actionable: false,
    actions: [{ label: 'Abort', action: 'abort' }],
    recoverable: false,
    severity: 'critical',
  },

  // System errors
  BUDGET_EXHAUSTED: {
    code: 'BUDGET_EXHAUSTED',
    category: 'system',
    title: 'Step/Time Budget Exhausted',
    message: 'The task exceeded its step or time limit.',
    actionable: false,
    actions: [{ label: 'View Progress', action: 'dismiss' }],
    recoverable: false,
    severity: 'info',
  },
  CONSECUTIVE_FAILURES: {
    code: 'CONSECUTIVE_FAILURES',
    category: 'system',
    title: 'Too Many Consecutive Failures',
    message: 'The agent failed 3 steps in a row. The task has been aborted.',
    actionable: true,
    actions: [{ label: 'Restart Task', action: 'retry' }],
    recoverable: false,
    severity: 'error',
  },
  SERVICE_WORKER_RESTARTED: {
    code: 'SERVICE_WORKER_RESTARTED',
    category: 'system',
    title: 'Extension Restarted — Session Recovered',
    message: 'The background service worker was restarted by Chrome. Your session was automatically restored.',
    actionable: false,
    actions: [{ label: 'Continue', action: 'dismiss' }],
    recoverable: true,
    severity: 'info',
  },

  // User abort
  USER_ABORTED: {
    code: 'USER_ABORTED',
    category: 'user_abort',
    title: 'Task Aborted by User',
    message: 'You stopped the task.',
    actionable: true,
    actions: [{ label: 'Start New Task', action: 'retry' }],
    recoverable: true,
    severity: 'info',
  },
};

export function getErrorInfo(code: string): ErrorInfo {
  return ERROR_TAXONOMY[code] || {
    code,
    category: 'system',
    title: 'Unknown Error',
    message: `An unexpected error occurred: ${code}`,
    actionable: true,
    actions: [{ label: 'Retry', action: 'retry' }, { label: 'Abort', action: 'abort' }],
    recoverable: true,
    severity: 'error',
  };
}

export function getErrorsByCategory(category: ErrorCategory): ErrorInfo[] {
  return Object.values(ERROR_TAXONOMY).filter((e) => e.category === category);
}

export function ErrorBanner({ errorCode, onAction }: { errorCode: string; onAction: (action: ErrorAction) => void }) {
  const error = getErrorInfo(errorCode);
  const severityColors = {
    info: 'bg-blue-50 border-2 border-blue-300 text-blue-900',
    warning: 'bg-amber-50 border-2 border-amber-300 text-amber-900',
    error: 'bg-red-50 border-2 border-red-300 text-red-900',
    critical: 'bg-red-100 border-2 border-red-400 text-red-900 animate-pulse',
  };

  return (
    <div className={`error-banner p-4 rounded-lg border animate-slide-down ${severityColors[error.severity]}`}>
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">
          {error.severity === 'critical' && <span className="text-2xl">🛑</span>}
          {error.severity === 'error' && <span className="text-2xl">❌</span>}
          {error.severity === 'warning' && <span className="text-2xl">⚠️</span>}
          {error.severity === 'info' && <span className="text-2xl">ℹ️</span>}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-lg">{error.title}</h4>
          <p className="text-base mt-1">{error.message}</p>
          {error.actionable && error.actions.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-4">
              {error.actions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => onAction(action)}
                  className={`px-4 py-2 text-base font-medium rounded-lg transition-colors ${
                    action.primary
                      ? 'bg-gray-900 text-white hover:bg-gray-700'
                      : 'bg-white border-2 border-gray-300 text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ErrorToast({ errorCode, onDismiss }: { errorCode: string; onDismiss: () => void }) {
  const error = getErrorInfo(errorCode);
  const severityColors = {
    info: 'bg-blue-600',
    warning: 'bg-amber-600',
    error: 'bg-red-600',
    critical: 'bg-red-700',
  };

  return (
    <div className={`error-toast fixed bottom-4 right-4 z-50 px-5 py-4 rounded-lg shadow-lg text-white max-w-md animate-slide-in-right ${severityColors[error.severity]}`}>
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <p className="font-semibold text-lg">{error.title}</p>
          <p className="text-base opacity-90 mt-1">{error.message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-white opacity-70 hover:opacity-100 text-2xl leading-none"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// CSS animations (add to global CSS or use styled-components)
// @keyframes slide-down { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
// @keyframes slide-in-right { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }