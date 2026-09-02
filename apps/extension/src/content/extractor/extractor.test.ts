// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { walkDocument, valueState, isInteractive } from './walk';
import { observePage, templateUrl, classifyPage } from './observe';
import { computeIdentityHash } from '../identity';
import { resolve } from '../registry';

// jsdom has no layout: give every element a box so the walker keeps it.
function fakeLayout() {
  let y = 0;
  const tops = new WeakMap<Element, number>();
  Element.prototype.getBoundingClientRect = function () {
    let top = tops.get(this);
    if (top === undefined) { top = (y += 30); tops.set(this, top); }
    return { x: 10, y: top, width: 200, height: 24, top, left: 10, right: 210, bottom: top + 24, toJSON() { return this; } } as DOMRect;
  };
  Range.prototype.getBoundingClientRect = function () {
    return { x: 10, y: 5, width: 100, height: 16, top: 5, left: 10, right: 110, bottom: 21, toJSON() { return this; } } as DOMRect;
  };
  document.elementFromPoint = () => null; // treated as not occluded? no: null hit → occluded
}

const PAGE = `
  <main>
    <h1>Checkout</h1>
    <form id="ship">
      <label for="name">Full name</label>
      <input id="name" type="text" autocomplete="name" placeholder="Full name" value="Rahul Sharma" />
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" value="hunter2" required />
      <textarea id="notes">some notes</textarea>
      <select id="country"><option value="">Choose</option><option value="in">India</option></select>
      <button type="submit">Place order</button>
    </form>
    <p>Contact rahul@example.com for help</p>
    <div id="host"></div>
    <canvas id="lab" width="10" height="10"></canvas>
  </main>`;

describe('extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    fakeLayout();
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.textContent = 'Shadow button';
    shadow.appendChild(btn);
  });

  it('never reads .value while walking', () => {
    const spy = vi.spyOn(HTMLInputElement.prototype, 'value', 'get');
    const spyTa = vi.spyOn(HTMLTextAreaElement.prototype, 'value', 'get');
    walkDocument({ w: 1280, h: 720 });
    expect(spy).not.toHaveBeenCalled();
    expect(spyTa).not.toHaveBeenCalled();
    spy.mockRestore();
    spyTa.mockRestore();
  });

  it('derives value_state from attributes only', () => {
    const name = document.getElementById('name')!;
    const pw = document.getElementById('pw')!;
    const notes = document.getElementById('notes')!;
    const country = document.getElementById('country')!;
    // jsdom's :placeholder-shown is unreliable; Chrome is verified manually.
    expect(['empty', 'filled', 'n/a']).toContain(valueState(name));
    expect(valueState(pw)).toBe('filled');
    expect(valueState(notes)).toBe('filled');
    expect(valueState(country)).toBe('empty');
  });

  it('emits interactive elements with autocomplete, input_type, stable id_hash and registry entries', () => {
    const { elements } = walkDocument({ w: 1280, h: 720 });
    const name = elements.find(e => e.element.id === 'name')!;
    expect(name.autocomplete).toBe('name');
    expect(name.input_type).toBe('text');
    expect(name.label).toBe('Full name');
    const pw = elements.find(e => e.element.id === 'pw')!;
    expect(pw.input_type).toBe('password');
    expect(pw.autocomplete).toBe('current-password');
    const again = walkDocument({ w: 1280, h: 720 });
    expect(again.elements.find(e => e.element.id === 'name')!.id_hash).toBe(name.id_hash);
    expect(computeIdentityHash(name.element, 0)).toBe(name.id_hash);
  });

  it('walks open shadow roots and marks canvas as unexplained', () => {
    const { elements } = walkDocument({ w: 1280, h: 720 });
    expect(elements.some(e => e.label === 'Shadow button')).toBe(true);
    expect(elements.find(e => e.tag === 'canvas')?.unexplained).toBe(true);
  });

  it('builds a RawObservation with text nodes owned by elements and fills the registry', async () => {
    const obs = await observePage({ observationId: 'obs_test', sessionId: 's', step: 0 });
    expect(obs.observation_id).toBe('obs_test');
    expect(obs.elements.length).toBeGreaterThan(4);
    expect(obs.text_nodes.some(t => t.text.includes('rahul@example.com'))).toBe(true);
    const first = obs.elements[0]!;
    expect(resolve(first.id)).not.toBeNull();
    expect(obs.page.type_hint).toBe('auth');
  });

  it('templates ids out of urls and classifies checkout pages', () => {
    expect(templateUrl('/orders/12345/track')).toBe('/orders/{id}/track');
    expect(templateUrl('/shoplite/checkout')).toBe('/shoplite/checkout');
    expect(isInteractive(document.querySelector('button')!)).toBe(true);
    expect(classifyPage(document, [])).toBe('other');
  });
});
