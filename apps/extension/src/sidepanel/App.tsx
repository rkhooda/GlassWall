import { useState, useEffect } from 'react';

// Simple side panel UI for task input and trace display
const App: React.FC = () => {
  const [task, setTask] = useState('');
  const [trace, setTrace] = useState<Array<{step: number; message: string; timestamp: number}>>([]);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    // In a real implementation, we would:
    // 1. Listen to trace messages from the service worker via message bus
    // 2. Update trace state accordingly
    // For skeleton, we'll just simulate

    const interval = setInterval(() => {
      if (isRunning) {
        setTrace(prevTrace => [
          ...prevTrace,
          {
            step: prevTrace.length + 1,
            message: `Simulated step ${prevTrace.length + 1}`,
            timestamp: Date.now()
          }
        ]);

        // Auto-stop after 5 steps for demo
        if (trace.length >= 4) {
          setIsRunning(false);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (task.trim()) {
      setIsRunning(true);
      setTrace([]);
      // In real implementation, we would:
      // 1. Send task to service worker to start session
      // 2. Service worker would begin observation-reasoning-action loop
    }
  };

  const handleAbort = () => {
    setIsRunning(false);
    setTrace([]);
    // In real implementation, we would:
    // 1. Send abort signal to service worker
  };

  return (
    <div className="side-panel">
      <div className="panel-header">
        <h2>GLASSWALL Agent</h2>
      </div>

      <div className="panel-body">
        <form onSubmit={handleSubmit} className="task-form">
          <div className="form-group">
            <label htmlFor="task-input">Task:</label>
            <input
              type="text"
              id="task-input"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Enter your task here..."
              disabled={isRunning}
            />
          </div>
          <button type="submit" disabled={isRunning || !task.trim()}>
            {isRunning ? 'Running...' : 'Start Task'}
          </button>
          <button type="button" onClick={handleAbort} disabled={!isRunning}>
            Abort
          </button>
        </form>

        <div className="trace-section">
          <h3>Trace:</h3>
          {trace.length === 0 ? (
            <p className="trace-empty">No trace data yet</p>
          ) : (
            <div className="trace-list">
              {trace.map((entry) => (
                <div key={`${entry.timestamp}-${entry.step}`} className="trace-entry">
                  <span className="trace-step">Step {entry.step}:</span>
                  <span className="trace-message">{entry.message}</span>
                  <span className="trace-time">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="status-indicator">
          {isRunning ? (
            <span className="status running">● Running</span>
          ) : (
            <span className="status idle">○ Idle</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;