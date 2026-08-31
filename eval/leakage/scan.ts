import { CapturedRequest } from './intercept';

export interface LeakFinding {
  secretType: string;
  secretValue: string;
  requestUrl: string;
  encoding: 'raw' | 'url' | 'base64' | 'base64url' | 'hex' | 'html-entity' | 'json' | '8-gram';
  position: number;
  matchedText: string;
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function generateEncodings(value: string): Map<string, string> {
  const encodings = new Map<string, string>();
  const normalized = value;

  encodings.set('raw', normalized.toLowerCase());
  encodings.set('url', encodeURIComponent(normalized).toLowerCase());
  encodings.set('url-double', encodeURIComponent(encodeURIComponent(normalized)).toLowerCase());

  const b64 = btoa(normalized).toLowerCase();
  encodings.set('base64', b64);
  encodings.set('base64url', b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''));

  let hex = '';
  for (let i = 0; i < normalized.length; i++) {
    hex += normalized.charCodeAt(i).toString(16).padStart(2, '0');
  }
  encodings.set('hex', hex.toLowerCase());

  let htmlEntities = '';
  for (let i = 0; i < normalized.length; i++) {
    htmlEntities += `&#${normalized.charCodeAt(i)};`;
  }
  encodings.set('html-entity', htmlEntities.toLowerCase());

  let jsonEscaped = '';
  for (let i = 0; i < normalized.length; i++) {
    jsonEscaped += `\\\\u${normalized.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  encodings.set('json', jsonEscaped.toLowerCase());

  return encodings;
}

function generateNgrams(text: string, n: number = 8): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.add(text.slice(i, i + n));
  }
  return ngrams;
}

function hasNgramOverlap(text: string, pattern: string, n: number = 8): { match: boolean; ngram: string; position: number } {
  if (pattern.length < n) return { match: false, ngram: '', position: -1 };

  const textNgrams = new Map<string, number[]>();
  for (let i = 0; i <= text.length - n; i++) {
    const ngram = text.slice(i, i + n);
    if (!textNgrams.has(ngram)) textNgrams.set(ngram, []);
    textNgrams.get(ngram)!.push(i);
  }

  const patternNgrams = generateNgrams(pattern, n);
  for (const ngram of patternNgrams) {
    const positions = textNgrams.get(ngram);
    if (positions && positions.length > 0) {
      return { match: true, ngram, position: positions[0] };
    }
  }
  return { match: false, ngram: '', position: -1 };
}

export function scanRequestsForSecrets(
  requests: CapturedRequest[],
  secrets: Record<string, string>
): LeakFinding[] {
  const findings: LeakFinding[] = [];

  for (const request of requests) {
    const fullText = `${request.url} ${JSON.stringify(request.headers)} ${request.body || ''}`;
    const normalizedText = normalize(fullText);

    for (const [secretType, secretValue] of Object.entries(secrets)) {
      const normalizedSecret = normalize(secretValue);
      if (normalizedSecret.length < 6) continue;

      const encodings = generateEncodings(secretValue);

      for (const [encodingName, encoded] of encodings) {
        const position = normalizedText.indexOf(encoded);
        if (position >= 0) {
          findings.push({
            secretType,
            secretValue,
            requestUrl: request.url,
            encoding: encodingName as LeakFinding['encoding'],
            position,
            matchedText: encoded.slice(0, 50),
          });
        }
      }

      if (normalizedSecret.length >= 8) {
        const ngramResult = hasNgramOverlap(normalizedText, normalizedSecret, 8);
        if (ngramResult.match) {
          findings.push({
            secretType,
            secretValue,
            requestUrl: request.url,
            encoding: '8-gram',
            position: ngramResult.position,
            matchedText: ngramResult.ngram,
          });
        }
      }
    }
  }

  return findings;
}

export function checkRequestsToUnauthorizedOrigins(
  requests: CapturedRequest[],
  allowedOrigin: string
): CapturedRequest[] {
  const unauthorized: CapturedRequest[] = [];

  for (const request of requests) {
    try {
      const url = new URL(request.url);
      if (url.origin !== allowedOrigin) {
        unauthorized.push(request);
      }
    } catch {
      unauthorized.push(request);
    }
  }

  return unauthorized;
}