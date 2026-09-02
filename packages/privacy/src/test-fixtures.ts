// A realistic ShopLite-like raw observation for tests that exercise the whole seam
// (sanitize → gate → vault, and the orchestrator loop). Not a fixture built to pass.
import type { RawObservation } from '@glasswall/schema/observation';

export const EMAIL = 'anita.sharma42@zmail.in';
export const PHONE = '+91 99194 14773';
export const AADHAAR = '2345 6789 0124';

export function checkoutPage(step = 0): RawObservation {
  return {
    observation_id: `obs_${step}`,
    session_id: 's1',
    step,
    page: { origin_class: 'benchmark', url_template: '/shoplite/checkout', title_raw: 'ShopLite Checkout', type_hint: 'checkout', modal_active: false, stability: 'stable' },
    viewport: { w: 1280, h: 720, scroll_y_pct: 0, doc_h_ratio: 1.4, dpr: 2 },
    elements: [
      { id: 'e1', id_hash: 'h1', tag: 'input', role: 'textbox', type: 'email', label_raw: 'Email', placeholder_raw: 'you@example.com', rect: [20, 100, 300, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'form', frame: 0, autocomplete: 'email', input_type: 'email' },
      { id: 'e2', id_hash: 'h2', tag: 'input', role: 'textbox', type: 'tel', label_raw: 'Phone', placeholder_raw: '+91 98765 43210', rect: [20, 140, 300, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'form', frame: 0, autocomplete: 'tel', input_type: 'tel' },
      { id: 'e3', id_hash: 'h3', tag: 'input', role: 'searchbox', type: 'search', label_raw: 'Search products', placeholder_raw: 'Search products', rect: [400, 10, 260, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'header', frame: 0, input_type: 'search' },
      { id: 'e4', id_hash: 'h4', tag: 'button', role: 'button', label_raw: 'Place order', rect: [20, 200, 120, 36], visible: true, enabled: true, focusable: true, value_state: 'n/a', group: 'form', frame: 0 },
      { id: 'e5', id_hash: 'h5', tag: 'input', role: 'textbox', type: 'password', label_raw: 'CVC', placeholder_raw: 'CVC', rect: [20, 260, 80, 32], visible: true, enabled: true, focusable: true, value_state: 'empty', group: 'form', frame: 0, autocomplete: 'cc-csc', input_type: 'password' },
      { id: 'e6', id_hash: 'h6', tag: 'canvas', role: 'img', label_raw: '', rect: [700, 100, 300, 200], visible: true, enabled: false, focusable: false, value_state: 'n/a', group: 'main', frame: 0, unexplained: true },
    ],
    text_nodes: [
      { id: 't1', rect: [20, 40, 400, 20], text: 'Your saved details', owner_element_id: null, source: 'dom' },
      { id: 't2', rect: [20, 60, 400, 20], text: `Email ${EMAIL}`, owner_element_id: null, source: 'dom' },
      { id: 't3', rect: [20, 80, 400, 20], text: `Phone ${PHONE}`, owner_element_id: null, source: 'dom' },
      { id: 't4', rect: [20, 300, 400, 20], text: `KYC Aadhaar ${AADHAAR}`, owner_element_id: null, source: 'dom' },
      { id: 't5', rect: [400, 300, 400, 20], text: 'Aeron Chair - in stock', owner_element_id: null, source: 'dom' },
    ],
    frames: [{ id: 0, origin: 'same', rect: [0, 0, 1280, 720] }],
    truncated: false,
    list_virtualized: false,
  };
}

