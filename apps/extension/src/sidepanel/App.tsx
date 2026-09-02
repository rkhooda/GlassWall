// Side panel: task input, run state, step trace, and the privacy inspector.
import { useEffect, useState, type FormEvent } from 'react';
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { WorkerToPanel, RunState, TraceEntry, InspectPayload, ConfirmContext, PanelToWorker } from '../shared/messages';
import { Inspector } from './privacy';
import './styles.css';

const IDLE: RunState = { status: 'idle', sessionId: null, task: '', policy: 'STRICT', step: 0, stepsLeft: 0, provider: null };

function send(message: PanelToWorker): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

export default function App() {
  const [task, setTask] = useState('Fill the shipping form with my saved details and place the order');
  const [policy, setPolicy] = useState<PolicyProfile>('STRICT');
  const [state, setState] = useState<RunState>(IDLE);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [inspect, setInspect] = useState<InspectPayload | null>(null);
  const [confirm, setConfirm] = useState<ConfirmContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'run' | 'privacy'>('run');

  useEffect(() => {
    const listener = (message: unknown) => {
      const m = message as WorkerToPanel;
      if (typeof m !== 'object' || m === null || !('type' in m)) return;
      switch (m.type) {
        case 'gw:state': setState(m.state); if (m.state.status === 'running' && m.state.step === 0) { setTrace([]); setError(null); } break;
        case 'gw:trace': setTrace(prev => [...prev, m.entry]); break;
        case 'gw:inspect': setInspect(m.inspect); break;
        case 'gw:confirm-request': setConfirm(m.context); break;
        case 'gw:error': setError(m.message); break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    void send({ type: 'gw:get-state' }).then(s => { if (s) setState(s as RunState); });
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const running = state.status === 'running' || state.status === 'waiting_confirmation';

  const onStart = async (e: FormEvent) => {
    e.preventDefault();
    if (!task.trim() || running) return;
    setError(null);
    setTrace([]);
    setInspect(null);
    const reply = (await send({ type: 'gw:start', task: task.trim(), policy })) as { ok: boolean; error?: string } | undefined;
    if (reply && !reply.ok) setError(reply.error ?? 'Could not start');
  };

  const answer = (approved: boolean) => {
    setConfirm(null);
    void send({ type: 'gw:confirm-response', approved });
  };

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>GLASSWALL</h1>
        <span className={`status status-${state.status}`}>{state.status.replace('_', ' ')}</span>
      </header>

      <form className="task" onSubmit={onStart}>
        <label htmlFor="task">Task</label>
        <textarea id="task" rows={2} value={task} onChange={e => setTask(e.target.value)} disabled={running} />
        <div className="task-controls">
          <label>
            Policy
            <select value={policy} onChange={e => setPolicy(e.target.value as PolicyProfile)} disabled={running}>
              <option value="STRICT">STRICT (no pixels leave)</option>
              <option value="BALANCED">BALANCED (redacted screenshot)</option>
            </select>
          </label>
          {running ? (
            <button type="button" className="danger" onClick={() => void send({ type: 'gw:abort' })}>Abort</button>
          ) : (
            <button type="submit" className="primary" disabled={!task.trim()}>Start</button>
          )}
        </div>
      </form>

      {error && <div className="banner error" role="alert">{error}</div>}
      {state.message && !error && <div className="banner info">{state.message}</div>}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'run'} onClick={() => setTab('run')}>Run</button>
        <button role="tab" aria-selected={tab === 'privacy'} onClick={() => setTab('privacy')}>Privacy</button>
      </nav>

      {tab === 'run' && (
        <section className="trace" aria-label="Step trace">
          {trace.length === 0 && <p className="muted">No steps yet.</p>}
          {trace.map(entry => (
            <article key={`${entry.step}-${entry.at}`} className={`step step-${entry.phase}`}>
              <header>
                <strong>Step {entry.step}</strong>
                <span>{entry.action ? entry.action.type : entry.phase}{entry.action?.type === 'TYPE' && entry.action.value.kind === 'vault_ref' ? ` ← ${entry.action.value.handle}` : ''}{entry.action?.type === 'DONE' ? ` (${entry.action.outcome})` : ''}</span>
                <span className="muted">{entry.timings.total} ms</span>
              </header>
              <dl>
                {entry.targetLabel && <><dt>Target</dt><dd>{entry.targetLabel}</dd></>}
                {entry.provider && <><dt>Planner</dt><dd>{entry.provider}</dd></>}
                <dt>Observed</dt><dd>{entry.observedElements} elements</dd>
                <dt>Redactions</dt><dd>{entry.redactions}</dd>
                {entry.degraded.length > 0 && <><dt>Degraded</dt><dd>{entry.degraded.join(', ')}</dd></>}
                <dt>Timing</dt>
                <dd>{Object.entries(entry.timings).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${v}ms`).join(' · ')}</dd>
                {entry.errorCode && <><dt>Error</dt><dd>{entry.errorCode}{entry.errorMessage ? ` — ${entry.errorMessage}` : ''}</dd></>}
              </dl>
            </article>
          ))}
        </section>
      )}

      {tab === 'privacy' && (
        <section className="privacy" aria-label="Privacy inspector">
          <Inspector raw={inspect?.raw ?? null} payload={inspect?.payload ?? null} redactions={inspect?.redactions ?? []} degraded={inspect?.degraded ?? []} />
        </section>
      )}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Confirm {confirm.actionType}</h2>
            <p><strong>{confirm.targetLabel}</strong></p>
            <p className="muted">{confirm.reason}</p>
            {confirm.vaultRef && <p>Value: <code>{confirm.vaultRef}</code> (resolved locally)</p>}
            <div className="modal-actions">
              <button onClick={() => answer(false)}>Deny</button>
              <button className="primary" onClick={() => answer(true)}>Approve</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
