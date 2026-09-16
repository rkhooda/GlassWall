/**
 * The local privacy-inspector flow, as a test.
 *
 * A canary goes onto the page, a step runs through the real `sanitize()`, a user
 * searches for it and gets NOT PRESENT — and a value that genuinely *is* in the
 * payload comes back FOUND, so the search is demonstrably not a rubber stamp.
 *
 * The Handles assertion runs against the serialized markup rather than the props,
 * because "no value in the DOM" is a claim about what was rendered.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { sanitize } from '@glasswall/privacy';
import type { RawObservation, SanitizedObservation } from '@glasswall/schema/observation';
import { Handles } from './Handles';
import { Inspector } from './Inspector';
import { scanPayload } from './scan';

/** Luhn-valid, so the deterministic card recognizer fires on it. */
const CANARY_CARD = '4539578763621486';
const CANARY_EMAIL = 'anita.sharma@clinicdesk.example';
/** Legitimately public. It must come back FOUND, or the search proves nothing. */
const PUBLIC_PRODUCT = 'Aeron Chair';

function buildRaw(): RawObservation {
  return {
    observation_id: 'ob_test',
    session_id: 'sess_test',
    step: 3,
    page: {
      origin_class: 'benchmark',
      url_template: '/shoplite/checkout',
      title_raw: `Checkout — ${PUBLIC_PRODUCT}`,
      type_hint: 'checkout',
      modal_active: false,
      stability: 'stable',
    },
    viewport: { w: 1280, h: 900, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 2 },
    elements: [
      {
        id: 'el_product', id_hash: 'h_product', tag: 'h1', role: 'heading',
        label_raw: PUBLIC_PRODUCT, rect: [16, 16, 400, 32],
        visible: true, enabled: true, focusable: false, value_state: 'n/a', group: 'main', frame: 0,
      },
      {
        id: 'el_pay', id_hash: 'h_pay', tag: 'button', role: 'button',
        label_raw: 'Pay now', rect: [16, 240, 120, 40],
        visible: true, enabled: true, focusable: true, value_state: 'n/a', group: 'main', frame: 0,
      },
    ],
    text_nodes: [
      { id: 't_product', rect: [16, 16, 400, 32], text: `${PUBLIC_PRODUCT} — in stock`, owner_element_id: 'el_product', source: 'dom' },
      { id: 't_card', rect: [16, 96, 420, 24], text: `card on file: ${CANARY_CARD}`, owner_element_id: null, source: 'dom' },
      { id: 't_email', rect: [16, 128, 420, 24], text: `receipt to ${CANARY_EMAIL}`, owner_element_id: null, source: 'dom' },
    ],
    frames: [],
    truncated: false,
    list_virtualized: false,
  };
}

async function runStep() {
  const raw = buildRaw();
  const result = await sanitize({
    raw,
    frame: null,
    task: 'checkout',
    step: 3,
    session: { session_id: 'sess_test', policy_profile: 'BALANCED' },
  });
  return { raw, result, payload: result.observation as SanitizedObservation };
}

describe('the privacy-inspector flow', () => {
  it('reports NOT PRESENT for a canary that was on the page', async () => {
    const { payload } = await runStep();

    for (const canary of [CANARY_CARD, CANARY_EMAIL]) {
      const scan = scanPayload(payload, canary);
      expect(scan.found, `${canary} leaked as ${scan.matchedEncodings.join(', ')}`).toBe(false);
      // Every encoding is either checked or explicitly reported as skipped.
      expect(scan.probes.length).toBeGreaterThan(0);
      expect(scan.probes.every(p => !p.found)).toBe(true);
    }
  });

  it('reports FOUND for a value that legitimately is in the payload', async () => {
    const { payload } = await runStep();

    const scan = scanPayload(payload, PUBLIC_PRODUCT);
    expect(scan.found).toBe(true);
    expect(scan.matchedEncodings).toContain('literal');
  });

  it('finds the canary in the local observation, so the scan is looking properly', async () => {
    const { raw } = await runStep();
    expect(scanPayload(raw, CANARY_CARD).found).toBe(true);
  });
});

describe('Handles renders no value, in any encoding', () => {
  it('shows type and count and nothing else', async () => {
    const { payload } = await runStep();
    const handles = payload.handles ?? [];
    expect(handles.length).toBeGreaterThan(0);

    const markup = renderToStaticMarkup(<Handles handles={handles} />);

    for (const canary of [CANARY_CARD, CANARY_EMAIL]) {
      expect(scanPayload(markup, canary).found).toBe(false);
    }
    // No hover surface either: a value cannot hide in an attribute that is not there.
    expect(markup).not.toMatch(/title=|data-value=|aria-description=/);
    expect(markup).toContain('DISTINCT');
  });

  it('renders an empty inventory without inventing one', () => {
    expect(renderToStaticMarkup(<Handles handles={[]} />)).toContain('No handles issued');
  });
});

describe('Inspector', () => {
  it('shows both panes, the redaction reasons and degraded[]', async () => {
    const { raw, result, payload } = await runStep();
    const markup = renderToStaticMarkup(
      <Inspector raw={raw} payload={payload} redactions={result.redactions} degraded={['ocr_timeout']} />
    );

    expect(markup).toContain('LOCAL');
    expect(markup).toContain('OUTBOUND');
    expect(markup).toContain('ocr_timeout');
    expect(markup).toContain('this step redacted more, not less');
    for (const r of result.redactions) expect(markup).toContain(r.reason);
  });

  it('renders with no observation at all', () => {
    const markup = renderToStaticMarkup(<Inspector raw={null} payload={null} redactions={[]} degraded={[]} />);
    expect(markup).toContain('No payload for this step.');
    expect(markup).toContain('Nothing was redacted on this step.');
  });
});
