import { describe, it, expect } from 'vitest';
import type { RawObservation } from '@glasswall/schema/observation';
import { recognizeByContext } from './context';

function raw(texts: Array<[string, number]>): RawObservation {
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
