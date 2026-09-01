/**
 * Handle inventory (PLAN-B §6 P12-B).
 *
 * Type and count. Never a value — not in the text, not in a tooltip, not in a
 * `title` attribute, not in a data attribute, not anywhere in the DOM. This
 * component receives `Handle[]`, which by construction carries no value at all
 * (`packages/schema/src/observation.ts`), and it renders nothing else. The
 * assertion lives in `inspector.test.tsx` against the serialized markup, because
 * "we were careful" is not a guarantee and a rendered string is.
 */
import type { Handle } from '@glasswall/schema/observation';
import { CARD, MUTED, TEXT, mono } from './styles';

export interface HandlesProps {
  handles: Handle[];
}

interface TypeRow {
  type: string;
  tier: number;
  distinct: number;
  occurrences: number;
}

export function summarizeHandles(handles: Handle[]): TypeRow[] {
  const rows = new Map<string, TypeRow>();
  for (const h of handles) {
    const row = rows.get(h.type) ?? { type: h.type, tier: h.tier, distinct: 0, occurrences: 0 };
    row.tier = Math.min(row.tier, h.tier);
    row.distinct += 1;
    row.occurrences += h.occurrences;
    rows.set(h.type, row);
  }
  // Tier 1 first, then the types the agent will see most of.
  return [...rows.values()].sort((a, b) => a.tier - b.tier || b.occurrences - a.occurrences);
}

const CELL: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 16,
  borderBottom: '1px solid #d0d0d0',
  textAlign: 'left',
};

export const Handles: React.FC<HandlesProps> = ({ handles }) => {
  const rows = summarizeHandles(handles);
  const total = rows.reduce((n, r) => n + r.distinct, 0);

  return (
    <section style={CARD} aria-labelledby="gw-handles-heading">
      <h3 id="gw-handles-heading" style={{ ...TEXT, fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>
        Handles held locally
      </h3>
      <p style={{ ...MUTED, margin: '0 0 12px' }}>
        {total} handle{total === 1 ? '' : 's'} · types and counts only, values never leave the vault
      </p>

      {rows.length === 0 ? (
        <p style={{ ...MUTED, fontSize: 16, margin: 0 }}>No handles issued for this step.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT }}>
          <thead>
            <tr>
              <th style={{ ...CELL, fontSize: 14, letterSpacing: '0.04em', color: '#444' }}>TYPE</th>
              <th style={{ ...CELL, fontSize: 14, letterSpacing: '0.04em', color: '#444' }}>TIER</th>
              <th style={{ ...CELL, fontSize: 14, letterSpacing: '0.04em', color: '#444' }}>DISTINCT</th>
              <th style={{ ...CELL, fontSize: 14, letterSpacing: '0.04em', color: '#444' }}>USES</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.type}>
                <td style={{ ...CELL, ...mono, fontWeight: 700 }}>{row.type}</td>
                <td style={{ ...CELL, color: row.tier === 1 ? '#b31b1b' : '#111', fontWeight: row.tier === 1 ? 700 : 400 }}>
                  {row.tier}
                </td>
                <td style={{ ...CELL, ...mono }}>{row.distinct}</td>
                <td style={{ ...CELL, ...mono }}>{row.occurrences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export default Handles;
