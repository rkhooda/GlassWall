import { z } from 'zod';

export const RectSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Rect = z.infer<typeof RectSchema>;

export const ViewportSchema = z.object({
  w: z.number(),
  h: z.number(),
  scroll_y_pct: z.number(),
  doc_h_ratio: z.number(),
  dpr: z.number(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

export const PageInfoSchema = z.object({
  origin_class: z.enum(['internal', 'external', 'benchmark']),
  url_template: z.string(),
  title_raw: z.string(),
  type_hint: z.enum(['form', 'list', 'detail', 'auth', 'checkout', 'search', 'other']),
  modal_active: z.boolean(),
  stability: z.enum(['stable', 'timeout']),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

export const RawTextNodeSchema = z.object({
  id: z.string(),
  rect: RectSchema,
  text: z.string(),
  owner_element_id: z.string().nullable(),
  source: z.literal('dom'),
});
export type RawTextNode = z.infer<typeof RawTextNodeSchema>;

export const RawElementSchema = z.object({
  id: z.string(),
  id_hash: z.string(),
  tag: z.string(),
  role: z.string(),
  type: z.string().optional(),
  label_raw: z.string(),
  placeholder_raw: z.string().optional(),
  rect: RectSchema,
  visible: z.boolean(),
  enabled: z.boolean(),
  focusable: z.boolean(),
  value_state: z.enum(['empty', 'partial', 'filled', 'n/a']),
  options_count: z.number().optional(),
  group: z.string(),
  frame: z.number(),
  unexplained: z.boolean().optional(),
  autocomplete: z.string().optional(),
  input_type: z.string().optional(),
});
export type RawElement = z.infer<typeof RawElementSchema>;

export const FrameInfoSchema = z.object({
  id: z.number(),
  origin: z.enum(['same', 'cross']),
  rect: RectSchema,
});
export type FrameInfo = z.infer<typeof FrameInfoSchema>;

export const RawObservationSchema = z
  .object({
    observation_id: z.string(),
    session_id: z.string(),
    step: z.number(),
    page: PageInfoSchema,
    viewport: ViewportSchema,
    elements: z.array(RawElementSchema),
    text_nodes: z.array(RawTextNodeSchema),
    frames: z.array(FrameInfoSchema),
    truncated: z.boolean(),
    list_virtualized: z.boolean(),
  })
  .strict();
export type RawObservation = z.infer<typeof RawObservationSchema>;

export const CapturedFrameSchema = z.object({
  bitmap: z.unknown(),
  dpr: z.number(),
  viewport_w: z.number(),
  viewport_h: z.number(),
  captured_at: z.number(),
  stale: z.boolean(),
});
export type CapturedFrame = z.infer<typeof CapturedFrameSchema>;
