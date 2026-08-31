import { describe, expect, it, vi, afterEach } from 'vitest';
import { chunkText, chunkedNer, joinTextNodes, mapSpansToRanges, mergeSpans, type Span } from './chunk';
import { nerTypeToPii } from './types';

/** Stand-in model: deterministic, offline, finds the two halves of one name. */
const fakeModel = (chunk: string): Promise<Span[]> => {
  const spans: Span[] = [];
  for (const m of chunk.matchAll(/Priya|Raghunathan|Bengaluru/g)) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      type: m[0] === 'Bengaluru' ? 'LOC' : 'PER',
      confidence: m[0] === 'Bengaluru' ? 0.4 : 0.95,
    });
  }
  return Promise.resolve(spans);
};

const words = (n: number, w = 'lorem') => Array.from({ length: n }, () => w).join(' ');

describe('chunking', () => {
  it('returns the whole text as one chunk when it fits', () => {
    const chunks = chunkText('Priya lives here', 512, 64);
    expect(chunks).toEqual([{ text: 'Priya lives here', offset: 0 }]);
  });

  it('reports offsets that index exactly back into the source', () => {
    const text = words(600);
    for (const chunk of chunkText(text, 512, 64)) {
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text);
    }
  });

  it('overlaps consecutive chunks by the requested token count', () => {
    const text = words(300);
    const [first, second] = chunkText(text, 100, 64);
    const firstWords = first!.text.split(/\s+/).length;
    const advanced = text.slice(first!.offset, second!.offset).split(/\s+/).filter(Boolean).length;
    expect(firstWords).toBe(100);
    expect(firstWords - advanced).toBe(64);
  });

  it('emits no chunks for blank text', () => {
    expect(chunkText('   ', 512, 64)).toEqual([]);
  });
});

