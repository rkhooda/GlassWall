// Builds a RawObservation for the current page. Local only: the raw observation
// goes to the service worker for sanitization and never leaves the device.
import type { RawObservation, RawTextNode, PageInfo } from '@glasswall/schema/observation';
import { walkDocument } from './walk';
import { waitForFullStability } from './stability';
import { beginObservation, register } from '../registry';
import { quantizeRect } from '../identity';

const MAX_TEXT_NODES = 300;
const MAX_TEXT_CHARS = 400;

/** Identifiers in a path become {id}: numbers, uuids, prefixed codes (ORD-…, TRK…), long opaque tokens. */
const ID_SEGMENT = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[A-Z]{2,6}[-_]?[A-Z0-9]{5,}$/, // ORD-MTJNONUL, TRK12345678, INV_2024A
  /^[A-Za-z]{1,4}[-_]?\d{2,}[A-Za-z0-9]*$/, // P001, INV-2024, U42
  /^(?=.*\d)[A-Za-z0-9_-]{8,}$/, // mixed letters and digits, 8+
  /^[A-Za-z0-9_-]{20,}$/, // long opaque tokens
];
export function templateUrl(pathname: string): string {
  return pathname
    .split('/')
    .map(seg => (ID_SEGMENT.some(re => re.test(seg)) ? '{id}' : seg))
    .join('/') || '/';
}

export function classifyPage(doc: Document, elements: RawObservation['elements']): PageInfo['type_hint'] {
  const path = doc.location.pathname.toLowerCase();
  const title = doc.title.toLowerCase();
  const inputs = elements.filter(e => e.tag === 'input' || e.tag === 'textarea' || e.tag === 'select');
  if (elements.some(e => e.input_type === 'password')) return 'auth';
  if (/checkout|payment|shipping/.test(path + ' ' + title)) return 'checkout';
  if (/search|results|\?q=/.test(path + ' ' + doc.location.search)) return 'search';
  if (inputs.length >= 3) return 'form';
  if (doc.querySelectorAll('table, ul, ol').length >= 2 && elements.filter(e => e.tag === 'a').length > 8) return 'list';
  if (/product|item|order|patient|detail/.test(path)) return 'detail';
  return 'other';
}

function modalActive(doc: Document): boolean {
  return !!doc.querySelector('[role="dialog"][aria-modal="true"], dialog[open]');
}

function collectTextNodes(doc: Document, viewportW: number, viewportH: number, elementRects: Map<Element, string>): RawTextNode[] {
  const out: RawTextNode[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const text = node.textContent?.trim() ?? '';
      if (!text) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  let i = 0;
  while ((node = walker.nextNode()) && out.length < MAX_TEXT_NODES) {
    const parent = node.parentElement!;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportH || rect.left > viewportW) continue;
    let owner: Element | null = parent;
    let ownerId: string | null = null;
    while (owner) {
      const id = elementRects.get(owner);
      if (id) {
        ownerId = id;
        break;
      }
      owner = owner.parentElement;
    }
    out.push({
      id: `t${++i}`,
      rect: quantizeRect(rect),
      text: (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT_CHARS),
      owner_element_id: ownerId,
      source: 'dom',
    });
  }
  return out;
}

export async function observePage(input: { observationId: string; sessionId: string; step: number; maxElements?: number }): Promise<RawObservation> {
  const stability = await waitForFullStability();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const docH = Math.max(document.documentElement.scrollHeight, h);
  const walk = walkDocument({ w, h }, input.maxElements ?? 400);

  beginObservation(input.observationId);
  const elementIds = new Map<Element, string>();
  for (const el of walk.elements) {
    register(el.id, el.element);
    elementIds.set(el.element, el.id);
  }

  const elements: RawObservation['elements'] = walk.elements.map(el => ({
    id: el.id,
    id_hash: el.id_hash,
    tag: el.tag,
    role: el.role,
    type: el.type,
    label_raw: el.label,
    placeholder_raw: el.placeholder,
    rect: el.rect,
    visible: el.visible,
    enabled: el.enabled,
    focusable: el.focusable,
    value_state: el.value_state,
    options_count: el.options_count,
    group: el.group,
    frame: el.frame,
    unexplained: el.unexplained || undefined,
    autocomplete: el.autocomplete,
    input_type: el.input_type,
  }));

  const host = location.hostname;
  const page: PageInfo = {
    origin_class: host === 'localhost' || host === '127.0.0.1' ? 'benchmark' : 'external',
    url_template: templateUrl(location.pathname),
    title_raw: document.title,
    type_hint: classifyPage(document, elements),
    modal_active: modalActive(document),
    stability: stability.isStable ? 'stable' : 'timeout',
  };

  return {
    observation_id: input.observationId,
    session_id: input.sessionId,
    step: input.step,
    page,
    viewport: {
      w,
      h,
      scroll_y_pct: docH > h ? Math.round((window.scrollY / (docH - h)) * 100) : 0,
      doc_h_ratio: Math.round((docH / h) * 100) / 100,
      dpr: window.devicePixelRatio,
    },
    elements,
    text_nodes: collectTextNodes(document, w, h, elementIds),
    frames: walk.frames,
    truncated: walk.truncated,
    list_virtualized: false,
  };
}
