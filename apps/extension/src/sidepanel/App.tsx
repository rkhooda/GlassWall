// Side panel: task input, gateway status, run trace, and the privacy inspector.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { WorkerToPanel, RunState, TraceEntry, InspectPayload, ConfirmContext, PanelToWorker, HealthInfo, AuditEntry } from '../shared/messages';
import { Inspector } from './privacy';
import './styles.css';

const IDLE: RunState = { status: 'idle', sessionId: null, task: '', policy: 'STRICT', step: 0, stepsLeft: 0, provider: null };

function send(message: PanelToWorker): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

function describeAction(entry: TraceEntry): string {
  const a = entry.action;
  if (!a) return entry.phase;
  if (a.type === 'TYPE') return a.value.kind === 'vault_ref' ? `TYPE ← ${a.value.handle}` : a.value.kind === 'literal' ? `TYPE "${a.value.text}"` : 'TYPE';
  if (a.type === 'DONE') return `DONE (${a.outcome})`;
  if (a.type === 'SCROLL') return `SCROLL ${a.direction}`;
  if (a.type === 'PRESS_KEY') return `PRESS ${a.key}`;
  return a.type;
}

export default function App() {
  const [task, setTask] = useState('Fill the shipping form with my saved details and place the order');
  const [policy, setPolicy] = useState<PolicyProfile>('STRICT');
  const [state, setState] = useState<RunState>(IDLE);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [inspect, setInspect] = useState<InspectPayload | null>(null);
  const [confirm, setConfirm] = useState<ConfirmContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [tab, setTab] = useState<'run' | 'privacy'>('run');

  const refreshHealth = () => void send({ type: 'gw:get-health' }).then(h => { if (h) setHealth(h as HealthInfo); }).catch(() => undefined);

  useEffect(() => {
    const listener = (message: unknown) => {
      const m = message as WorkerToPanel;
      if (typeof m !== 'object' || m === null || !('type' in m)) return;
      switch (m.type) {
        case 'gw:state':
          setState(m.state);
          if (m.state.status === 'running' && m.state.step === 0 && !m.state.sessionId) { setTrace([]); setError(null); }
          if (m.state.status !== 'running' && m.state.status !== 'waiting_confirmation') setConfirm(null);
          break;
        case 'gw:trace': setTrace(prev => [...prev, m.entry]); break;
        case 'gw:inspect': setInspect(m.inspect); break;
        case 'gw:confirm-request': setConfirm(m.context); break;
        case 'gw:error': setError(m.message); break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    void send({ type: 'gw:get-state' }).then(s => { if (s) setState(s as RunState); }).catch(() => undefined);
    refreshHealth();
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const running = state.status === 'running' || state.status === 'waiting_confirmation';

  const summary = useMemo(() => {
    if (trace.length === 0) return null;
    const total = trace.reduce((s, e) => s + e.timings.total, 0);
    const network = trace.reduce((s, e) => s + (e.timings.reason ?? 0), 0);
    const redactions = trace.reduce((s, e) => s + e.redactions, 0);
    const blocked = trace.filter(e => e.phase === 'blocked').length;
    return { steps: trace.length, total, network, redactions, blocked };
  }, [trace]);

  const onStart = async (e: FormEvent) => {
    e.preventDefault();
    if (!task.trim() || running) return;
    setError(null);
    setTrace([]);
    setInspect(null);
    setTab('run');
    // Screenshots need a host permission for the page's origin. Ask for exactly that
    // origin, here, because the Start click is the user gesture Chrome requires.
    if (policy !== 'STRICT') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const origin = tab?.url && /^https?:/.test(tab.url) ? new URL(tab.url).origin : null;
        if (origin) await chrome.permissions.request({ origins: [`${origin}/*`] });
      } catch {
        /* denied or unavailable: the run degrades to structure only */
      }
    }
    const reply = (await send({ type: 'gw:start', task: task.trim(), policy })) as { ok: boolean; error?: string } | undefined;
    if (reply && !reply.ok) setError(reply.error ?? 'Could not start');
    refreshHealth();
  };

  const answer = (approved: boolean) => {
    setConfirm(null);
    void send({ type: 'gw:confirm-response', approved });
  };

  const exportAudit = async () => {
    const entries = ((await send({ type: 'gw:get-audit' })) as AuditEntry[] | undefined) ?? [];
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), session_id: state.sessionId, entries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `glasswall-audit-${(state.sessionId ?? 'session').slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="panel">
      <header className="panel-header">
        <div>
          <h1>GLASSWALL</h1>
          <span className={`chip ${health?.gateway === 'ok' ? 'chip-ok' : 'chip-warn'}`} title={health?.providers.join(', ')}>
            {health === null ? 'checking gateway…' : health.gateway === 'ok' ? `gateway · ${health.active ?? 'no provider'}` : 'gateway offline'}
          </span>
          {health?.capability && (
            <span className="chip" title="Local models run in the extension's offscreen document">
              local · {health.capability.webgpu ? 'WebGPU' : 'WASM'}{health.warm ? ` · NER ${health.warm.ner ? 'warm' : 'cold'} · OCR ${health.warm.ocr ? 'warm' : 'cold'}` : ''}
            </span>
          )}
        </div>
        <span className={`status status-${state.status}`}>{state.status.replace('_', ' ')}</span>
      </header>

      <form className="task" onSubmit={onStart}>
        <label htmlFor="task">Task</label>
        <textarea id="task" rows={2} value={task} onChange={e => setTask(e.target.value)} disabled={running} />
        <div className="task-controls">
          <label>
            Policy
            <select value={policy} onChange={e => setPolicy(e.target.value as PolicyProfile)} disabled={running}>
              <option value="STRICT">STRICT · structure only, no pixels leave</option>
              <option value="BALANCED">BALANCED · adds a pixel-redacted screenshot</option>
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
      {state.message && !error && <div className={`banner ${state.status === 'done' && state.outcome === 'success' ? 'ok' : 'info'}`}>{state.message}</div>}

      {summary && (
        <div className="summary" aria-label="Run summary">
          <span><strong>{summary.steps}</strong> steps</span>
          <span><strong>{(summary.total / 1000).toFixed(1)} s</strong> total</span>
          <span><strong>{summary.network} ms</strong> in the reasoner</span>
          <span><strong>{summary.redactions}</strong> redactions</span>
          {summary.blocked > 0 && <span className="warn"><strong>{summary.blocked}</strong> blocked</span>}
          {inspect && <span><strong>{inspect.handlesCount}</strong> handles held locally</span>}
        </div>
      )}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'run'} onClick={() => setTab('run')}>Run</button>
        <button role="tab" aria-selected={tab === 'privacy'} onClick={() => setTab('privacy')}>Privacy</button>
        <button type="button" className="link" onClick={() => void exportAudit()} disabled={!state.sessionId}>Export audit log</button>
      </nav>

      {tab === 'run' && (
        <section className="trace" aria-label="Step trace">
          {trace.length === 0 && <p className="muted">{running ? 'Observing the page…' : 'No steps yet. Open a page, describe the task, press Start.'}</p>}
          {trace.map(entry => (
            <article key={`${entry.step}-${entry.at}`} className={`step step-${entry.phase}`}>
              <header>
                <strong>Step {entry.step}</strong>
                <span>{describeAction(entry)}</span>
                <span className="muted">{entry.timings.total} ms</span>
              </header>
              <dl>
                {entry.targetLabel && <><dt>Target</dt><dd>{entry.targetLabel}</dd></>}
                {entry.provider && <><dt>Planner</dt><dd>{entry.provider}</dd></>}
                <dt>Observed</dt><dd>{entry.observedElements} elements · {entry.redactions} redactions{entry.degraded.length ? ` · degraded: ${entry.degraded.join(', ')}` : ''}</dd>
                <dt>Timing</dt>
                <dd>{Object.entries(entry.timings).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${v}ms`).join(' · ')}</dd>
                {entry.errorCode && <><dt>{entry.phase === 'blocked' ? 'Blocked' : 'Error'}</dt><dd>{entry.errorCode}{entry.errorMessage ? ` — ${entry.errorMessage}` : ''}</dd></>}
              </dl>
            </article>
          ))}
        </section>
      )}

      {tab === 'privacy' && (
        <section className="privacy" aria-label="Privacy inspector">
          {inspect && (
            <p className="muted">
              Step {inspect.step} · {inspect.redactions.length} redactions · {inspect.handlesCount} handles · screenshot {inspect.screenshotAttached ? 'attached (pixel-redacted)' : 'not sent'}
            </p>
          )}
          <Inspector raw={inspect?.raw ?? null} payload={inspect?.payload ?? null} redactions={inspect?.redactions ?? []} degraded={inspect?.degraded ?? []} />
          {inspect && inspect.redactions.length > 0 && (
            <details className="reasons">
              <summary>Why each region was withheld</summary>
              <ul>
                {inspect.redactions.map((r, i) => (
                  <li key={i}><code>{r.source}</code> {r.reason} <span className="muted">(score {r.score.toFixed(2)})</span></li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">Confirm {confirm.actionType}</h2>
            <p><strong>{confirm.targetLabel || confirm.destination || ''}</strong></p>
            <p className="muted">{confirm.reason}</p>
            {confirm.vaultRef && <p>Value: <code>{confirm.vaultRef}</code> (resolved locally, never sent)</p>}
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
