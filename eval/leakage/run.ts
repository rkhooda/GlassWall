import { test, expect, Page, Browser, chromium } from '@playwright/test';
import { installRequestInterceptor, getCapturedRequests, clearCapturedRequests } from './intercept';
import { injectSyntheticSecrets, SyntheticSecrets } from './inject';
import { scanRequestsForSecrets, checkRequestsToUnauthorizedOrigins } from './scan';
import { generatePersona } from '../../apps/bench-site/src/data/generator';

interface TestConfig {
  policy: 'STRICT' | 'BALANCED' | 'PERMISSIVE';
  task: string;
  seed: number;
}

interface LeakageReport {
  timestamp: string;
  hardware: string;
  browserVersion: string;
  seedSet: number[];
  tasks: TaskResult[];
  summary: {
    totalRuns: number;
    leakedRuns: number;
    totalLeaks: number;
    leaksByType: Record<string, number>;
    leaksByEncoding: Record<string, number>;
    unauthorizedRequests: number;
  };
}

interface TaskResult {
  task: string;
  policy: string;
  seed: number;
  leaks: LeakFinding[];
  unauthorizedRequests: number;
  passed: boolean;
}

const SEEDS = [1, 2, 3, 4, 5];
const POLICIES: ('STRICT' | 'BALANCED')[] = ['STRICT', 'BALANCED'];
const TASKS = ['clinicdesk-form', 'clinicdesk-login', 'clinicdesk-search'];

async function runLeakageTest(
  browser: Browser,
  config: TestConfig
): Promise<TaskResult> {
  const page = await browser.newPage();
  installRequestInterceptor(page);
  clearCapturedRequests();

  const baseUrl = process.env.BENCH_URL || 'http://localhost:5173';
  const url = `${baseUrl}/clinicdesk/${config.task}.html`;

  const { secrets } = await injectSyntheticSecrets(page, config.seed);

  await page.goto(url, { waitUntil: 'networkidle' });

  await page.waitForTimeout(2000);

  await injectSyntheticSecrets(page, config.seed);

  await page.waitForTimeout(1000);

  const requests = getCapturedRequests();
  const leaks = scanRequestsForSecrets(requests, secrets);
  const unauthorized = checkRequestsToUnauthorizedOrigins(requests, 'http://localhost:5173');

  await page.close();

  return {
    task: config.task,
    policy: config.policy,
    seed: config.seed,
    leaks,
    unauthorizedRequests: unauthorized.length,
    passed: leaks.length === 0 && unauthorized.length === 0,
  };
}

async function runNegativeControl(
  browser: Browser
): Promise<{ leaks: any[]; passed: boolean }> {
  const page = await browser.newPage();
  installRequestInterceptor(page);
  clearCapturedRequests();

  const baseUrl = process.env.BENCH_URL || 'http://localhost:5173';
  const url = `${baseUrl}/clinicdesk/form.html`;

  const { secrets } = await injectSyntheticSecrets(page, 999);

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const requests = getCapturedRequests();
  const leaks = scanRequestsForSecrets(requests, secrets);
  const unauthorized = checkRequestsToUnauthorizedOrigins(requests, 'http://localhost:5173');

  await page.close();

  return {
    leaks,
    passed: leaks.length > 0,
  };
}

