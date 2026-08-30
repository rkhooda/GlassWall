import { chromium, Browser, BrowserContext, Page, CDPSession } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

declare global {
  interface Window {
    __GLASSWALL_READY__?: Record<string, boolean>;
    __GLASSWALL_STEP_COMPLETE__?: Record<string, boolean>;
    __GLASSWALL_LAST_TRACE__?: Record<string, any>;
    __GLASSWALL_TRACE__?: Record<string, any[]>;
  }
  namespace chrome {
    namespace runtime {
      function sendMessage(extensionId: string, message: any, callback: (response: any) => void): void;
      const lastError: { message: string } | undefined;
    }
  }
}

export interface ExtensionContext {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  extensionId: string;
  cdpSession: CDPSession;
}

export interface DriverConfig {
  extensionPath: string;
  headless?: boolean | 'new';
  slowMo?: number;
  viewport?: { width: number; height: number };
  userDataDir?: string;
}

const DEFAULT_CONFIG: Required<DriverConfig> = {
  extensionPath: '',
  headless: 'new',
  slowMo: 0,
  viewport: { width: 1280, height: 720 },
  userDataDir: '',
};

export async function launchExtension(config: DriverConfig): Promise<ExtensionContext> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (!mergedConfig.extensionPath) {
    throw new Error('extensionPath is required');
  }

  const absExtensionPath = path.resolve(mergedConfig.extensionPath);
  if (!fs.existsSync(absExtensionPath)) {
    throw new Error(`Extension path does not exist: ${absExtensionPath}`);
  }

  const userDataDir = mergedConfig.userDataDir || 
    path.join(process.cwd(), '.eval-profile-' + Date.now());

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: mergedConfig.headless as boolean | undefined,
    slowMo: mergedConfig.slowMo,
    args: [
      `--disable-extensions-except=${absExtensionPath}`,
      `--load-extension=${absExtensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--enable-automation=false',
    ],
    viewport: mergedConfig.viewport,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = await context.newPage();
  
  const extensionId = await getExtensionId(context, absExtensionPath);
  
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Network.enable');
  await cdpSession.send('Performance.enable');
  // Memory domain may not be available in all Chrome versions
  try {
    await (cdpSession as any).send('Memory.enable');
  } catch {
    // Ignore if Memory domain is not available
  }

  await page.waitForLoadState('domcontentloaded');

  return {
    browser: context.browser()!,
    context,
    page,
    extensionId,
    cdpSession,
  };
}

async function getExtensionId(context: BrowserContext, extensionPath: string): Promise<string> {
  const backgroundPages = context.backgroundPages();
  if (backgroundPages.length > 0) {
    const firstPage = backgroundPages[0];
    if (firstPage) {
      const url = firstPage.url();
      const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
      if (match && match[1]) return match[1];
    }
  }

  for (const page of context.pages()) {
    const url = page.url();
    const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
    if (match && match[1]) return match[1];
  }

  throw new Error('Could not determine extension ID');
}

export async function closeExtension(context: ExtensionContext): Promise<void> {
  await context.cdpSession.detach();
  await context.context.close();
}

export async function navigateToTask(page: Page, url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'): Promise<void> {
  await page.goto(url, { waitUntil, timeout: 30000 });
}

export async function injectScript(page: Page, script: string): Promise<void> {
  await page.addInitScript(script);
}

export async function evaluateOnPage<T>(page: Page, fn: () => T): Promise<T> {
  return await page.evaluate(fn);
}

export async function waitForExtensionReady(page: Page, extensionId: string, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    (extId: string) => {
      return !!(window as any).__GLASSWALL_READY__ && (window as any).__GLASSWALL_READY__[extId];
    },
    extensionId,
    { timeout }
  );
}

export async function sendMessageToExtension(
  page: Page, 
  extensionId: string, 
  message: any
): Promise<any> {
  return await page.evaluate(
    ({ extId, msg }: { extId: string; msg: any }) => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(extId, msg, (response: any) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    },
    { extId: extensionId, msg: message }
  );
}

export interface NetworkCapture {
  requests: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
    timestamp: number;
  }>;
  responses: Array<{
    url: string;
    status: number;
    headers: Record<string, string>;
    body?: string;
    timestamp: number;
  }>;
}

interface RequestWillBeSentParams {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
  };
  timestamp: number;
}

interface ResponseReceivedParams {
  response: {
    url: string;
    status: number;
    headers: Record<string, string>;
  };
  timestamp: number;
}

export function createNetworkCapture(cdpSession: CDPSession): NetworkCapture {
  const capture: NetworkCapture = { requests: [], responses: [] };

  cdpSession.on('Network.requestWillBeSent', (params: RequestWillBeSentParams) => {
    capture.requests.push({
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      postData: params.request.postData,
      timestamp: params.timestamp * 1000,
    });
  });

  cdpSession.on('Network.responseReceived', (params: ResponseReceivedParams) => {
    capture.responses.push({
      url: params.response.url,
      status: params.response.status,
      headers: params.response.headers,
      timestamp: params.timestamp * 1000,
    });
  });

  return capture;
}

export async function getResponseBody(cdpSession: CDPSession, requestId: string): Promise<string | null> {
  try {
    const result = await cdpSession.send('Network.getResponseBody', { requestId });
    return result.body;
  } catch {
    return null;
  }
}

export async function takeScreenshot(page: Page, name: string, outputDir: string): Promise<string> {
  const filepath = path.join(outputDir, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

export async function getPerformanceMetrics(cdpSession: CDPSession): Promise<any> {
  const metrics = await cdpSession.send('Performance.getMetrics');
  return metrics.metrics;
}

export async function getMemoryMetrics(cdpSession: CDPSession): Promise<any> {
  try {
    const memory = await cdpSession.send('Memory.getDOMCounters');
    return memory;
  } catch {
    return null;
  }
}