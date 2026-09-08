// Side panel: task input, gateway status, run trace, and the privacy inspector.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { PolicyProfile } from '@glasswall/schema/policy';
import type { WorkerToPanel, RunState, TraceEntry, InspectPayload, ConfirmContext, PanelToWorker, HealthInfo, AuditEntry } from '../shared/messages';
import { Inspector } from './privacy';
import './styles.css';

const IDLE: RunState = { status: 'idle', sessionId: null, task: '', policy: 'STRICT', step: 0, stepsLeft: 0, provider: null };

/**
 * A starting task per demo site, so the box is never empty when the panel opens on a
 * page we know. It is only a prefill: anything typed here wins, and the planner reads
 * whatever the box says — the site does not constrain what can be asked.
 */
const DEFAULT_TASKS: [RegExp, string][] = [
  [/\/shoplite\/checkout/, 'Fill the shipping form with my saved details and place the order'],
  [/\/shoplite\/injection/, 'Add this product to my cart'],
  [/\/shoplite/, 'Search for wireless earbuds and add the top result to cart'],
  [/\/govportal/, 'Fill the application form with the applicant profile on record and submit it'],
  [/\/clinicdesk/, "Open the first patient's record"],
];
const GENERIC_TASK = '“Book a table for two tonight.”';

const POLICY_NOTE: Partial<Record<PolicyProfile, string>> = {
  STRICT: '(Structure only · No raw page pixels sent to AI)',
  BALANCED: '(Adds a pixel-redacted screenshot of the viewport)',
};

/** "generativelanguage.googleapis.com:gemini-3.6-flash" -> "gemini-3.6-flash". */
function shortProvider(name: string): string {
  const i = name.indexOf(':');
  return i > 0 && name.slice(0, i).includes('.') ? name.slice(i + 1) : name;
}

/**
 * Turn what the user typed into a URL worth navigating to. Anything that is not
 * plain http(s) — javascript:, data:, file: — comes back null and the panel does
 * nothing: the address bar of an agent is a trust boundary like any other.
 */