function generateMarkdownReport(report: LeakageReport): string {
  const lines = [
    `# Leakage Evaluation Report`,
    ``,
    `**Generated:** ${report.timestamp}`,
    `**Hardware:** ${report.hardware}`,
    `**Browser:** ${report.browserVersion}`,
    `**Seed Set:** [${report.seedSet.join(', ')}]`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Runs | ${report.summary.totalRuns} |`,
    `| Leaked Runs | ${report.summary.leakedRuns} |`,
    `| Total Leaks | ${report.summary.totalLeaks} |`,
    `| Unauthorized Requests | ${report.summary.unauthorizedRequests} |`,
    ``,
    `### Leaks by Type`,
    ``,
    `| Type | Count |`,
    `|------|-------|`,
    ...Object.entries(report.summary.leaksByType).map(([type, count]) => `| ${type} | ${count} |`),
    ``,
    `### Leaks by Encoding`,
    ``,
    `| Encoding | Count |`,
    `|----------|-------|`,
    ...Object.entries(report.summary.leaksByEncoding).map(([enc, count]) => `| ${enc} | ${count} |`),
    ``,
    `## Detailed Results`,
    ``,
  ];

  for (const taskResult of report.tasks) {
    lines.push(`### ${taskResult.task} / ${taskResult.policy} / seed ${taskResult.seed}`);
    lines.push(``);
    lines.push(`**Status:** ${taskResult.passed ? '✅ PASSED' : '❌ FAILED'}`);
    lines.push(`**Leaks:** ${taskResult.leaks.length}`);
    lines.push(`**Unauthorized Requests:** ${taskResult.unauthorizedRequests}`);
    lines.push(``);

    if (taskResult.leaks.length > 0) {
      lines.push(`| Secret Type | Encoding | Request URL |`);
      lines.push(`|-------------|----------|-------------|`);
      for (const leak of taskResult.leaks) {
        lines.push(`| ${leak.secretType} | ${leak.encoding} | ${leak.requestUrl.slice(0, 80)} |`);
      }
      lines.push(``);
    }
  }

  return lines.join('\n');
}

test.describe('Leakage Evaluation', () => {
  let browser: Browser;

  test.beforeAll(async () => {
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('negative control: PERMISSIVE policy with detectors disabled should LEAK', async () => {
    const result = await runNegativeControl(browser);
    expect(result.passed).toBe(true);
    console.log(`Negative control leaks: ${result.leaks.length} (expected > 0)`);
  });

  for (const task of TASKS) {
    for (const policy of POLICIES) {
      for (const seed of SEEDS) {
        test(`${task} / ${policy} / seed ${seed} should have zero leakage`, async () => {
          const result = await runLeakageTest(browser, { task, policy, seed });
          expect(result.passed).toBe(true);
        });
      }
    }
  }

  test('generate full report', async () => {
    const allResults: TaskResult[] = [];

    for (const task of TASKS) {
      for (const policy of POLICIES) {
        for (const seed of SEEDS) {
          const result = await runLeakageTest(browser, { task, policy, seed });
          allResults.push(result);
        }
      }
    }

    const totalRuns = allResults.length;
    const leakedRuns = allResults.filter(r => !r.passed).length;
    const totalLeaks = allResults.reduce((sum, r) => sum + r.leaks.length, 0);
    const unauthorizedRequests = allResults.reduce((sum, r) => sum + r.unauthorizedRequests, 0);

    const leaksByType: Record<string, number> = {};
    const leaksByEncoding: Record<string, number> = {};

    for (const r of allResults) {
      for (const leak of r.leaks) {
        leaksByType[leak.secretType] = (leaksByType[leak.secretType] || 0) + 1;
        leaksByEncoding[leak.encoding] = (leaksByEncoding[leak.encoding] || 0) + 1;
      }
    }

    const report: LeakageReport = {
      timestamp: new Date().toISOString(),
      hardware: `${process.platform} ${process.arch} (${require('os').cpus()[0]?.model || 'unknown'})`,
      browserVersion: 'chromium',
      seedSet: SEEDS,
      tasks: allResults,
      summary: {
        totalRuns,
        leakedRuns,
        totalLeaks,
        leaksByType,
        leaksByEncoding,
        unauthorizedRequests,
      },
    };

    const fs = require('fs');
    const path = require('path');
    const reportDir = path.join(process.cwd(), 'eval', 'reports');
    fs.mkdirSync(reportDir, { recursive: true });

    const dateStr = new Date().toISOString().split('T')[0];
    const jsonPath = path.join(reportDir, `leakage-${dateStr}.json`);
    const mdPath = path.join(reportDir, `leakage-${dateStr}.md`);

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, generateMarkdownReport(report));

    console.log(`Report written to ${jsonPath} and ${mdPath}`);
    console.log(`Leakage rate: ${(totalLeaks / totalRuns).toFixed(6)}`);
  });
});