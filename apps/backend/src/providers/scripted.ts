// The scripted planner: a deterministic, network-free reasoner used as the last link
// in the failover chain and as demo-day insurance. It is not a script for one page:
// it reads the sanitized observation the same way a model would (labels, roles,
// autocomplete classes, the handle inventory) and handles the common shapes of a
// task — fill a form, search and add to cart, look something up — on pages it has
// never seen. Anything else ends with DONE/impossible, honestly.
import type { SanitizedObservation, SanitizedElement } from '@glasswall/schema/observation';
import type { Action, ActionEnvelope } from '@glasswall/schema/action';
import type { PlanInput, Provider } from './types';

type Handle = { handle: string; type: string; tier: number };

const TYPEABLE = new Set(['text', 'email', 'tel', 'search', 'url', 'number', undefined]);
const SUBMIT_RE = /place order|submit|continue|proceed|next|review|confirm|pay now|checkout|save|apply|sign in|log in|register|send|finish/i;
const FIELD_KEYWORDS: Array<{ re: RegExp; types: string[] }> = [
  { re: /e-?mail/i, types: ['EMAIL'] },
  { re: /phone|mobile|tel/i, types: ['PHONE'] },
  { re: /pin ?code|postal|zip/i, types: ['POSTAL_CODE'] },
  { re: /city|town|district/i, types: ['CITY'] },
  { re: /state|province/i, types: ['STATE'] },
  { re: /address|street|house|line ?1/i, types: ['STREET_ADDRESS'] },
  { re: /aadhaar|uid/i, types: ['AADHAAR'] },
  { re: /\bpan\b/i, types: ['PAN'] },
  { re: /full name|^name$|first name|last name|your name/i, types: ['PERSON_NAME'] },
  { re: /birth|dob/i, types: ['DOB'] },
];
const CLASS_TO_HANDLE_TYPES: Record<string, string[]> = {
  EMAIL: ['EMAIL'],
  PHONE: ['PHONE'],
  PERSON_NAME: ['PERSON_NAME'],
  STREET_ADDRESS: ['STREET_ADDRESS'],
  CITY: ['CITY'],
  STATE: ['STATE'],
  POSTAL_CODE: ['POSTAL_CODE'],
  AADHAAR: ['AADHAAR'],
  PAN: ['PAN'],
  DOB: ['DOB'],
};

const visible = (e: SanitizedElement) => e.visible && e.enabled;
const isTypeable = (e: SanitizedElement) => visible(e) && e.focusable && ((e.tag === 'input' && TYPEABLE.has(e.type)) || e.tag === 'textarea');
const isClickable = (e: SanitizedElement) => visible(e) && (e.tag === 'button' || e.tag === 'a' || e.role === 'button' || e.role === 'link' || e.type === 'submit');

function envelope(action: Action, input: PlanInput, risk: ActionEnvelope['risk'], reasoning: string): ActionEnvelope {
  return {
    action,
    observation_id: input.observation.observation_id,
    step_index: input.stepIndex,
    session_id: input.sessionId,
    risk,
    requires_confirmation: risk === 'high',
    reasoning: `scripted: ${reasoning}`,
  };
}

const target = (e: SanitizedElement) => ({ id: e.id, id_hash: e.id_hash });

/** Handles the planner already typed somewhere, so #1/#2 of the same type are used in order. */
function usedHandles(history: ActionEnvelope[]): Set<string> {
  const used = new Set<string>();
  for (const h of history) if (h.action.type === 'TYPE' && h.action.value.kind === 'vault_ref') used.add(h.action.value.handle);
  return used;
}

/**
 * Fields the planner already filled in this run, keyed by what they are rather than
 * by id: element ids are renumbered on every observation, and value_state may be
 * n/a on pages whose inputs have no placeholder.
 */
const fieldKey = (e: SanitizedElement) => `${e.sensitivity_class ?? ''}|${e.label_raw.toLowerCase()}|${e.type ?? ''}`;
function filledFields(history: ActionEnvelope[]): Set<string> {
  const filled = new Set<string>();
  for (const h of history) if (h.action.type === 'TYPE' && /^scripted: fill \[(.+)\]/.test(h.reasoning ?? '')) filled.add(/^scripted: fill \[(.+?)\]/.exec(h.reasoning!)![1]!);
  return filled;
}