function normalizeUrl(raw: string): string | null {
  const typed = raw.trim();
  if (!typed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function defaultTaskFor(url: string | undefined): string {
  return (url && DEFAULT_TASKS.find(([re]) => re.test(url))?.[1]) ?? '';
}

function send(message: PanelToWorker): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/** Badge tone per step: refused first, then the kind of action that ran. */
function actionTone(entry: TraceEntry): string {
  if (entry.phase === 'error' || entry.phase === 'blocked') return 'stop';
  if (entry.action?.type === 'TYPE') return 'type';
  if (entry.action?.type === 'CLICK') return 'click';
  if (entry.action?.type === 'DONE') return 'done';
  return 'plain';
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
  const [task, setTask] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  // What the URL box shows: the tab's address until the user types over it.
  const [urlDraft, setUrlDraft] = useState('');
  // Once the box has been edited the prefill stops overwriting it, including on a tab switch.
  const taskEditedRef = useRef(false);
  const [policy, setPolicy] = useState<PolicyProfile>('STRICT');
  const [state, setState] = useState<RunState>(IDLE);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [inspect, setInspect] = useState<InspectPayload | null>(null);
  const [confirm, setConfirm] = useState<ConfirmContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [tab, setTab] = useState<'run' | 'privacy'>('run');
  const [collapsed, setCollapsed] = useState(false);

  const refreshHealth = () => void send({ type: 'gw:get-health' }).then(h => { if (h) setHealth(h as HealthInfo); }).catch(() => undefined);

  /** Read the tab in front: its URL for the Current Page box, and its site's default task. */
  const syncActiveTab = useCallback(() => {
    void chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([t]) => {
        const url = t?.url && /^https?:/.test(t.url) ? t.url : '';
        setPageUrl(url);
        setUrlDraft(url);
        setTask(prev => (taskEditedRef.current ? prev : defaultTaskFor(t?.url)));
      })
      .catch(() => undefined);
  }, []);

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

    syncActiveTab();
    const onActivated = () => syncActiveTab();
    const onUpdated = (_id: number, change: chrome.tabs.TabChangeInfo) => { if (change.url) syncActiveTab(); };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [syncActiveTab]);

  /** Add/Change: send the active tab to the typed URL, or re-read it if unchanged. */
  const openPage = () => {
    const url = normalizeUrl(urlDraft);
    if (!url) return;
    void chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([t]) => {
        // A real navigation lands back here through the onUpdated listener.
        if (t?.id != null && url !== t.url) return chrome.tabs.update(t.id, { url });
        syncActiveTab();
        return undefined;
      })
      .catch(() => undefined);
  };

  const running = state.status === 'running' || state.status === 'waiting_confirmation';

  const summary = useMemo(() => {
    const total = trace.reduce((s, e) => s + e.timings.total, 0);
    const network = trace.reduce((s, e) => s + (e.timings.reason ?? 0), 0);
    const redactions = trace.reduce((s, e) => s + e.redactions, 0);
    const blocked = trace.filter(e => e.phase === 'blocked').length;
    return { steps: trace.length, total, network, redactions, blocked };
  }, [trace]);

  const showSummary = state.status !== 'idle' || trace.length > 0;

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
        <button type="button" className="collapse" aria-expanded={!collapsed} aria-label={collapsed ? 'Expand controls' : 'Collapse controls'} onClick={() => setCollapsed(c => !c)}>
          <img src="/icons/caret.svg" alt="" width={16} height={16} />
        </button>
        <img className="brand-mark" src="/icons/logo.svg" alt="" width={26} height={26} />
        <h1>Glasswall</h1>
        <div className="health">
          <span className={`chip ${health?.gateway === 'ok' ? 'chip-ok' : 'chip-warn'}`} title={health?.providers.join(', ')}>
            {health === null ? 'checking gateway…' : health.gateway === 'ok' ? `gateway · ${health.active ? shortProvider(health.active) : 'no provider'}` : 'gateway offline'}
          </span>
          {health?.capability && (
            <span className="chip" title="Local models run in the extension's offscreen document">
              local · {health.capability.webgpu ? 'WebGPU' : 'WASM'}{health.warm ? ` · NER ${health.warm.ner ? 'warm' : 'cold'} · OCR ${health.warm.ocr ? 'warm' : 'cold'}` : ''}
            </span>
          )}
        </div>
      </header>

      {!collapsed && (
        <>
          <section className="section">
            <h2 className="section-label"><label htmlFor="page-url">Add Page</label></h2>
            <div className="page-row">
              <input
                id="page-url"
                className="page-url"
                type="text"
                inputMode="url"
                spellCheck={false}
                value={urlDraft}
                placeholder="Enter the URL of the website..."
                title={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') openPage(); }}
              />
              <button type="button" className="pill" onClick={openPage} disabled={!normalizeUrl(urlDraft)}>{pageUrl ? 'Change' : 'Add'}</button>
            </div>
          </section>

          <div className="controls">
            <form className="section" onSubmit={e => { void onStart(e); }}>
              <h2 className="section-label"><label htmlFor="task">Task &amp; Privacy</label></h2>
              <textarea id="task" rows={4} value={task} placeholder={GENERIC_TASK} onChange={e => { taskEditedRef.current = true; setTask(e.target.value); }} disabled={running} />
              <div className="policy-row">
                <img className="policy-caret" src="/icons/caret.svg" alt="" width={16} height={16} />
                <select aria-label="Privacy policy" value={policy} onChange={e => setPolicy(e.target.value as PolicyProfile)} disabled={running}>
                  <option value="STRICT">STRICT</option>
                  <option value="BALANCED">BALANCED</option>
                </select>
                <span className="policy-note">{POLICY_NOTE[policy]}</span>
              </div>
              {running ? (
                <button type="button" className="danger block" onClick={() => void send({ type: 'gw:abort' })}>Abort Task</button>
              ) : (
                <button type="submit" className="primary block" disabled={!task.trim()}>Start Task</button>
              )}
              <p className="form-hint">Your sensitive data stays protected locally during task execution.</p>
            </form>

            <nav className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'run'} onClick={() => setTab('run')}>Runs</button>
              <button role="tab" aria-selected={tab === 'privacy'} onClick={() => setTab('privacy')}>Privacy</button>
              <button type="button" className="link" onClick={() => void exportAudit()} disabled={!state.sessionId}>Export audit log</button>
            </nav>
          </div>
        </>
      )}

      {error && <div className="banner error" role="alert">{error}</div>}
      {state.message && !error && <div className={`banner ${state.status === 'done' && state.outcome === 'success' ? 'ok' : 'info'}`}>{state.message}</div>}

      {showSummary && (
        <section className="summary" aria-label="Run summary">
          <div className="summary-top">
            <span className={`status status-${state.status}`}>{state.status.replace('_', ' ')}</span>
            <span className="summary-total">{(summary.total / 1000).toFixed(1)} s total</span>
          </div>
          <p className="summary-head">{task || 'Waiting for a task'}</p>
          <p className="summary-metrics">
            <strong>{summary.steps} steps</strong>
            <span>· {summary.redactions} redactions</span>
            {summary.blocked > 0 && <span className="warn"><strong>{summary.blocked}</strong> blocked</span>}
            {inspect && <span>· {inspect.handlesCount} handles held locally</span>}
            <img src="/icons/swap.svg" alt="" width={16} height={16} />
            <span>{summary.network} ms in the reasoner</span>
          </p>
        </section>
      )}

      {tab === 'run' && (
        <section className="trace" aria-label="Step trace">
          {trace.length === 0 && (
            <div className="empty">
              <img src="/icons/incognito.svg" alt="" width={32} height={32} />
              <p>{running ? 'Observing the page…' : pageUrl ? 'Describe a task above, then press Start.' : 'Add a website to start running tasks.'}</p>
            </div>
          )}
          {trace.map(entry => (
            <article key={`${entry.step}-${entry.at}`} className={`step step-${entry.phase}`}>
              <header>
                <strong>Step {entry.step}</strong>
                <span className={`badge badge-${actionTone(entry)}`}>{describeAction(entry)}</span>
                <span className="step-time">{(entry.timings.total / 1000).toFixed(1)} s</span>
              </header>
              <dl>
                {entry.targetLabel && <><dt>Target:</dt><dd className="target">{entry.targetLabel}</dd></>}
                {entry.provider && <><dt>Planner:</dt><dd>{entry.provider}</dd></>}
                <dt>Observed:</dt><dd>{entry.observedElements} elements · {entry.redactions} redactions{entry.degraded.length ? ` · degraded: ${entry.degraded.join(', ')}` : ''}</dd>
                <dt>Timing:</dt>
                <dd>{Object.entries(entry.timings).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${v}ms`).join(' · ')}</dd>
                {entry.errorCode && <><dt>{entry.phase === 'blocked' ? 'Blocked' : 'Error'}</dt><dd className="stop">{entry.errorCode}{entry.errorMessage ? ` — ${entry.errorMessage}` : ''}</dd></>}
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
