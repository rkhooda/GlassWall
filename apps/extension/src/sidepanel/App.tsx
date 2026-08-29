// App.tsx - Main side panel UI with task input, Trace, and Confirm

import { useState, useEffect, useRef } from 'react';
import { Confirm, type ConfirmationContext } from './Confirm';
import { Trace, type TraceEntry } from './Trace';

interface SessionInfo {
  sessionId: string;
  stepIndex: number;
  budget: { stepsLeft: number; msLeft: number };
  consecutiveFailures: number;
  progress: { fieldsFilled: number; fieldsRemaining: number; pageTypeSequence: string[] };
}

// Message types from orchestrator
interface TraceEntryMessage {
  type: 'extension:trace-entry';
  payload: TraceEntry;
}

interface TraceCompleteMessage {
  type: 'extension:trace-complete';
  payload: { sessionId: string };
}

interface SessionInfoMessage {
  type: 'extension:session-info';
  payload: SessionInfo;
}

type OrchestratorMessage = TraceEntryMessage | TraceCompleteMessage | SessionInfoMessage;

const App: React.FC = () => {
  const [task, setTask] = useState('');
  const [traceEntries, setTraceEntries] = useState<TraceEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [confirmationContext, setConfirmationContext] = useState<ConfirmationContext | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);

  // Listen for messages from background script (orchestrator)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as OrchestratorMessage;
      
      if (message.type === 'extension:trace-entry') {
        setTraceEntries(prev => [...prev, message.payload]);
      } else if (message.type === 'extension:trace-complete') {
        setIsRunning(false);
      } else if (message.type === 'extension:session-info') {
        setSessionInfo(message.payload);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Listen for confirmation requests (from background via postMessage)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'extension:confirmation-request') {
        setConfirmationContext({
          ...event.data.payload,
          onApprove: handleApprove,
          onDeny: handleDeny,
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleApprove = () => {
    if (confirmationContext) {
      window.postMessage({
        type: 'extension:confirmation-response',
        payload: { approved: true }
      }, '*');
      setConfirmationContext(null);
    }
  };

  const handleDeny = () => {
    if (confirmationContext) {
      window.postMessage({
        type: 'extension:confirmation-response',
        payload: { approved: false }
      }, '*');
      setConfirmationContext(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;

    setIsRunning(true);
    setTraceEntries([]);
    setSessionInfo(null);

    // Send task to background script to start the orchestrator
    try {
      await chrome.runtime.sendMessage({
        type: 'extension:start-task',
        payload: {
          task: task.trim(),
          policy_profile: 'STRICT',
          site_allowlist: [],
        },
      });
    } catch (error) {
      console.error('Failed to start task:', error);
      setIsRunning(false);
    }
  };

  const handleAbort = () => {
    // Send abort to background
    window.postMessage({ type: 'extension:abort' }, '*');
    setIsRunning(false);
  };

  return (
    <div className="side-panel flex flex-col h-full bg-white">
      <div className="panel-header px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span className="text-xl">🛡️</span>
          GLASSWALL Agent
        </h2>
      </div>

      <div className="panel-body flex-1 overflow-hidden flex flex-col">
        {/* Task Form */}
        <form onSubmit={handleSubmit} className="task-form p-4 border-b border-gray-100 bg-white flex-shrink-0">
          <div className="mb-3">
            <label htmlFor="task-input" className="block text-sm font-medium text-gray-700 mb-1">
              Task
            </label>
            <input
              type="text"
              id="task-input"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g., Fill the shipping form and submit"
              disabled={isRunning}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isRunning || !task.trim()}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? 'Running…' : 'Start Task'}
            </button>
            <button
              type="button"
              onClick={handleAbort}
              disabled={!isRunning}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Abort
            </button>
          </div>
        </form>

        {/* Trace */}
        <Trace
          entries={traceEntries}
          isRunning={isRunning}
          onAbort={handleAbort}
          task={task}
          session={sessionInfo ?? undefined}
        />

        {/* Confirmation Modal */}
        <Confirm context={confirmationContext} />
      </div>
    </div>
  );
};

export default App;