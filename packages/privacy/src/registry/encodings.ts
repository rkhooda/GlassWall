/** Base64 of the UTF-8 bytes. btoa() alone throws outside Latin-1, and OCR text is not Latin-1. */
export function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function generateEncodings(value: string): string[] {
  const encodings = new Set<string>();
  const normalized = value;

  encodings.add(normalized.toLowerCase());

  encodings.add(encodeURIComponent(normalized).toLowerCase());
  encodings.add(encodeURIComponent(encodeURIComponent(normalized)).toLowerCase());

  const b64 = base64Utf8(normalized);
  encodings.add(b64.toLowerCase());
  encodings.add(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').toLowerCase());

  let hex = '';
  for (let i = 0; i < normalized.length; i++) {
    hex += normalized.charCodeAt(i).toString(16).padStart(2, '0');
  }
  encodings.add(hex.toLowerCase());

  let htmlEntities = '';
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    htmlEntities += `&#${code};`;
  }
  encodings.add(htmlEntities.toLowerCase());

  const namedEntities: Record<string, string> = {
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": '&apos;',
    '/': '&#x2F;',
  };
  let namedHtml = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    namedHtml += namedEntities[ch] || ch;
  }
  if (namedHtml !== normalized) {
    encodings.add(namedHtml.toLowerCase());
  }

  let jsonEscaped = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    const code = ch.charCodeAt(0);
    jsonEscaped += `\\\\u${code.toString(16).padStart(4, '0')}`;
  }
  encodings.add(jsonEscaped.toLowerCase());

  return Array.from(encodings);
}