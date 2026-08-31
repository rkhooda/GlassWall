import type { PerceptionSource } from '@glasswall/privacy';
import { ocrSource } from './ocr';
import { nerSource } from './ner';

/**
 * The perception sources sanitize() should run, in order. OCR first so its text
 * is available to later sources; every source is individually failable and every
 * failure adds redaction rather than removing it.
 *
 * A: pass this as `perceptionSources` in the orchestrator's sanitize() call.
 */
export const perceptionSources: PerceptionSource[] = [ocrSource, nerSource];

export { nerSource, ocrSource };
export { getOcrStats } from './ocr';
