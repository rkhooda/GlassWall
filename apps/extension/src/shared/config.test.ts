import { describe, it, expect } from 'vitest';
import manifest from '../../manifest.json';
import { GATEWAY_ORIGIN, OFFSCREEN_URL } from './config';

describe('manifest agrees with config', () => {
  it('pins connect-src and host_permissions to the gateway origin only', () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain(`connect-src 'self' ${GATEWAY_ORIGIN}`);
    expect(manifest.host_permissions).toEqual([`${GATEWAY_ORIGIN}/*`]);
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>');
    expect(csp).toContain("'wasm-unsafe-eval'");
  });
  it('declares the pages the worker opens', () => {
    expect(manifest.side_panel.default_path).toBe('src/sidepanel/index.html');
    expect(OFFSCREEN_URL).toBe('src/offscreen/offscreen.html');
    expect(manifest.content_scripts[0]!.js).toEqual(['src/content/index.ts']);
  });
});
