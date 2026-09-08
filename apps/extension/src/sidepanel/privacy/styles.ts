/**
 * Shared style tokens for the privacy inspector.
 *
 * Built to be read from three metres away (PLAN-B §6 P12-B): nothing below 14px,
 * and every foreground/background pair here clears WCAG AA at that size. Plain
 * inline styles — a demo-critical panel should not depend on a stylesheet
 * arriving — but the colours and faces are the panel's own tokens, so the
 * inspector reads as part of the same product rather than a debug console.
 */
import type { CSSProperties } from 'react';

export const RED = '#c73f38';
export const GREEN = '#007506';
export const AMBER = '#8a5a00';

export const TEXT: CSSProperties = { color: 'var(--text)', fontFamily: 'var(--sans)' };
export const MUTED: CSSProperties = { ...TEXT, color: 'var(--muted)', fontSize: 15 };
export const mono: CSSProperties = { fontFamily: 'var(--mono)' };

export const CARD: CSSProperties = {
  background: 'var(--card)',
  borderRadius: 6,
  boxShadow: 'var(--ring)',
  padding: 16,
  marginBottom: 10,
};

export const PANE: CSSProperties = {
  ...mono,
  fontSize: 14,
  lineHeight: 1.45,
  color: '#111',
  background: '#f8f8f9',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: 12,
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