describe('span merging', () => {
  it('joins touching spans of the same type', () => {
    const merged = mergeSpans([
      { start: 0, end: 5, type: 'PER', confidence: 0.9 },
      { start: 6, end: 17, type: 'PER', confidence: 0.8 },
    ]);
    expect(merged).toEqual([{ start: 0, end: 17, type: 'PER', confidence: 0.9 }]);
  });

  it('keeps different types apart', () => {
    const merged = mergeSpans([
      { start: 0, end: 5, type: 'PER', confidence: 0.9 },
      { start: 6, end: 11, type: 'LOC', confidence: 0.8 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('keeps distant spans of the same type apart', () => {
    const merged = mergeSpans([
      { start: 0, end: 5, type: 'PER', confidence: 0.9 },
      { start: 40, end: 45, type: 'PER', confidence: 0.8 },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('chunk boundary', () => {
  // The named acceptance test: an entity split across a hard chunk boundary
  // must come back as one span, in source coordinates.
  it('recovers an entity straddling a boundary as a single span', async () => {
    const text = `${words(9)} Priya Raghunathan ${words(9)}`;
    const chunks = chunkText(text, 10, 0);
    expect(chunks[0]!.text.includes('Raghunathan')).toBe(false);
    expect(chunks[1]!.text.includes('Priya')).toBe(false);

    const spans = await chunkedNer(text, fakeModel, { maxTokens: 10, overlapTokens: 0 });
    const person = spans.filter(s => s.type === 'PER');
    expect(person).toHaveLength(1);
    expect(text.slice(person[0]!.start, person[0]!.end)).toBe('Priya Raghunathan');
  });

  it('does not double-report an entity seen in two overlapping chunks', async () => {
    const text = `${words(60)} Priya Raghunathan ${words(60)}`;
    const spans = await chunkedNer(text, fakeModel, { maxTokens: 40, overlapTokens: 20 });
    expect(spans.filter(s => s.type === 'PER')).toHaveLength(1);
  });
});

describe('fixed-input regression', () => {
  const text = 'Priya Raghunathan of Bengaluru filed the form.';

  it('produces identical spans across runs', async () => {
    const a = await chunkedNer(text, fakeModel);
    const b = await chunkedNer(text, fakeModel);
    expect(a).toEqual(b);
    expect(a).toEqual([
      { start: 0, end: 17, type: 'PER', confidence: 0.95 },
      { start: 21, end: 30, type: 'LOC', confidence: 0.4 },
    ]);
  });

  it('drops spans under the confidence threshold', async () => {
    const spans = await chunkedNer(text, fakeModel, { threshold: 0.5 });
    expect(spans.map(s => s.type)).toEqual(['PER']);
  });
});

describe('span to text-node mapping', () => {
  const nodes = [
    { id: 'tn1', text: 'Priya Raghunathan', rect: [0, 0, 100, 20] as [number, number, number, number] },
    { id: 'tn2', text: 'lives in Bengaluru', rect: [0, 25, 120, 20] as [number, number, number, number] },
  ];

  it('reports offsets that index back into each node', () => {
    const { text, ranges } = joinTextNodes(nodes);
    expect(text).toBe('Priya Raghunathan lives in Bengaluru');
    for (const range of ranges) {
      expect(text.slice(range.start, range.end)).toBe(nodes.find(n => n.id === range.id)!.text);
    }
  });

  it('maps spans to the owning node in local coordinates', () => {
    const { ranges } = joinTextNodes(nodes);
    const mapped = mapSpansToRanges([{ start: 27, end: 36, type: 'LOC', confidence: 0.9 }], ranges);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.id).toBe('tn2');
    expect(nodes[1]!.text.slice(mapped[0]!.spans[0]!.start, mapped[0]!.spans[0]!.end)).toBe('Bengaluru');
  });

  it('clips a span crossing two nodes into both, carrying each rect', () => {
    const { ranges } = joinTextNodes(nodes);
    const mapped = mapSpansToRanges([{ start: 6, end: 22, type: 'PER', confidence: 0.9 }], ranges);
    expect(mapped.map(m => m.id)).toEqual(['tn1', 'tn2']);
    expect(mapped[0]!.rect).toEqual(nodes[0]!.rect);
    expect(mapped[1]!.spans[0]!.start).toBe(0);
  });
});

describe('label mapping', () => {
  it('maps model labels to coarse advisory PII types', () => {
    expect(nerTypeToPii('PER')).toBe('NAME');
    expect(nerTypeToPii('B-LOC')).toBe('PERSONAL');
    expect(nerTypeToPii('LOC')).toBe('ADDRESS');
    expect(nerTypeToPii('WHATEVER')).toBe('PERSONAL');
  });

  it('never promotes a label to a Tier 1 type', () => {
    const tier1: string[] = ['PASSWORD', 'API_KEY', 'TOKEN'];
    for (const label of ['PER', 'LOC', 'ORG', 'MISC', 'MONEY', 'GPE']) {
      expect(tier1).not.toContain(nerTypeToPii(label));
    }
  });
});

describe('offline guarantee', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('locks transformers.js to bundled assets', async () => {
    const { env } = await import('@huggingface/transformers');
    const { MODEL_BASE_URL, ORT_WASM_BASE_URL } = await import('./wrapper');

    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.useBrowserCache).toBe(false);
    expect(env.localModelPath).toBe(MODEL_BASE_URL);
    expect(env.backends.onnx.wasm!.wasmPaths).toBe(ORT_WASM_BASE_URL);
    expect(MODEL_BASE_URL.startsWith('http')).toBe(false);
    expect(ORT_WASM_BASE_URL.startsWith('http')).toBe(false);
  });

  it('reaches no remote host when the model is missing', async () => {
    // The "unplug the network" proof: any request at all is recorded, and a
    // request to a remote host fails the test rather than silently succeeding.
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      seen.push(String(input));
      return Promise.reject(new Error('network disconnected'));
    }));

    const { loadNerModel, disposeNer } = await import('./wrapper');
    disposeNer();
    await expect(loadNerModel('wasm')).rejects.toThrow();

    expect(seen.filter(url => /^https?:/i.test(url))).toEqual([]);
  });
});