function pickHandle(field: SanitizedElement, handles: Handle[], used: Set<string>): Handle | null {
  const wanted = new Set<string>();
  const cls = field.sensitivity_class;
  if (cls && CLASS_TO_HANDLE_TYPES[cls]) CLASS_TO_HANDLE_TYPES[cls]!.forEach(t => wanted.add(t));
  const text = `${field.label_raw} ${field.placeholder_raw ?? ''} ${field.autocomplete ?? ''}`;
  for (const { re, types } of FIELD_KEYWORDS) if (re.test(text)) types.forEach(t => wanted.add(t));
  if (wanted.size === 0) return null;
  // Handles are numbered in the order they were seen on the page: address before
  // city before state, so "next unused of this type" follows the saved-details card.
  const candidates = handles.filter(h => wanted.has(h.type)).sort((a, b) => a.handle.localeCompare(b.handle, undefined, { numeric: true }));
  return candidates.find(h => !used.has(h.handle)) ?? candidates[0] ?? null;
}

function fillForm(input: PlanInput): ActionEnvelope | null {
  const { observation, history } = input;
  const handles = (observation.handles ?? []) as Handle[];
  const used = usedHandles(history);
  const filled = filledFields(history);
  const fields = observation.elements.filter(e => isTypeable(e) && !filled.has(fieldKey(e)) && e.value_state !== 'filled' && !/search/i.test(e.label_raw + (e.type ?? '')));
  for (const field of fields) {
    // Payment fields are never filled by the agent unless the task says so.
    if (/CREDIT_CARD|CVC|OTP|PASSWORD/.test(field.sensitivity_class ?? '') && !/card|payment/i.test(input.task)) continue;
    const handle = pickHandle(field, handles, used);
    if (!handle) continue;
    return envelope({ type: 'TYPE', target: target(field), value: { kind: 'vault_ref', handle: handle.handle }, clear_first: true }, input, 'medium', `fill [${fieldKey(field)}] "${field.label_raw}" from ${handle.handle}`);
  }
  // Nothing left to fill: submit. A confirm dialog button wins over the page's submit.
  const dialogButton = observation.page.modal_active ? observation.elements.find(e => isClickable(e) && /confirm|yes|place|ok/i.test(e.label_raw)) : undefined;
  const submit = dialogButton ?? observation.elements.find(e => isClickable(e) && SUBMIT_RE.test(e.label_raw));
  if (submit) return envelope({ type: 'CLICK', target: target(submit) }, input, 'high', `submit via "${submit.label_raw}"`);
  // Nothing fillable and no submit in view: the rest of the form is below the fold.
  const scrolls = history.filter(h => h.action.type === 'SCROLL').length;
  if (scrolls < 4 && observation.viewport.scroll_y_pct < 100 && observation.viewport.doc_h_ratio > 1.05) {
    return envelope({ type: 'SCROLL', direction: 'down', amount: 1 }, input, 'low', 'look below the fold for more fields or the submit button');
  }
  return null;
}

function searchAndAdd(input: PlanInput): ActionEnvelope | null {
  const { observation, history, task } = input;
  const query = (task.match(/(?:search for|find|look for)\s+(.+?)(?:\s+(?:and|under|below|then)\b|,|$)/i)?.[1] ?? '').trim();
  const searched = history.some(h => h.action.type === 'TYPE' && h.action.value.kind === 'literal');
  const submitted = history.some(h => h.action.type === 'PRESS_KEY' || (h.action.type === 'CLICK' && /search/i.test(h.reasoning ?? '')));
  const added = history.some(h => h.action.type === 'CLICK' && /add/i.test(h.reasoning ?? ''));
  const box = observation.elements.find(e => isTypeable(e) && (e.type === 'search' || e.role === 'searchbox' || /search/i.test(e.label_raw + (e.placeholder_raw ?? ''))));
  if (query && !searched && box) return envelope({ type: 'TYPE', target: target(box), value: { kind: 'literal', text: query }, clear_first: true }, input, 'low', `search "${query}"`);
  if (searched && !submitted && box) return envelope({ type: 'PRESS_KEY', key: 'Enter', target: target(box) }, input, 'low', 'submit search');
  if (/add|cart|buy/i.test(task) && !added) {
    const add = observation.elements.find(e => isClickable(e) && /\badd\b.*\b(cart|bag|basket)\b|\bbuy\b/i.test(e.label_raw));
    if (add) return envelope({ type: 'CLICK', target: target(add) }, input, 'medium', `add via "${add.label_raw}"`);
    if (submitted) return envelope({ type: 'SCROLL', direction: 'down', amount: 1 }, input, 'low', 'look for an add-to-cart button');
  }
  if (added || (searched && !/add|cart|buy/i.test(task))) return envelope({ type: 'DONE', outcome: 'success' }, input, 'low', 'search task complete');
  return null;
}

