/**
 * The payload inspector (PLAN-B §6 P12-B, PLAN.md §28 cut #11).
 *
 * This is the component the demo is built around. A judge names a secret, types
 * it into the search box, and the panel says whether it is present in the payload
 * that would go over the wire — naming every encoding it checked. The search is
 * not a rubber stamp: a value that genuinely is in the payload (a product name, a
 * page title) comes back FOUND, and `inspector.test.tsx` asserts both directions.
 *
 * Left pane is the local raw observation, values and all. Right pane is the
 * outbound payload. The difference between them is the whole argument, so they
 * are shown together rather than described.
 */
import { useMemo, useState } from 'react';
import type { RawObservation, SanitizedObservation } from '@glasswall/schema/observation';
import type { RedactionReason } from '@glasswall/schema/audit';
import { Handles } from './Handles';
import { scanPayload } from './scan';
import { AMBER, CARD, GREEN, MUTED, PANE, RED, TEXT, mono } from './styles';

export interface InspectorProps {
  /** Local only. Never transmitted, never persisted — it is here to be compared. */
  raw: RawObservation | null;
  /** Exactly what `sanitize()` produced and `egressGate()` would hand to `send()`. */
  payload: SanitizedObservation | null;
  redactions: RedactionReason[];
  /** Perception sources that failed or timed out for this step. */
  degraded: string[];
}

const OVERLAY_W = 340;

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 style={{ ...TEXT, fontSize: 20, fontWeight: 700, margin: '0 0 12px' }}>{children}</h3>
);

const SearchVerdict: React.FC<{ result: ReturnType<typeof scanPayload> }> = ({ result }) => {
  const color = result.found ? RED : GREEN;
  const checked = result.probes.filter(p => !p.skippedReason);

  return (
    <div style={{ marginTop: 12 }} role="status" aria-live="polite">
      <p style={{ ...TEXT, fontSize: 30, fontWeight: 800, color, margin: '0 0 6px', letterSpacing: '0.01em' }}>
        {result.found ? 'FOUND' : 'NOT PRESENT'}
      </p>
      <p style={{ ...MUTED, margin: '0 0 10px' }}>
        {result.found
          ? `Present in the outbound payload as: ${result.matchedEncodings.join(', ')}.`
          : `Absent from the outbound payload in all ${checked.length} encodings checked.`}
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {result.probes.map(probe => (
          <li
            key={probe.encoding}
            style={{
              ...TEXT,
              fontSize: 15,
              padding: '4px 0',
              color: probe.skippedReason ? '#555' : probe.found ? RED : GREEN,
            }}
          >
            <span style={{ ...mono, fontWeight: 700 }}>
              {probe.skippedReason ? '—' : probe.found ? '✗' : '✓'}
            </span>{' '}
            {probe.encoding}
            {probe.skippedReason ? ` · not checked: ${probe.skippedReason}` : probe.found ? ' · MATCH' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
};

const RedactionOverlay: React.FC<{ payload: SanitizedObservation; redactions: RedactionReason[] }> = ({
  payload,
  redactions,
}) => {
  const scale = OVERLAY_W / Math.max(1, payload.viewport.w);
  const height = Math.max(80, payload.viewport.h * scale);

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div
        style={{
          position: 'relative',
          width: OVERLAY_W,
          height,
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {redactions.map((r, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: r.rect[0] * scale,
              top: r.rect[1] * scale,
              width: Math.max(3, r.rect[2] * scale),
              height: Math.max(3, r.rect[3] * scale),
              background: 'rgba(179, 27, 27, 0.35)',
              border: `1px solid ${RED}`,
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>

      <ol style={{ ...TEXT, flex: '1 1 260px', margin: 0, paddingLeft: 22, fontSize: 16 }}>
        {redactions.map((r, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 700 }}>{r.reason}</span>
            <br />
            <span style={{ ...MUTED, ...mono, fontSize: 14 }}>
              source {r.source} · S={r.score.toFixed(2)} · [{r.rect.map(n => Math.round(n)).join(', ')}]
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

export const Inspector: React.FC<InspectorProps> = ({ raw, payload, redactions, degraded }) => {
  const [query, setQuery] = useState('');
  const result = useMemo(() => scanPayload(payload, query), [payload, query]);

  return (
    <div style={{ ...TEXT, overflow: 'auto' }}>
      <section style={CARD}>
        <Heading>Is a value in the outbound payload?</Heading>
        <label htmlFor="gw-inspector-search" style={{ ...MUTED, display: 'block', marginBottom: 6 }}>
          Paste the value you want to look for. Every encoding the egress gate guards is checked.
        </label>
        <input
          id="gw-inspector-search"
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="e.g. a card number, an address, a product name"
          autoComplete="off"
          spellCheck={false}
          style={{
            ...mono,
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 20,
            padding: '12px 14px',
            color: '#111',
            background: '#fff',
            border: 'none',
            boxShadow: 'var(--ring)',
            borderRadius: 6,
          }}
        />
        {query.trim() === '' ? (
          <p style={{ ...MUTED, marginTop: 12, marginBottom: 0 }}>
            Nothing searched yet. The scan runs as you type; it never leaves this panel.
          </p>
        ) : (
          <SearchVerdict result={result} />
        )}
      </section>

      <section style={CARD}>
        <Heading>Local observation vs. outbound payload</Heading>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            <p style={{ ...TEXT, fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>
              LOCAL <span style={{ ...MUTED, fontWeight: 400 }}>· raw, never sent</span>
            </p>
            <pre style={PANE}>{raw ? JSON.stringify(raw, null, 1) : 'No observation for this step.'}</pre>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 240 }}>
            <p style={{ ...TEXT, fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>
              OUTBOUND <span style={{ ...MUTED, fontWeight: 400 }}>· exactly what the gate would send</span>
            </p>
            <pre style={{ ...PANE, background: '#f4f0fd', border: '1px solid var(--accent-soft)' }}>
              {payload ? JSON.stringify(payload, null, 1) : 'No payload for this step.'}
            </pre>
          </div>
        </div>
      </section>

      <section style={CARD}>
        <Heading>Redactions · {redactions.length} region{redactions.length === 1 ? '' : 's'}</Heading>
        {payload && redactions.length > 0 ? (
          <RedactionOverlay payload={payload} redactions={redactions} />
        ) : (
          <p style={{ ...MUTED, fontSize: 16, margin: 0 }}>Nothing was redacted on this step.</p>
        )}
      </section>

      <section style={{ ...CARD, boxShadow: degraded.length > 0 ? `0 0 0 1px ${AMBER}` : CARD.boxShadow }}>
        <Heading>Degraded this step</Heading>
        {degraded.length === 0 ? (
          <p style={{ ...MUTED, fontSize: 16, margin: 0 }}>
            None. Every perception source ran to completion.
          </p>
        ) : (
          <ul style={{ ...TEXT, margin: 0, paddingLeft: 22, fontSize: 17 }}>
            {degraded.map(d => (
              <li key={d} style={{ color: AMBER, fontWeight: 700, marginBottom: 6 }}>
                <span style={mono}>{d}</span>
                <span style={{ ...MUTED, fontWeight: 400 }}> — this step redacted more, not less</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Handles handles={payload?.handles ?? []} />
    </div>
  );
};

export default Inspector;
