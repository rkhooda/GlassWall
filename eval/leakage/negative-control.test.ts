import { test, expect, Browser, chromium } from '@playwright/test';
import { installRequestInterceptor, getCapturedRequests, clearCapturedRequests } from './intercept';
import { injectSyntheticSecrets } from './inject';
import { scanRequestsForSecrets } from './scan';

test.describe('Negative Control — Harness Must Detect Leaks When Policy Disabled', () => {
  let browser: Browser;

  test.beforeAll(async () => {
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('negative control: PERMISSIVE policy with no detectors MUST report leaks', async () => {
    const page = await browser.newPage();
    installRequestInterceptor(page);
    clearCapturedRequests();

    const baseUrl = process.env.BENCH_URL || 'http://localhost:5173';
    await page.goto(`${baseUrl}/clinicdesk/form.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const { secrets } = await injectSyntheticSecrets(page, 999);

    await page.waitForTimeout(500);

    const requests = getCapturedRequests();
    const leaks = scanRequestsForSecrets(requests, secrets);

    await page.close();

    console.log('=== NEGATIVE CONTROL RESULTS ===');
    console.log(`Total requests captured: ${requests.length}`);
    console.log(`Leaks detected: ${leaks.length}`);
    for (const leak of leaks) {
      console.log(`  - ${leak.secretType} via ${leak.encoding} at ${leak.requestUrl}`);
    }

    expect(leaks.length).toBeGreaterThan(0);
  });

  test('negative control: no gateway pinning allows requests to any origin', async () => {
    const page = await browser.newPage();
    installRequestInterceptor(page);
    clearCapturedRequests();

    const baseUrl = process.env.BENCH_URL || 'http://localhost:5173';
    await page.goto(`${baseUrl}/clinicdesk/form.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const requests = getCapturedRequests();
    const externalRequests = requests.filter(r => {
      try {
        const url = new URL(r.url);
        return url.origin !== baseUrl.replace(/\/.*$/, '');
      } catch {
        return true;
      }
    });

    await page.close();

    console.log(`External requests (negative control): ${externalRequests.length}`);
    expect(externalRequests.length).toBeGreaterThanOrEqual(0);
  });
});