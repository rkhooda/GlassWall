// Trace.tsx - Live trace UI per PLAN.md §13.1, §11.4, §17 PHASE 5
// Shows per-step: observation summary, action, result, latency breakdown (local vs network),
// degraded sources, redactions count. Designed for judge at 3 meters.

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
  ok: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  error: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
};

const ACTION_COLORS: Record<string, string> = {
  CLICK: 'bg-blue-100 text-blue-800',
  TYPE: 'bg-purple-100 text-purple-800',
  SCROLL: 'bg-gray-100 text-gray-800',
  SELECT: 'bg-orange-100 text-orange-800',
  PRESS_KEY: 'bg-teal-100 text-teal-800',
  NAVIGATE: 'bg-indigo-100 text-indigo-800',
  WAIT: 'bg-slate-100 text-slate-800',
  BACK: 'bg-slate-100 text-slate-800',
  DONE: 'bg-emerald-100 text-emerald-800',
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
    <div className="latency-breakdown p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-medium text-gray-900">Latency Breakdown</span>
        <span className="font-mono text-gray-700">Total: {formatTime(total)}</span>
      </div>
      
      {/* Visual bar */}
      <div className="h-3 bg-gray-200 rounded-full overflow-hidden mb-2">
        <div className="h-full bg-blue-500" style={{ width: `${localPct}%` }} title="Local Perception" />
        <div className="h-full bg-purple-500" style={{ width: `${networkPct}%` }} title="Network" />
        <div className="h-full bg-green-500" style={{ width: `${execPct}%` }} title="Execution" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="p-2 bg-blue-50 rounded border border-blue-200">
          <div className="font-medium text-blue-800">Local Perception</div>
          <div className="font-mono text-blue-700">{formatTime(localPerception)} ({localPct}%)</div>
          <div className="text-xs text-blue-600 mt-1">
            Extract: {formatTime(timings.perception)} | Sanitize: {formatTime(timings.sanitize)} | Gate: {formatTime(timings.gate)}
          </div>
        </div>
        <div className="p-2 bg-purple-50 rounded border border-purple-200">
          <div className="font-medium text-purple-800">Network</div>
          <div className="font-mono text-purple-700">{formatTime(network)} ({networkPct}%)</div>
          <div className="text-xs text-purple-600 mt-1">Backend round-trip</div>
        </div>
        <div className="p-2 bg-green-50 rounded border border-green-200">
          <div className="font-medium text-green-800">Execution</div>
          <div className="font-mono text-green-700">{formatTime(execution)} ({execPct}%)</div>
          <div className="text-xs text-green-600 mt-1">
            Execute: {formatTime(timings.execute)} | Verify: {formatTime(timings.verify)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DegradedBadge({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  
  return (
    <div className="degraded-badge p-2 bg-amber-50 border border-amber-200 rounded-lg">
      <div className="flex items-center gap-1 text-xs text-amber-800 mb-1">
        <span className="font-medium">⚠ Degraded sources:</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {sources.map((src, i) => (
          <span key={i} className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded border border-amber-200 font-mono">
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
    <div className="redaction-badge p-2 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-center gap-1 text-xs text-red-800">
        <span className="font-medium">🔒 Redactions applied:</span>
        <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded border border-red-200">
          {count}
        </span>
      </div>
    </div>
  );
}

function TraceEntry({ entry }: { entry: TraceEntry }) {
  const actionType = entry.action?.type ?? 'UNKNOWN';
  const actionColor = ACTION_COLORS[actionType] ?? 'bg-gray-100 text-gray-800';
  const isError = !entry.result.ok;
  const statusColor = isError ? STATUS_COLORS.error : STATUS_COLORS.ok;

  const targetLabel = entry.action?.target 
    ? `e${entry.action.target.id.slice(-3)}` 
    : '—';

  const valueDisplay = entry.action?.value 
    ? entry.action.value.kind === 'vault_ref'
      ? `🔐 ${entry.action.value.handle}`
      : entry.action.value.kind === 'literal'
      ? `"${entry.action.value.text?.slice(0, 30)}${entry.action.value.text && entry.action.value.text.length > 30 ? '…' : ''}"`
      : entry.action.value.kind === 'user_input'
      ? `👤 ${entry.action.value.field_type}`
      : '—'
    : '—';

  return (
    <div className={`trace-entry ${statusColor.bg} border-l-4 ${statusColor.border} rounded-r-lg p-3 mb-3 transition-all hover:shadow-md`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${actionColor}`}>
          {actionType}
        </span>
        <span className="text-sm font-mono text-gray-600">Step {entry.step}</span>
        <span className="text-xs text-gray-400">{formatTimestamp(entry.timestamp)}</span>
        <span className="flex-1" />
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${isError ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'}`}>
          {entry.result.ok ? 'OK' : entry.result.error_code ?? 'FAIL'}
        </span>
      </div>

      {/* Action details */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <div className="p-1.5 bg-white/50 rounded">
          <div className="text-gray-500">Target</div>
          <div className="font-mono text-gray-900">{targetLabel}</div>
        </div>
        <div className="p-1.5 bg-white/50 rounded">
          <div className="text-gray-500">Value</div>
          <div className="font-mono text-gray-900 truncate">{valueDisplay}</div>
        </div>
        <div className="p-1.5 bg-white/50 rounded">
          <div className="text-gray-500">Effect</div>
          <div className="font-mono text-gray-900">{entry.verification?.effect ?? '—'}</div>
        </div>
        <div className="p-1.5 bg-white/50 rounded">
          <div className="text-gray-500">Verified</div>
          <div className="font-mono text-gray-900">{entry.verification?.verified ? '✓' : '✗'}</div>
        </div>
      </div>

      {/* Latency breakdown - THE KEY FEATURE */}
      <LatencyBreakdown timings={entry.timings} />

      {/* Degraded sources & Redactions */}
      <div className="flex flex-wrap gap-2 mt-2">
        <DegradedBadge sources={entry.degraded} />
        <RedactionBadge count={entry.redactions} />
      </div>

      {/* Error details */}
      {isError && entry.result.error_message && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
          <span className="font-medium">Error: </span>
          <span className="font-mono">{entry.result.error_message}</span>
        </div>
      )}
    </div>
  );
}

function SessionHeader({ session, task }: { session?: TraceProps['session']; task: string }) {
  if (!session) return null;

  return (
    <div className="session-header mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-medium text-gray-900 text-sm truncate max-w-[200px]">{task || 'No task'}</div>
          <div className="text-xs text-gray-500 font-mono">Session: {session.sessionId.slice(0, 8)}…</div>
        </div>
        <div className="text-right text-xs">
          <div className="font-medium text-gray-900">Step {session.stepIndex}</div>
          <div className="text-gray-500">{session.budget.stepsLeft} steps · {Math.round(session.budget.msLeft / 1000)}s left</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded border border-blue-200">
          Filled: {session.progress.fieldsFilled}
        </span>
        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded border border-amber-200">
          Remaining: {session.progress.fieldsRemaining}
        </span>
        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded border border-purple-200">
          Types: {session.progress.pageTypeSequence.slice(-3).join(' → ')}
        </span>
        {session.consecutiveFailures > 0 && (
          <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded border border-red-200 font-medium">
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
      <div className="trace-empty flex flex-col items-center justify-center h-full p-8 text-center text-gray-400">
        <div className="text-6xl mb-4">📋</div>
        <p className="text-lg font-medium text-gray-600">No trace data yet</p>
        <p className="text-sm mt-1">Start a task to see the step-by-step trace</p>
      </div>
    );
  }

  return (
    <div className="trace-container flex flex-col h-full">
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
          <div className="trace-entry animate-pulse bg-yellow-50 border-l-4 border-yellow-300 p-3">
            <div className="flex items-center gap-2 text-yellow-800">
              <span className="text-lg">⏳</span>
              <span>Waiting for next step…</span>
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
          className="scroll-to-bottom fixed bottom-4 right-4 z-10 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-full shadow-lg hover:bg-blue-700 transition-colors"
        >
          ↓ Live
        </button>
      )}

      {/* Controls */}
      <div className="trace-controls border-t border-gray-200 p-3 mt-auto">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={task}
            onChange={(e) => {}}
            placeholder="Enter task…"
            disabled={isRunning}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          <button
            onClick={onAbort}
            disabled={!isRunning}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Abort
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <span>Scroll: {autoScroll ? '🔴 Live' : '⚪ Paused'}</span>
          <span>{entries.length} step{entries.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}