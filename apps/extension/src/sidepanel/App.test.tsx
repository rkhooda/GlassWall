// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App';
import type { WorkerToPanel } from '../shared/messages';

type Listener = (message: unknown) => void;
const listeners = new Set<Listener>();
const sent: unknown[] = [];
let activeUrl = 'http://localhost:5173/clinicdesk/';

beforeEach(() => {
  listeners.clear();
  sent.length = 0;
  activeUrl = 'http://localhost:5173/clinicdesk/';
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: vi.fn(async (m: { type: string }) => {
        sent.push(m);
        if (m.type === 'gw:get-state') return { status: 'idle', sessionId: null, task: '', policy: 'STRICT', step: 0, stepsLeft: 0, provider: null };
        if (m.type === 'gw:get-health') return { gateway: 'ok', providers: ['scripted'], active: 'scripted' };
        if (m.type === 'gw:start') return { ok: true };
        if (m.type === 'gw:get-audit') return [];
        return { ok: true };
      }),
      onMessage: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
    tabs: {
      query: vi.fn(async () => [{ url: activeUrl }]),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});

const emit = (m: WorkerToPanel) => act(() => { listeners.forEach(l => l(m)); });

describe('side panel', () => {
  it('prefills the task from the active site, and typing wins', async () => {
    render(<App />);
    await act(() => Promise.resolve());
    const box = screen.getByLabelText<HTMLTextAreaElement>('Task');
    expect(box.value).toBe("Open the first patient's record");
    fireEvent.change(box, { target: { value: 'Open the third patient instead' } });
    expect(screen.getByLabelText<HTMLTextAreaElement>('Task').value).toBe('Open the third patient instead');
  });

  it('leaves the task empty on a page it has no default for', async () => {
    activeUrl = 'https://example.com/anything';
    render(<App />);
    await act(() => Promise.resolve());
    expect(screen.getByLabelText<HTMLTextAreaElement>('Task').value).toBe('');
  });

  it('starts a run, shows the trace, and reports completion', async () => {
    render(<App />);
    await act(() => Promise.resolve());
    expect(await screen.findByText(/gateway · scripted/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Fill the form' } });
    await act(async () => { fireEvent.click(screen.getByText('Start')); });
    expect(sent.some(m => (m as { type: string }).type === 'gw:start')).toBe(true);

    emit({ type: 'gw:state', state: { status: 'running', sessionId: 's1', task: 'Fill the form', policy: 'STRICT', step: 0, stepsLeft: 20, provider: 'scripted' } });
    expect(screen.getByText('running')).toBeTruthy();
    emit({ type: 'gw:trace', entry: { step: 0, phase: 'ok', action: { type: 'TYPE', target: { id: 'e1', id_hash: 'h' }, value: { kind: 'vault_ref', handle: '⟦EMAIL#1⟧' }, clear_first: true }, targetLabel: 'Email', provider: 'scripted', timings: { observe: 100, reason: 20, total: 150 }, redactions: 3, degraded: [], observedElements: 12, at: 1 } });
    expect(screen.getByText('TYPE ← ⟦EMAIL#1⟧')).toBeTruthy();
    expect(screen.getByText('Email')).toBeTruthy();
    emit({ type: 'gw:state', state: { status: 'done', sessionId: 's1', task: 'Fill the form', policy: 'STRICT', step: 1, stepsLeft: 19, provider: 'scripted', outcome: 'success', message: 'Task completed' } });
    expect(screen.getByText('Task completed')).toBeTruthy();
    expect(screen.getByText('done')).toBeTruthy();
  });

  it('shows a confirmation and sends the answer', async () => {
    render(<App />);
    await act(() => Promise.resolve());
    emit({ type: 'gw:state', state: { status: 'waiting_confirmation', sessionId: 's1', task: 't', policy: 'STRICT', step: 2, stepsLeft: 18, provider: 'scripted' } });
    emit({ type: 'gw:confirm-request', context: { actionType: 'CLICK', targetLabel: 'Place order', risk: 'high', reason: 'payment or order placement' } });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Approve'));
    expect(sent.some(m => JSON.stringify(m) === JSON.stringify({ type: 'gw:confirm-response', approved: true }))).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('surfaces errors and blocked actions', async () => {
    render(<App />);
    await act(() => Promise.resolve());
    emit({ type: 'gw:error', code: 'VAULT_TYPE_MISMATCH', message: 'Blocked: AADHAAR handle bound into e3', step: 0 });
    expect(screen.getByRole('alert').textContent).toContain('Blocked');
    emit({ type: 'gw:trace', entry: { step: 0, phase: 'blocked', action: { type: 'TYPE', target: { id: 'e3', id_hash: 'h' }, value: { kind: 'vault_ref', handle: '⟦AADHAAR#1⟧' }, clear_first: true }, targetLabel: 'Search products', provider: 'demo-hijacked', timings: { total: 90 }, redactions: 1, degraded: [], observedElements: 20, errorCode: 'VAULT_TYPE_MISMATCH', errorMessage: 'no', at: 2 } });
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(document.querySelector('.summary .warn')?.textContent).toBe('1 blocked');
  });

  it('privacy tab renders the inspector with the latest step', async () => {
    render(<App />);
    await act(() => Promise.resolve());
    fireEvent.click(screen.getByRole('tab', { name: 'Privacy' }));
    expect(screen.getByText(/Is a value in the outbound payload/)).toBeTruthy();
  });
});
