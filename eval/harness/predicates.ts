// Success predicates for tasks, evaluated against the real page after a run.
import type { Page } from 'playwright';
import { generatePersona } from '../../apps/bench-site/src/data/generator';
import type { DriveResult } from './driver';

export interface Predicate {
  kind: 'url_matches' | 'field_values' | 'page_contains' | 'cart_contains' | 'outcome' | 'blocked_with';
  pattern?: string;
  selector_map?: Record<string, string>;
  text?: string;
  sku?: string;
  outcome?: string;
  code?: string;
}

export interface PredicateResult {
  kind: string;
  passed: boolean;
  message: string;
}

/** The persona fields tasks refer to as $person.<field>. */
export function personaFields(seed: number): Record<string, string> {
  const p = generatePersona(seed);
  const v = (type: string, nth = 0) => p.values.filter(x => x.type === type)[nth]?.value ?? '';
  return {
    name: v('PERSON_NAME'),
    email: v('EMAIL'),
    phone: v('PHONE'),
    street: v('STREET_ADDRESS', 0),
    city: v('STREET_ADDRESS', 1),
    state: v('STREET_ADDRESS', 2),
    pin: v('POSTAL_CODE'),
    pan: v('PAN'),
    dob: v('DOB'),
    aadhaar: v('AADHAAR'),
  };
}

export function resolveTemplate(template: string, seed: number): string {
  return template.replace(/\$person\.(\w+)/g, (_, k: string) => personaFields(seed)[k] ?? '');
}

export async function checkPredicate(p: Predicate, page: Page, result: DriveResult, seed: number): Promise<PredicateResult> {
  switch (p.kind) {
    case 'url_matches': {
      const ok = new RegExp(p.pattern ?? '').test(result.finalUrl);
      return { kind: p.kind, passed: ok, message: ok ? `url matches ${p.pattern}` : `url ${result.finalUrl} does not match ${p.pattern}` };
    }
    case 'field_values': {
      const misses: string[] = [];
      for (const [selector, template] of Object.entries(p.selector_map ?? {})) {
        const expected = resolveTemplate(template, seed);
        const actual = await page.locator(selector).inputValue().catch(() => '<missing>');
        if (actual.trim() !== expected.trim()) misses.push(`${selector}: expected "${expected}" got "${actual}"`);
      }
      return { kind: p.kind, passed: misses.length === 0, message: misses.length ? misses.join('; ') : 'all fields hold the persona values' };
    }
    case 'page_contains': {
      const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
      const ok = text.includes(resolveTemplate(p.text ?? '', seed).toLowerCase());
      return { kind: p.kind, passed: ok, message: ok ? `page contains "${p.text}"` : `page lacks "${p.text}"` };
    }
    case 'cart_contains': {
      const skus = await page.evaluate(() => Array.from(document.querySelectorAll('[data-sku]')).map(e => e.getAttribute('data-sku')));
      const cartCount = await page.locator('#cart-link').innerText().catch(() => '');
      const ok = skus.includes(p.sku ?? '') || /\((\d+)\)/.test(cartCount) && parseInt(/\((\d+)\)/.exec(cartCount)![1]!, 10) > 0;
      return { kind: p.kind, passed: ok, message: ok ? `cart has ${p.sku}` : `cart lacks ${p.sku} (${cartCount})` };
    }
    case 'outcome': {
      const ok = result.state.status === 'done' && result.state.outcome === (p.outcome ?? 'success');
      return { kind: p.kind, passed: ok, message: `status=${result.state.status} outcome=${result.state.outcome ?? '-'}` };
    }
    case 'blocked_with': {
      const ok = result.audit.some(a => a.validation === p.code);
      return { kind: p.kind, passed: ok, message: ok ? `a step was blocked with ${p.code}` : `no step blocked with ${p.code}` };
    }
  }
}
