import { describe, it, expect } from 'vitest';
import { ipRecognizer } from './ip';

describe('ipRecognizer', () => {
  const positiveV4Cases = [
    '192.168.1.1',
    '10.0.0.1',
    '172.16.0.1',
    '8.8.8.8',
    '255.255.255.255',
    '1.2.3.4',
  ];

  const negativeV4Cases = [
    '256.1.1.1',
    '1.2.3',
    '1.2.3.4.5',
    'abc.def.ghi.jkl',
  ];

  const positiveV6Cases = [
    '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
    '::1',
    'fe80::1',
    '2001:db8::1',
  ];

  const negativeV6Cases = [
    '2001:0db8:85a3:0000:0000:8a2e:0370',
    'gggg::1',
  ];

  for (const tc of positiveV4Cases) {
    it(`detects valid IPv4: ${tc}`, () => {
      const spans = ipRecognizer.detect(tc);
      expect(spans.length).toBe(1);
      expect(spans[0].value).toBe(tc);
      expect(spans[0].type).toBe('IP');
      expect(spans[0].tier).toBe(3);
    });
  }

  for (const tc of negativeV4Cases) {
    it(`rejects invalid IPv4: ${tc}`, () => {
      const spans = ipRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  for (const tc of positiveV6Cases) {
    it(`detects valid IPv6: ${tc}`, () => {
      const spans = ipRecognizer.detect(tc);
      expect(spans.length).toBeGreaterThanOrEqual(1);
      const match = spans.find(s => s.value === tc);
      expect(match).toBeDefined();
      expect(match!.type).toBe('IP');
      expect(match!.tier).toBe(3);
    });
  }

  for (const tc of negativeV6Cases) {
    it(`rejects invalid IPv6: ${tc}`, () => {
      const spans = ipRecognizer.detect(tc);
      expect(spans.length).toBe(0);
    });
  }

  it('finds IP in text', () => {
    const text = 'Server IP is 192.168.1.1 for connection';
    const spans = ipRecognizer.detect(text);
    expect(spans.length).toBe(1);
    expect(spans[0].value).toBe('192.168.1.1');
  });

  it('does not match embedded', () => {
    const spans = ipRecognizer.detect('prefix192.168.1.1suffix');
    expect(spans.length).toBe(0);
  });
});