function lookup(input: PlanInput): ActionEnvelope | null {
  const { observation, history, task } = input;
  const want = (task.match(/(?:order|status|track(?:ing)?)\s+(?:for|of)?\s*(?:the|my)?\s*([\w ]+?)(?:\s+and|,|$)/i)?.[1] ?? '').trim().toLowerCase();
  const onOrders = /order/i.test(observation.page.url_template);
  if (!onOrders) {
    const link = observation.elements.find(e => isClickable(e) && /orders?/i.test(e.label_raw));
    if (link && !history.some(h => h.action.type === 'CLICK')) return envelope({ type: 'CLICK', target: target(link) }, input, 'low', 'open orders');
  }
  const row = observation.text_nodes.find(t => want && t.text.toLowerCase().includes(want));
  if (row) return envelope({ type: 'DONE', outcome: 'success', evidence_element: row.owner_element_id ?? undefined }, input, 'low', `found "${want}"`);
  if (onOrders && history.filter(h => h.action.type === 'SCROLL').length < 3) return envelope({ type: 'SCROLL', direction: 'down', amount: 1 }, input, 'low', 'scan orders');
  return null;
}

/** "Open the first patient's record", "click Orders", "go to my account": click the best-matching control. */
function openSomething(input: PlanInput): ActionEnvelope | null {
  const { observation, history, task } = input;
  const phrase = (task.match(/(?:open|click|go to|view|show)\s+(?:the\s+|my\s+|on\s+)?(.+?)(?:\s+(?:page|link|button|tab|section))?\s*$/i)?.[1] ?? '').toLowerCase();
  if (!phrase) return null;
  if (history.some(h => h.action.type === 'CLICK')) return envelope({ type: 'DONE', outcome: 'success' }, input, 'low', `opened "${phrase}"`);
  const words = phrase.split(/\s+/).filter(w => w.length > 2 && !/^(first|the|a|an|of|for|this|that)$/i.test(w));
  const scored = observation.elements
    .filter(isClickable)
    .map(e => ({ e, score: words.filter(w => e.label_raw.toLowerCase().includes(w)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const pick = scored[0]?.e ?? (/first|record|patient|view|details/.test(phrase) ? observation.elements.find(e => isClickable(e) && /view|open|details/i.test(e.label_raw)) : undefined);
  if (!pick) return null;
  return envelope({ type: 'CLICK', target: target(pick) }, input, 'low', `open via "${pick.label_raw}"`);
}

export function planScripted(input: PlanInput): ActionEnvelope {
  const task = input.task;
  const done = input.history.some(h => h.action.type === 'DONE');
  if (done) return envelope({ type: 'DONE', outcome: 'success' }, input, 'low', 'already done');
  if (/^(open|click|go to|view|show)\b/i.test(task.trim())) {
    const next = openSomething(input);
    if (next) return next;
  }
  // A form task ends when the page reports confirmation.
  if (/fill|form|checkout|shipping|address|submit|place|apply|register/i.test(task)) {
    if (/confirm|success|thank|placed|complete|submitted/i.test(observation(input).url_template + ' ' + observation(input).title_raw + ' ' + input.observation.text_nodes.slice(0, 6).map(t => t.text).join(' ')) && input.history.some(h => h.action.type === 'CLICK')) {
      return envelope({ type: 'DONE', outcome: 'success' }, input, 'low', 'confirmation page reached');
    }
    const next = fillForm(input);
    if (next) return next;
  }
  if (/search|find|look for|add .* cart|buy/i.test(task)) {
    const next = searchAndAdd(input);
    if (next) return next;
  }
  if (/order status|track|where is|find my order|status of/i.test(task)) {
    const next = lookup(input);
    if (next) return next;
  }
  return envelope({ type: 'DONE', outcome: 'impossible' }, input, 'low', 'no scripted strategy matches this task and page');
}

const observation = (i: PlanInput): SanitizedObservation['page'] => i.observation.page;

export const scriptedProvider: Provider = {
  name: 'scripted',
  vision: false,
  available: async () => ({ ok: true, detail: 'deterministic planner, no network' }),
  plan: async input => planScripted(input),
};
