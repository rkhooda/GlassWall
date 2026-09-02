// Drives the real extension in a real Chromium: loads a built extension, opens the
// side panel as a page, starts a task, auto-approves confirmations, and captures
// every request the service worker makes to the gateway.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface WireRequest {
  url: string;
  method: string;
  body: string;
  at: number;
}

export interface Harness {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  page: Page;
  panel: Page;
  wire: WireRequest[];
  errors: string[];
  close(): Promise<void>;
}

export interface LaunchOptions {
  extensionPath: string;
  headless?: boolean;
  gatewayOrigin?: string;
}

export async function launch(opts: LaunchOptions): Promise<Harness> {
  const ext = path.resolve(opts.extensionPath);
  if (!fs.existsSync(path.join(ext, 'manifest.json'))) throw new Error(`No extension build at ${ext}. Run: pnpm --filter @glasswall/extension build:eval`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-eval-'));
  const headless = opts.headless ?? true;
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(headless ? ['--headless=new'] : []), '--window-size=1280,900'],
  });
  const wire: WireRequest[] = [];
  const errors: string[] = [];
  const gateway = opts.gatewayOrigin ?? 'http://localhost:3000';
  context.on('request', req => {
    if (req.url().startsWith(gateway)) wire.push({ url: req.url(), method: req.method(), body: req.postData() ?? '', at: Date.now() });
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  worker.on('console', m => { if (m.type() === 'error') errors.push(`[worker] ${m.text()}`); });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/404|net::ERR/.test(m.text())) errors.push(`[page] ${m.text()}`); });
  const panel = await context.newPage();
  panel.on('console', m => { if (m.type() === 'error') errors.push(`[panel] ${m.text()}`); });
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  return {
    context, worker, extensionId, page, panel, wire, errors,
    close: async () => { await context.close().catch(() => undefined); fs.rmSync(profile, { recursive: true, force: true }); },
  };
}

export async function openPage(h: Harness, url: string): Promise<void> {
  await h.page.goto(url, { waitUntil: 'networkidle' });
  await h.page.waitForFunction("document.documentElement.dataset.gwEvalReady === '1'", null, { timeout: 15_000 });
  await h.page.bringToFront();
}

export interface RunState {
  status: string;
  sessionId: string | null;
  step: number;
  provider: string | null;
  outcome?: string;
  message?: string;
}

export interface AuditEntry {
  step: number;
  action: string;
  provider: string | null;
  latency_ms: number;
  element_count: number;
  handle_count: number;
  redaction_count: number;
  degraded: string[];
  has_redacted_screenshot: boolean;
  gate: string;
  validation: string;
  payload_bytes: number;
  redactions: Array<{ rect: [number, number, number, number]; source: string; reason: string }>;
  observed: Array<{ tag: string; rect: [number, number, number, number]; visible: boolean }>;
  timings: Record<string, number>;
}

/** Ask the extension for its run state / audit log through the panel page's chrome.runtime. */
export function getState(h: Harness): Promise<RunState> {
  return h.panel.evaluate("chrome.runtime.sendMessage({ type: 'gw:get-state' })") as Promise<RunState>;
}
export function getAudit(h: Harness): Promise<AuditEntry[]> {
  return h.panel.evaluate("chrome.runtime.sendMessage({ type: 'gw:get-audit' })") as Promise<AuditEntry[]>;
}

export interface DriveOptions {
  task: string;
  policy: 'STRICT' | 'BALANCED';
  timeoutMs?: number;
  autoApprove?: boolean;
  /** Called after each new audit entry appears (for per-step ground truth sampling). */
  onStep?: (entry: AuditEntry) => Promise<void> | void;
}

export interface DriveResult {
  state: RunState;
  audit: AuditEntry[];
  approvals: number;
  totalMs: number;
  finalUrl: string;
}

export async function drive(h: Harness, opts: DriveOptions): Promise<DriveResult> {
  const started = Date.now();
  await h.panel.bringToFront();
  await h.panel.fill('#task', opts.task);
  await h.panel.selectOption('select', opts.policy);
  await h.panel.click('button.primary');
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let approvals = 0;
  let seen = 0;
  let state: RunState = { status: 'running', sessionId: null, step: 0, provider: null };
  while (Date.now() < deadline) {
    if (opts.autoApprove !== false && (await h.panel.locator('.modal button.primary').count())) {
      await h.panel.click('.modal button.primary');
      approvals++;
    }
    const audit = await getAudit(h).catch(() => [] as AuditEntry[]);
    while (seen < audit.length) {
      await opts.onStep?.(audit[seen]!);
      seen++;
    }
    state = await getState(h).catch(() => state);
    if (/done|error|aborted/.test(state.status)) break;
    await h.panel.waitForTimeout(200);
  }
  const audit = await getAudit(h).catch(() => [] as AuditEntry[]);
  return { state, audit, approvals, totalMs: Date.now() - started, finalUrl: h.page.url() };
}
