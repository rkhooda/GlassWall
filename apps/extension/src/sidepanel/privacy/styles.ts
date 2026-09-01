/**
 * Shared style tokens for the privacy inspector.
 *
 * Built to be read from three metres away (PLAN-B §6 P12-B): nothing below 14px,
 * and every foreground/background pair here clears WCAG AA at that size. Plain
 * inline styles — the side panel ships no stylesheet, and a demo-critical panel
 * should not depend on one arriving.
 */
import type { CSSProperties } from 'react';

export const RED = '#b31b1b';
export const GREEN = '#0b6b3a';
export const AMBER = '#8a5a00';

export const TEXT: CSSProperties = { color: '#111', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' };
export const MUTED: CSSProperties = { ...TEXT, color: '#444', fontSize: 15 };
export const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export const CARD: CSSProperties = {
  background: '#fff',
  border: '2px solid #111',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

export const PANE: CSSProperties = {
  ...mono,
  fontSize: 14,
  lineHeight: 1.45,
  color: '#111',
  background: '#f5f5f5',
  border: '1px solid #999',
  borderRadius: 6,
  padding: 12,
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
