// Trace.tsx - Live trace UI per PLAN.md §13.1, §11.4, §17 PHASE 5
// Shows per-step: observation summary, action, result, latency breakdown (local vs network),
// degraded sources, redactions count. Designed for judge at 3 meters.
// PROJECTOR MODE: minimum 14px, high contrast, larger touch targets

import React, { useState, useEffect, useRef } from 'react';

export interface TraceEntry {
  step: number;
  action?: {
    type: string;
    target?: { id: string; id_hash: string };
    value?: { kind: 'literal' | 'vault_ref' | 'user_input'; text?: string; handle?: string; field_type?: string };
  };
  result: {
    ok: boolean;
    effect_observed: boolean;
    error_code?: string;
    error_message?: string;
  };
  verification?: { verified: boolean; effect: string };
  timings: {
    perception: number;
    sanitize: number;
    gate: number;
    network: number;
    execute: number;
    verify: number;
    total: number;
  };
  degraded: string[];
  redactions: number;
  timestamp: number;
}

interface TraceProps {
  entries: TraceEntry[];
  isRunning: boolean;
  onAbort: () => void;
  task: string;
  session?: {
    sessionId: string;
    stepIndex: number;
    budget: { stepsLeft: number; msLeft: number };
    consecutiveFailures: number;
    progress: { fieldsFilled: number; fieldsRemaining: number; pageTypeSequence: string[] };
  };
}

const STATUS_COLORS = {
  ok: { bg: 'bg-green-50', text: 'text-green-900', border: 'border-green-400' },
  error: { bg: 'bg-red-50', text: 'text-red-900', border: 'border-red-400' },
  pending: { bg: 'bg-yellow-50', text: 'text-yellow-900', border: 'border-yellow-400' },
};

