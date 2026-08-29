export function generateEncodings(value: string): string[] {
  const encodings = new Set<string>();
  const normalized = value;

  encodings.add(normalized);

  encodings.add(encodeURIComponent(normalized));
  encodings.add(encodeURIComponent(encodeURIComponent(normalized)));

  encodings.add(btoa(normalized));
  encodings.add(btoa(normalized).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''));

  let hex = '';
  for (let i = 0; i < normalized.length; i++) {
    hex += normalized.charCodeAt(i).toString(16).padStart(2, '0');
  }
  encodings.add(hex);

  let htmlEntities = '';
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    htmlEntities += `&#${code};`;
  }
  encodings.add(htmlEntities);

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
    encodings.add(namedHtml);
  }

  let jsonEscaped = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    const code = ch.charCodeAt(0);
    jsonEscaped += `\\u${code.toString(16).padStart(4, '0')}`;
  }
  encodings.add(jsonEscaped);

  return Array.from(encodings);
}