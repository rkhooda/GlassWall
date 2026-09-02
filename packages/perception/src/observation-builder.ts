import type {
  RawObservation,
  SanitizedObservation,
  SanitizedElement,
  SanitizedTextNode,
  Handle,
  Budget,
  Viewport,
  PageInfo,
  Rect,
} from '@glasswall/schema/observation';
import type { PolicyConfig } from '@glasswall/schema/policy';
import { quantizeRect } from './geometry';

export interface TokenizedText {
  text: string;
  handles: Handle[];
}

export interface ElementProjectionInput {
  rawElement: RawObservation['elements'][0];
  policy: PolicyConfig;
  tokenizedLabel: string;
  tokenizedPlaceholder: string | undefined;
  sensitivityClass: string | undefined;
  availableActions: string[];
}

export interface TextNodeProjectionInput {
  rawTextNode: RawObservation['text_nodes'][0];
  tokenizedText: string;
}


export function buildSanitizedObservation(input: {
  raw: RawObservation;
  tokenizedElements: {
    rawElement: RawObservation['elements'][0];
    tokenizedLabel: string;
    tokenizedPlaceholder: string | undefined;
    sensitivityClass: string | undefined;
    availableActions: string[];
  }[];
  tokenizedTextNodes: {
    rawTextNode: RawObservation['text_nodes'][0];
    tokenizedText: string;
  }[];
  handles: Handle[];
  budget: Budget;
}): SanitizedObservation {
  const { raw, tokenizedElements, tokenizedTextNodes, handles, budget } = input;

  const page: PageInfo = {
    origin_class: raw.page.origin_class,
    url_template: raw.page.url_template,
    title_raw: raw.page.title_raw,
    type_hint: raw.page.type_hint,
    modal_active: raw.page.modal_active,
    stability: raw.page.stability,
  };

  const viewport: Viewport = {
    w: quantize(raw.viewport.w, 4),
    h: quantize(raw.viewport.h, 4),
    scroll_y_pct: raw.viewport.scroll_y_pct,
    doc_h_ratio: raw.viewport.doc_h_ratio,
    dpr: raw.viewport.dpr,
  };

  const elements: SanitizedElement[] = tokenizedElements.map(({ rawElement, tokenizedLabel, tokenizedPlaceholder, sensitivityClass, availableActions }) => {
    const sanitizedElement: SanitizedElement = {
      id: rawElement.id,
      id_hash: rawElement.id_hash,
      tag: rawElement.tag,
      role: rawElement.role,
      type: rawElement.type,
      label_raw: tokenizedLabel,
      placeholder_raw: tokenizedPlaceholder,
      rect: quantizeRectTuple(rawElement.rect, 4),
      visible: rawElement.visible,
      enabled: rawElement.enabled,
      focusable: rawElement.focusable,
      value_state: rawElement.value_state,
      options_count: rawElement.options_count,
      group: rawElement.group,
      frame: rawElement.frame,
      unexplained: rawElement.unexplained,
      autocomplete: rawElement.autocomplete,
      input_type: rawElement.input_type,
      available_actions: availableActions,
      sensitivity_class: sensitivityClass,
    };
    return sanitizedElement;
  });

  const text_nodes: SanitizedTextNode[] = tokenizedTextNodes.map(({ rawTextNode, tokenizedText }) => ({
    id: rawTextNode.id,
    rect: quantizeRectTuple(rawTextNode.rect, 4),
    text: tokenizedText,
    owner_element_id: rawTextNode.owner_element_id,
    source: 'dom' as const,
  }));

  const frames = raw.frames.map(f => ({
    id: f.id,
    origin: f.origin,
    rect: quantizeRectTuple(f.rect, 4),
  }));

  return {
    observation_id: raw.observation_id,
    session_id: raw.session_id,
    step: raw.step,
    page,
    viewport,
    elements,
    text_nodes,
    frames,
    truncated: raw.truncated,
    list_virtualized: raw.list_virtualized,
    handles,
    budget,
  };
}

function quantizeRectTuple(rect: Rect, gridSize = 4): Rect {
  const geoRect = { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
  const quantized = quantizeRect(geoRect, gridSize);
  return [quantized.x, quantized.y, quantized.width, quantized.height];
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function deriveAvailableActions(element: RawObservation['elements'][0]): string[] {
  const actions: string[] = ['CLICK'];
  if (element.tag === 'input' || element.tag === 'textarea') {
    actions.push('TYPE');
  }
  if (element.tag === 'select') {
    actions.push('SELECT');
  }
  if (element.role === 'button' || element.tag === 'a') {
    actions.push('CLICK');
  }
  actions.push('SCROLL');
  actions.push('PRESS_KEY');
  return actions;
}

export function classifySensitivityFromRules(
  element: RawObservation['elements'][0],
  _policy: PolicyConfig
): string | undefined {

  if (element.type === 'password' || element.autocomplete?.includes('cc-') || element.autocomplete?.includes('password') || element.autocomplete?.includes('one-time-code')) {
    return 'PASSWORD';
  }
  if (element.type === 'email' || element.autocomplete?.includes('email')) {
    return 'EMAIL';
  }
  if (element.type === 'tel' || element.autocomplete?.includes('tel')) {
    return 'PHONE';
  }
  if (element.autocomplete?.includes('address') || element.autocomplete?.includes('street') || element.autocomplete?.includes('postal')) {
    return 'ADDRESS';
  }
  if (element.autocomplete?.includes('name') || element.role === 'heading' && element.label_raw?.toLowerCase().includes('name')) {
    return 'NAME';
  }
  if (element.autocomplete?.includes('bday') || element.autocomplete?.includes('birth')) {
    return 'PERSONAL';
  }
  if (element.type === 'search' || element.role === 'searchbox') {
    return 'NONE';
  }
  return undefined;
}