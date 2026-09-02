/**
 * A synthetic page whose PII is deliberately split across three channels, one per
 * perception source, plus a canvas region no source can explain.
 *
 * The point of the ablation is not that fusion is cleverer than any one source —
 * it is that each source is structurally blind to a channel it has no access to.
 * A regex cannot read pixels. NER cannot checksum an Aadhaar. OCR only sees what
 * was rendered. The scene makes that concrete and measurable rather than asserted.
 *
 * Every value comes from the seeded generator, so the ground truth is exact.
 */
import type { RawObservation } from '@glasswall/schema/observation';
import { generatePersona, type PersonaValue } from '../../apps/bench-site/src/data/generator';

export type Rect4 = [number, number, number, number];

export interface GroundTruthItem {
  value: string;
  type: string;
  tier: number;
  value_id: string;
  rect: Rect4;
  /** Which perception source is capable of seeing it at all. */
  channel: 'dom_structured' | 'dom_free_text' | 'canvas_readable' | 'canvas_opaque';
}

export interface Scene {
  seed: number;
  raw: RawObservation;
  groundTruth: GroundTruthItem[];
  /** What a real OCR pass would recover from each canvas. Never in the DOM. */
  canvases: { rect: Rect4; text: string; channel: 'canvas_readable' | 'canvas_opaque' }[];
}

/** Structured identifiers a deterministic recognizer can match and checksum. */
const STRUCTURED = new Set(['AADHAAR', 'PAN', 'IFSC', 'GSTIN', 'UPI', 'SECRET', 'IP', 'DOB']);
/**
 * Rendered into a canvas that OCR can make something of: a Luhn check still runs on
 * digits recovered from pixels, so the detection stack reaches these.
 */
const CANVAS_READABLE = new Set(['CARD']);
/**
 * Rendered into a second canvas that the detection stack cannot reach at all.
 * There is no MRN recognizer and no free-text POSTAL_CODE recognizer, and no model
 * is trained on either. OCR recovers the characters and nothing matches them.
 * These exist to measure what only explain-or-redact catches.
 */
const CANVAS_OPAQUE = new Set(['MRN', 'POSTAL_CODE']);

export function buildScene(seed: number): Scene {
  const persona = generatePersona(seed);
  const groundTruth: GroundTruthItem[] = [];
  const elements: RawObservation['elements'] = [];
  const textNodes: RawObservation['text_nodes'] = [];

  let y = 0;
  const row = (): Rect4 => {
    const rect: Rect4 = [16, (y += 32), 420, 24];
    return rect;
  };

  // Channel 1 — structured identifiers in labelled DOM rows.
  for (const v of persona.values.filter(p => STRUCTURED.has(p.type))) {
    const rect = row();
    textNodes.push({
      id: `t_${v.value_id}`,
      rect,
      text: `${v.type.toLowerCase()}: ${v.value}`,
      owner_element_id: null,
      source: 'dom',
    });
    groundTruth.push({ ...toItem(v, rect), channel: 'dom_structured' });
  }

  // The phone in E.164 form also sits in the DOM.
  const phone = persona.values.find(p => p.type === 'PHONE')!;
  const phoneRect = row();
  textNodes.push({ id: `t_${phone.value_id}`, rect: phoneRect, text: `contact: ${phone.value}`, owner_element_id: null, source: 'dom' });
  groundTruth.push({ ...toItem(phone, phoneRect), channel: 'dom_structured' });

  // Channel 2 — free text. No recognizer fires on a name or a locality; only NER does.
  const proseRect: Rect4 = [16, (y += 48), 620, 96];
  textNodes.push({
    id: 't_prose',
    rect: proseRect,
    text: persona.clinicalParagraph,
    owner_element_id: null,
    source: 'dom',
  });
  for (const v of persona.values) {
    if ((v.type === 'PERSON_NAME' || v.type === 'STREET_ADDRESS') && persona.clinicalParagraph.includes(v.value)) {
      groundTruth.push({ ...toItem(v, proseRect), channel: 'dom_free_text' });
    }
  }

  // Channel 3 — two canvases. The DOM says a box is there and nothing about what
  // is inside it. One holds characters the recognizers can still match once OCR
  // recovers them; the other holds identifiers nothing in the stack can match.
  const nationalPhone = persona.values.filter(p => p.type === 'PHONE').at(-1)!;
  const canvases: Scene['canvases'] = [];

  for (const [i, spec] of (
    [
      { channel: 'canvas_readable' as const, values: [...persona.values.filter(p => CANVAS_READABLE.has(p.type)), nationalPhone] },
      { channel: 'canvas_opaque' as const, values: persona.values.filter(p => CANVAS_OPAQUE.has(p.type)) },
    ]
  ).entries()) {
    const rect: Rect4 = [16 + i * 352, (y += i === 0 ? 128 : 0), 320, 160];
    canvases.push({ rect, channel: spec.channel, text: spec.values.map(v => `${v.type.toLowerCase()} ${v.value}`).join('\n') });
    for (const v of spec.values) groundTruth.push({ ...toItem(v, rect), channel: spec.channel });

    elements.push({
      id: `el_canvas_${i}`,
      id_hash: `h_canvas_${i}`,
      tag: 'canvas',
      role: 'img',
      label_raw: 'patient summary',
      rect,
      visible: true,
      enabled: true,
      focusable: false,
      value_state: 'n/a',
      group: 'summary',
      frame: 0,
    });
  }

  // A handful of ordinary, non-sensitive controls, so the coverage union is not empty.
  for (const [i, label] of ['Search', 'Print', 'Close'].entries()) {
    elements.push({
      id: `el_btn_${i}`,
      id_hash: `h_btn_${i}`,
      tag: 'button',
      role: 'button',
      label_raw: label,
      rect: [700 + i * 96, 16, 88, 32],
      visible: true,
      enabled: true,
      focusable: true,
      value_state: 'n/a',
      group: 'toolbar',
      frame: 0,
    });
  }

  const raw: RawObservation = {
    observation_id: `ob_${seed}`,
    session_id: `sess_${seed}`,
    step: 0,
    page: {
      origin_class: 'benchmark',
      url_template: '/clinicdesk/patient/:id',
      title_raw: 'ClinicDesk — Patient',
      type_hint: 'detail',
      modal_active: false,
      stability: 'stable',
    },
    viewport: { w: 1280, h: 900, scroll_y_pct: 0, doc_h_ratio: 1, dpr: 2 },
    elements,
    text_nodes: textNodes,
    frames: [],
    truncated: false,
    list_virtualized: false,
  };

  return { seed, raw, groundTruth, canvases };
}

function toItem(v: PersonaValue, rect: Rect4): Omit<GroundTruthItem, 'channel'> {
  return { value: v.value, type: v.type, tier: v.tier, value_id: v.value_id, rect };
}
