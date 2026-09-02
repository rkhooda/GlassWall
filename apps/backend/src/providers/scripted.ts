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
const SUBMIT_RE = /place order|submit|continue|proceed|next|confirm|pay now|checkout|save|apply|sign in|log in|register|send/i;
const FIELD_KEYWORDS: Array<{ re: RegExp; types: string[] }> = [
  { re: /e-?mail/i, types: ['EMAIL'] },
  { re: /phone|mobile|tel/i, types: ['PHONE'] },
  { re: /pin ?code|postal|zip/i, types: ['POSTAL_CODE'] },
  { re: /city|town|district/i, types: ['STREET_ADDRESS'] },
  { re: /state|province/i, types: ['STREET_ADDRESS'] },
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

/** Fields the planner already filled in this run (value_state may be n/a on pages without placeholders). */
function filledTargets(history: ActionEnvelope[]): Set<string> {
  const filled = new Set<string>();
  for (const h of history) if (h.action.type === 'TYPE') filled.add(h.action.target.id);
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
  const filled = filledTargets(history);
  const fields = observation.elements.filter(e => isTypeable(e) && !filled.has(e.id) && e.value_state !== 'filled' && !/search/i.test(e.label_raw + (e.type ?? '')));
  for (const field of fields) {
    // Payment fields are never filled by the agent unless the task says so.
    if (/CREDIT_CARD|CVC|OTP|PASSWORD/.test(field.sensitivity_class ?? '') && !/card|payment/i.test(input.task)) continue;
    const handle = pickHandle(field, handles, used);
    if (!handle) continue;
    return envelope({ type: 'TYPE', target: target(field), value: { kind: 'vault_ref', handle: handle.handle }, clear_first: true }, input, 'medium', `fill "${field.label_raw}" from ${handle.handle}`);
  }
  // Nothing left to fill: submit. A confirm dialog button wins over the page's submit.
  const dialogButton = observation.page.modal_active ? observation.elements.find(e => isClickable(e) && /confirm|yes|place|ok/i.test(e.label_raw)) : undefined;
  const submit = dialogButton ?? observation.elements.find(e => isClickable(e) && SUBMIT_RE.test(e.label_raw));
  if (submit) return envelope({ type: 'CLICK', target: target(submit) }, input, 'high', `submit via "${submit.label_raw}"`);
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

export function planScripted(input: PlanInput): ActionEnvelope {
  const task = input.task;
  const done = input.history.some(h => h.action.type === 'DONE');
  if (done) return envelope({ type: 'DONE', outcome: 'success' }, input, 'low', 'already done');
  // A form task ends when the page reports confirmation.
  if (/fill|form|checkout|shipping|address|submit|place|apply|register/i.test(task)) {
    if (/confirm|success|thank|placed|complete/i.test(observation(input).url_template + ' ' + observation(input).title_raw) && input.history.some(h => h.action.type === 'CLICK')) {
      return envelope({ type: 'DONE', outcome: 'success' }, input, 'low', 'confirmation page reached');
    }
    const next = fillForm(input);
    if (next) return next;
  }
  if (/search|find|look for|add .* cart|buy/i.test(task)) {
    const next = searchAndAdd(input);
    if (next) return next;
  }
  if (/order|status|track/i.test(task)) {
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
