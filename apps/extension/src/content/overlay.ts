// On-page overlay: numbered element boxes and redaction rectangles with reasons.
// Rendered in a closed shadow root so page CSS cannot restyle it, and marked with
// data-gw-overlay so the extractor ignores it on the next observation.
import type { SanitizedObservation } from '@glasswall/schema/observation';
import type { RedactionReason } from '@glasswall/schema/audit';

const HOST_ID = 'gw-overlay-host';
let host: HTMLElement | null = null;

function ensureHost(): ShadowRoot {
  if (host && host.isConnected) return host.shadowRoot!;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-gw-overlay', '1');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .el { position: fixed; border: 1.5px solid rgba(11, 92, 173, 0.85); border-radius: 3px; box-sizing: border-box; }
    .el span { position: absolute; top: -9px; left: -1px; background: #0b5cad; color: #fff; font: 600 10px/1 system-ui, sans-serif; padding: 2px 4px; border-radius: 3px; }
    .el.sensitive { border-color: rgba(180, 35, 24, 0.9); }
    .el.sensitive span { background: #b42318; }
    .red { position: fixed; background: repeating-linear-gradient(45deg, rgba(180,35,24,0.28) 0 6px, rgba(180,35,24,0.12) 6px 12px); border: 1.5px dashed #b42318; box-sizing: border-box; }
    .red span { position: absolute; left: 0; bottom: 100%; max-width: 320px; background: #b42318; color: #fff; font: 11px/1.3 system-ui, sans-serif; padding: 3px 6px; border-radius: 3px 3px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { position: fixed; right: 12px; bottom: 12px; background: #1f2328; color: #fff; font: 12px/1.4 system-ui, sans-serif; padding: 6px 10px; border-radius: 6px; }
  `;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return shadow;
}

export function showOverlay(observation: SanitizedObservation, redactions: RedactionReason[]): void {
  const shadow = ensureHost();
  Array.from(shadow.children).forEach(c => { if (c.tagName !== 'STYLE') c.remove(); });
  const frag = document.createDocumentFragment();

  for (const el of observation.elements) {
    if (!el.visible) continue;
    const box = document.createElement('div');
    box.className = 'el' + (el.sensitivity_class && el.sensitivity_class !== 'NONE' ? ' sensitive' : '');
    box.style.cssText = `left:${el.rect[0]}px;top:${el.rect[1]}px;width:${el.rect[2]}px;height:${el.rect[3]}px;`;
    const tag = document.createElement('span');
    tag.textContent = el.id;
    box.appendChild(tag);
    frag.appendChild(box);
  }
  for (const r of redactions) {
    const box = document.createElement('div');
    box.className = 'red';
    box.style.cssText = `left:${r.rect[0]}px;top:${r.rect[1]}px;width:${r.rect[2]}px;height:${r.rect[3]}px;`;
    const label = document.createElement('span');
    label.textContent = r.reason;
    box.appendChild(label);
    frag.appendChild(box);
  }
  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = `GLASSWALL · ${observation.elements.length} elements · ${redactions.length} redactions · step ${observation.step}`;
  frag.appendChild(badge);
  shadow.appendChild(frag);
}

export function clearOverlay(): void {
  host?.remove();
  host = null;
}
