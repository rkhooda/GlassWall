import { Page, Request, Response } from '@playwright/test';

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timestamp: number;
}

let capturedRequests: CapturedRequest[] = [];

export function installRequestInterceptor(page: Page): void {
  capturedRequests = [];

  page.on('request', (request: Request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome-extension:')) {
      return;
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.allHeaders())) {
      headers[key.toLowerCase()] = value;
    }

    let body: string | null = null;
    try {
      const postData = request.postData();
      if (postData) {
        body = postData;
      }
    } catch {
      body = null;
    }

    capturedRequests.push({
      url,
      method: request.method(),
      headers,
      body,
      timestamp: Date.now(),
    });
  });
}

export function getCapturedRequests(): CapturedRequest[] {
  return [...capturedRequests];
}

export function clearCapturedRequests(): void {
  capturedRequests = [];
}

export function findRequestsToOrigin(origin: string): CapturedRequest[] {
  return capturedRequests.filter(req => {
    try {
      const url = new URL(req.url);
      return url.origin === origin;
    } catch {
      return false;
    }
  });
}

export function findRequestsNotToOrigin(origin: string): CapturedRequest[] {
  return capturedRequests.filter(req => {
    try {
      const url = new URL(req.url);
      return url.origin !== origin;
    } catch {
      return true;
    }
  });
}