const ACTION_COLORS: Record<string, string> = {
  CLICK: 'bg-blue-100 text-blue-900 border-blue-300',
  TYPE: 'bg-purple-100 text-purple-900 border-purple-300',
  SCROLL: 'bg-gray-100 text-gray-900 border-gray-300',
  SELECT: 'bg-orange-100 text-orange-900 border-orange-300',
  PRESS_KEY: 'bg-teal-100 text-teal-900 border-teal-300',
  NAVIGATE: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  WAIT: 'bg-slate-100 text-slate-900 border-slate-300',
  BACK: 'bg-slate-100 text-slate-900 border-slate-300',
  DONE: 'bg-emerald-100 text-emerald-900 border-emerald-300',
};

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function LatencyBreakdown({ timings }: { timings: TraceEntry['timings'] }) {
  const localPerception = timings.perception + timings.sanitize + timings.gate;
  const network = timings.network;
  const execution = timings.execute + timings.verify;
  
  const total = timings.total || (localPerception + network + execution);
  const localPct = total > 0 ? Math.round((localPerception / total) * 100) : 0;
  const networkPct = total > 0 ? Math.round((network / total) * 100) : 0;
  const execPct = total > 0 ? Math.round((execution / total) * 100) : 0;

  return (
    <div className="latency-breakdown p-4 bg-white rounded-lg border-2 border-gray-300">
      <div className="flex items-center justify-between text-base mb-3">
        <span className="font-semibold text-gray-900">Latency Breakdown</span>
        <span className="font-mono text-lg text-gray-900">Total: {formatTime(total)}</span>
      </div>
      
      {/* Visual bar */}
      <div className="h-4 bg-gray-200 rounded-full overflow-hidden mb-3 border border-gray-300">
        <div className="h-full bg-blue-600" style={{ width: `${localPct}%` }} title="Local Perception" />
        <div className="h-full bg-purple-600" style={{ width: `${networkPct}%` }} title="Network" />
        <div className="h-full bg-green-600" style={{ width: `${execPct}%` }} title="Execution" />
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="font-semibold text-blue-900">Local Perception</div>
          <div className="font-mono text-lg text-blue-800">{formatTime(localPerception)} ({localPct}%)</div>
          <div className="text-sm text-blue-700 mt-1">
            Extract: {formatTime(timings.perception)} · Sanitize: {formatTime(timings.sanitize)} · Gate: {formatTime(timings.gate)}
          </div>
        </div>
        <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
          <div className="font-semibold text-purple-900">Network</div>
          <div className="font-mono text-lg text-purple-800">{formatTime(network)} ({networkPct}%)</div>
          <div className="text-sm text-purple-700 mt-1">Backend round-trip</div>
        </div>
        <div className="p-3 bg-green-50 rounded-lg border border-green-200">
          <div className="font-semibold text-green-900">Execution</div>
          <div className="font-mono text-lg text-green-800">{formatTime(execution)} ({execPct}%)</div>
          <div className="text-sm text-green-700 mt-1">
            Execute: {formatTime(timings.execute)} · Verify: {formatTime(timings.verify)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DegradedBadge({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  
  return (
    <div className="degraded-badge p-3 bg-amber-50 border-2 border-amber-300 rounded-lg">
      <div className="flex items-center gap-2 text-sm text-amber-900 mb-2">
        <span className="font-semibold">⚠ Degraded sources:</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((src, i) => (
          <span key={i} className="px-3 py-1 bg-amber-100 text-amber-800 text-sm rounded border border-amber-300 font-mono">
            {src}
          </span>
        ))}
      </div>
    </div>
  );
}

function RedactionBadge({ count }: { count: number }) {
  if (count === 0) return null;
  
  return (
    <div className="redaction-badge p-3 bg-red-50 border-2 border-red-300 rounded-lg">
      <div className="flex items-center gap-2 text-sm text-red-900">
        <span className="font-semibold">🔒 Redactions applied:</span>
        <span className="font-mono text-lg bg-red-100 px-3 py-1 rounded border border-red-300">
          {count}
        </span>
      </div>
    </div>
  );
}

function TraceEntry({ entry }: { entry: TraceEntry }) {
  const actionType = entry.action?.type ?? 'UNKNOWN';
  const actionColor = ACTION_COLORS[actionType] ?? 'bg-gray-100 text-gray-900 border-gray-300';
  const isError = !entry.result.ok;
  const statusColor = isError ? STATUS_COLORS.error : STATUS_COLORS.ok;

  const targetLabel = entry.action?.target 
    ? `e${entry.action.target.id.slice(-3)}` 
    : '—';

  const valueDisplay = entry.action?.value 
    ? entry.action.value.kind === 'vault_ref'
      ? `🔐 ${entry.action.value.handle}`
      : entry.action.value.kind === 'literal'
      ? `"${entry.action.value.text?.slice(0, 40)}${entry.action.value.text && entry.action.value.text.length > 40 ? '…' : ''}"`
      : entry.action.value.kind === 'user_input'
      ? `👤 ${entry.action.value.field_type}`
      : '—'
    : '—';

  return (
    <div className={`trace-entry ${statusColor.bg} border-l-8 ${statusColor.border} rounded-r-lg p-4 mb-4 transition-all hover:shadow-lg`}>
      {/* Header */}
      <div className="flex items-center gap-4 mb-3">
        <span className={`px-3 py-1 text-sm font-medium rounded border ${actionColor}`}>
          {actionType}
        </span>
        <span className="text-base font-mono text-gray-700">Step {entry.step}</span>
        <span className="text-sm text-gray-500">{formatTimestamp(entry.timestamp)}</span>
        <span className="flex-1" />
        <span className={`px-3 py-1 text-sm font-medium rounded ${isError ? 'bg-red-200 text-red-900 border-red-300' : 'bg-green-200 text-green-900 border-green-300'}`}>
          {entry.result.ok ? '✓ OK' : entry.result.error_code ?? '✗ FAIL'}
        </span>
      </div>

      {/* Action details */}
      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div className="p-2 bg-white/70 rounded-lg border border-gray-200">
          <div className="text-gray-600 text-sm">Target</div>
          <div className="font-mono text-base text-gray-900">{targetLabel}</div>
        </div>
        <div className="p-2 bg-white/70 rounded-lg border border-gray-200">
          <div className="text-gray-600 text-sm">Value</div>
          <div className="font-mono text-base text-gray-900 truncate">{valueDisplay}</div>
        </div>
        <div className="p-2 bg-white/70 rounded-lg border border-gray-200">
          <div className="text-gray-600 text-sm">Effect</div>
          <div className="font-mono text-base text-gray-900">{entry.verification?.effect ?? '—'}</div>
        </div>
        <div className="p-2 bg-white/70 rounded-lg border border-gray-200">
          <div className="text-gray-600 text-sm">Verified</div>
          <div className="font-mono text-base text-gray-900">{entry.verification?.verified ? '✓ Yes' : '✗ No'}</div>
        </div>
      </div>

      {/* Latency breakdown - THE KEY FEATURE */}
      <LatencyBreakdown timings={entry.timings} />

      {/* Degraded sources & Redactions */}
      <div className="flex flex-wrap gap-3 mt-3">
        <DegradedBadge sources={entry.degraded} />
        <RedactionBadge count={entry.redactions} />
      </div>

      {/* Error details */}
      {isError && entry.result.error_message && (
        <div className="mt-3 p-3 bg-red-50 border-2 border-red-300 rounded-lg text-sm text-red-900">
          <span className="font-semibold">Error: </span>
          <span className="font-mono">{entry.result.error_message}</span>
        </div>
      )}
    </div>
  );
}

function SessionHeader({ session, task }: { session?: TraceProps['session']; task: string }) {
  if (!session) return null;

  return (
    <div className="session-header mb-4 p-4 bg-gray-50 rounded-lg border-2 border-gray-300">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-base text-gray-900 truncate max-w-[250px]">{task || 'No task'}</div>
          <div className="text-sm text-gray-600 font-mono">Session: {session.sessionId.slice(0, 8)}…</div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold text-gray-900">Step {session.stepIndex}</div>
          <div className="text-gray-600">{session.budget.stepsLeft} steps · {Math.round(session.budget.msLeft / 1000)}s left</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="px-3 py-1 bg-blue-100 text-blue-900 rounded border border-blue-300 font-medium">
          Filled: {session.progress.fieldsFilled}
        </span>
        <span className="px-3 py-1 bg-amber-100 text-amber-900 rounded border border-amber-300 font-medium">
          Remaining: {session.progress.fieldsRemaining}
        </span>
        <span className="px-3 py-1 bg-purple-100 text-purple-900 rounded border border-purple-300 font-medium">
          Types: {session.progress.pageTypeSequence.slice(-3).join(' → ')}
        </span>
        {session.consecutiveFailures > 0 && (
          <span className="px-3 py-1 bg-red-100 text-red-900 rounded border border-red-300 font-semibold">
            ⚠ {session.consecutiveFailures} consecutive failures
          </span>
        )}
      </div>
    </div>
  );
}

export function Trace({ entries, isRunning, onAbort, task, session }: TraceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries.length, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // Disable auto-scroll if user scrolled up
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  if (entries.length === 0 && !isRunning) {
    return (
      <div className="trace-empty flex flex-col items-center justify-center h-full p-8 text-center text-gray-600">
        <div className="text-6xl mb-4">📋</div>
        <p className="text-xl font-medium text-gray-700">No trace data yet</p>
        <p className="text-base mt-2">Start a task to see the step-by-step trace</p>
      </div>
    );
  }

  return (
    <div className="trace-container flex flex-col h-full bg-white">
      {/* Session header */}
      <SessionHeader session={session} task={task} />

      {/* Trace entries */}
      <div 
        ref={containerRef}
        className="trace-list flex-1 overflow-y-auto pr-2"
        onScroll={handleScroll}
      >
        {entries.map((entry, i) => (
          <TraceEntry key={`${entry.timestamp}-${entry.step}-${i}`} entry={entry} />
        ))}
        {isRunning && (
          <div className="trace-entry animate-pulse bg-yellow-50 border-l-8 border-yellow-400 p-4">
            <div className="flex items-center gap-3 text-yellow-900">
              <span className="text-xl">⏳</span>
              <span className="text-base font-medium">Waiting for next step…</span>
            </div>
          </div>
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && entries.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
          }}
          className="scroll-to-bottom fixed bottom-4 right-4 z-10 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full shadow-lg hover:bg-blue-700 transition-colors"
        >
          ↓ Live
        </button>
      )}

      {/* Controls */}
      <div className="trace-controls border-t-2 border-gray-300 p-4 mt-auto bg-white">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={task}
            onChange={(e) => {}}
            placeholder="Enter task…"
            disabled={isRunning}
            className="flex-1 px-4 py-3 text-base border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
          />
          <button
            onClick={onAbort}
            disabled={!isRunning}
            className="px-6 py-3 text-base font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Abort
          </button>
        </div>
        <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
          <span>Scroll: {autoScroll ? '🔴 Live' : '⚪ Paused'}</span>
          <span>{entries.length} step{entries.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}