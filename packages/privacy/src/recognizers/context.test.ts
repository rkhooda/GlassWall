import { describe, it, expect } from 'vitest';
import type { RawObservation } from '@glasswall/schema/observation';
import { recognizeByContext } from './context';

function raw(texts: [string, number][]): RawObservation {
  return {
    observation_id: 'o', session_id: 's', step: 0,
    page: { origin_class: 'benchmark', url_template: '/', title_raw: '', type_hint: 'other', modal_active: false, stability: 'stable' },
    viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
    elements: [], frames: [], truncated: false, list_virtualized: false,
    text_nodes: texts.map(([text, y], i) => ({ id: `t${i}`, rect: [10, y, 200, 18], text, owner_element_id: null, source: 'dom' as const })),
  };
}

describe('recognizeByContext', () => {
  it('classifies dt/dd pairs by their label', () => {
    const hits = recognizeByContext(raw([['Your saved details', 0], ['Name', 20], ['Vivek Gupta', 20], ['City', 40], ['Nagpur', 40], ['PIN', 60], ['440001', 60], ['Address', 80], ['884 Marathahalli', 80]]));
    expect(hits.map(h => `${h.type}:${h.value}`)).toEqual(['PERSON_NAME:Vivek Gupta', 'CITY:Nagpur', 'POSTAL_CODE:440001', 'STREET_ADDRESS:884 Marathahalli']);
  });
  it('handles inline "Label: value" and rejects values that fail the shape', () => {
    const hits = recognizeByContext(raw([['Phone: +91 98765 43210', 0], ['PIN: 12', 20], ['Name: 12345', 40], ['DOB: 1991-04-02', 60]]));
    expect(hits.map(h => `${h.type}:${h.value}`)).toEqual(['PHONE:+91 98765 43210', 'DOB:1991-04-02']);
  });
  it('does not pair a label with a value far down the page or with another label', () => {
    expect(recognizeByContext(raw([['Name', 0], ['Vivek Gupta', 400]]))).toHaveLength(0);
    expect(recognizeByContext(raw([['Name', 0], ['Email', 0]]))).toHaveLength(0);
  });
  it('ignores product copy that happens to follow a label-like word', () => {
    expect(recognizeByContext(raw([['Price', 0], ['₹2,999', 0], ['State', 20], ['Delivered', 20]]))).toEqual([]);
  });
});

describe('table columns', () => {
  it('classifies cells under a label-like header by horizontal overlap', () => {
    const rows: [string, number, number][] = [['Name', 10, 0], ['MRN', 200, 0], ['Phone', 320, 0], ['Priya Patel', 10, 30], ['MRN-000002', 200, 30], ['+918765432109', 320, 30], ['Arjun Singh', 10, 60], ['MRN-000003', 200, 60], ['+919876501234', 320, 60]];
    const raw: RawObservation = { ...rawBase(), text_nodes: rows.map(([text, x, y], i) => ({ id: `t${i}`, rect: [x, y, 100, 18], text, owner_element_id: null, source: 'dom' as const })) };
    const hits = recognizeByContext(raw).map(h => `${h.type}:${h.value}`).sort();
    expect(hits).toEqual(['MRN:MRN-000002', 'MRN:MRN-000003', 'PERSON_NAME:Arjun Singh', 'PERSON_NAME:Priya Patel', 'PHONE:+918765432109', 'PHONE:+919876501234']);
  });

  it('does not treat a form row of side-by-side labels as a header row', () => {
    // <label>City</label><input> beside <label>Postal code</label><input>, then card fields and a button.
    const rows: [string, number, number][] = [['City', 10, 0], ['Postal code', 300, 0], ['Card number', 10, 60], ['Expiry', 10, 100], ['CVC', 300, 100], ['Place order', 10, 160]];
    const raw: RawObservation = { ...rawBase(), text_nodes: rows.map(([text, x, y], i) => ({ id: `t${i}`, rect: [x, y, text.length * 8, 18], text, owner_element_id: null, source: 'dom' as const })) };
    expect(recognizeByContext(raw)).toEqual([]);
  });

  it('does not treat two unrelated labels on one line as a header row', () => {
    // A profile card's <dt>PAN</dt> beside a wizard's step chip "Address": the buttons
    // and headings below the chip are UI copy, not address cells.
    const rows: [string, number, number][] = [['PAN', 10, 0], ['JHWKJ5637Y', 60, 0], ['2.', 400, 0], ['Address', 420, 0], ['3.', 500, 0], ['Personal information', 400, 40], ['Back', 400, 200], ['Submit application', 440, 200]];
    const raw: RawObservation = { ...rawBase(), text_nodes: rows.map(([text, x, y], i) => ({ id: `t${i}`, rect: [x, y, text.length * 8, 18], text, owner_element_id: null, source: 'dom' as const })) };
    expect(recognizeByContext(raw).map(h => `${h.type}:${h.value}`)).toEqual(['PAN:JHWKJ5637Y']);
  });
});

function rawBase(): RawObservation {
  return {
    observation_id: 'o', session_id: 's', step: 0,
    page: { origin_class: 'benchmark', url_template: '/', title_raw: '', type_hint: 'other', modal_active: false, stability: 'stable' },
    viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 1 },
    elements: [], frames: [], truncated: false, list_virtualized: false, text_nodes: [],
  };
}
