import type { RawElement, RawObservation } from '@glasswall/schema/observation';

/**
 * OCR is targeted, never full-page. This module decides which regions the DOM
 * cannot explain, and enforces the crop budget in code — the cap lives in
 * `selectCrops`, so no caller can opt out of it.
 */

export const MAX_CROPS_PER_STEP = 6;
export const MAX_CROP_LONGEST_SIDE = 512;

export type Rect = [number, number, number, number];

export interface UnexplainedRegion {
  rect: Rect;
  reason: string;
  area: number;
  suspicion: number;
}

export interface CropGeometry {
  /** Source rect in viewport (CSS) coordinates. */
  rect: Rect;
  /** Downscale applied to reach MAX_CROP_LONGEST_SIDE; <= 1. */
  scale: number;
  /** Crop bitmap size after scaling. */
  width: number;
  height: number;
}

const OPAQUE_TAGS = new Set(['canvas', 'img', 'svg', 'video', 'object', 'embed']);

/** Regions the DOM cannot account for: opaque media, unexplained elements, cross-origin frames. */
export function findUnexplainedRegions(raw: RawObservation): UnexplainedRegion[] {
  const regions: UnexplainedRegion[] = [];
  const seen = new Set<string>();

  const add = (rect: Rect, reason: string, suspicion: number) => {
    const key = rect.join(',');
    if (seen.has(key) || rect[2] <= 0 || rect[3] <= 0) return;
    seen.add(key);
    regions.push({ rect, reason, area: rect[2] * rect[3], suspicion });
  };

  for (const el of raw.elements) {
    if (!el.visible) continue;
    if (el.unexplained) add(el.rect, 'unexplained_element', suspicionOf(el));
    else if (OPAQUE_TAGS.has(el.tag.toLowerCase())) add(el.rect, `opaque_${el.tag.toLowerCase()}`, suspicionOf(el));
  }

  for (const frame of raw.frames) {
    if (frame.origin === 'cross') add(frame.rect, 'cross_origin_iframe', 0.9);
  }

  return regions;
}

function suspicionOf(el: RawElement): number {
  let score = 0.3;
  const tag = el.tag.toLowerCase();
  if (tag === 'canvas') score += 0.3;
  else if (tag === 'img' || tag === 'svg') score += 0.2;
  if (el.type === 'password') score += 0.3;
  if (/address|name|email|tel|cc-/.test(el.autocomplete ?? '')) score += 0.2;
  return Math.min(1, score);
}

/**
 * Apply the budget. Regions that do not fit stay `deferred` — the caller must mark
 * them unexplained so they are masked. Dropping a region never means passing it.
 */
export function selectCrops(
  regions: UnexplainedRegion[],
  budget: number = MAX_CROPS_PER_STEP
): { crops: UnexplainedRegion[]; deferred: UnexplainedRegion[] } {
  // Largest area first, suspicion breaks ties. Ordering is a utility choice only:
  // whatever the budget excludes is masked anyway, so it cannot cost us privacy.
  const ranked = [...regions].sort((a, b) => b.area - a.area || b.suspicion - a.suspicion);
  return { crops: ranked.slice(0, budget), deferred: ranked.slice(budget) };
}

/** Clamp a region to the viewport and compute the downscale that honours the side cap. */
export function cropGeometry(rect: Rect, viewportW: number, viewportH: number): CropGeometry {
  const x = Math.max(0, Math.min(rect[0], viewportW - 1));
  const y = Math.max(0, Math.min(rect[1], viewportH - 1));
  const w = Math.max(1, Math.min(rect[2], viewportW - x));
  const h = Math.max(1, Math.min(rect[3], viewportH - y));

  const scale = Math.min(1, MAX_CROP_LONGEST_SIDE / Math.max(w, h));
  return {
    rect: [x, y, w, h],
    scale,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Crop-pixel box back to viewport coordinates. Inverse of `cropGeometry`'s scaling. */
export function boxToViewport(
  box: { x0: number; y0: number; x1: number; y1: number },
  geometry: CropGeometry
): Rect {
  const [ox, oy] = geometry.rect;
  const s = geometry.scale;
  return [ox + box.x0 / s, oy + box.y0 / s, (box.x1 - box.x0) / s, (box.y1 - box.y0) / s];
}

export const NO_UNEXPLAINED_CROPS = 'no_unexplained_crops';

/** Non-null when OCR should not run at all; the skip is itself a result. */
export function ocrSkipReason(raw: RawObservation): string | null {
  return findUnexplainedRegions(raw).length === 0 ? NO_UNEXPLAINED_CROPS : null;
}
