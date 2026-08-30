import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { launchExtension, closeExtension, ExtensionContext, DriverConfig, NetworkCapture, createNetworkCapture, navigateToTask, waitForExtensionReady, sendMessageToExtension, evaluateOnPage } from './driver';
import { checkPredicate, PredicateResult } from './predicates';

export interface TaskDefinition {
  id: string;
  site: string;
  entry: string;
  instruction: string;
  seed: number;
  max_steps: number;
  success: SuccessPredicate[];
  expected_redactions?: string[];
  forbidden_in_payload?: string[];
}

export interface SuccessPredicate {
  kind: string;
  pattern?: string;
  selector_map?: Record<string, string>;
  [key: string]: any;
}

export interface RunResult {
  taskId: string;
  seed: number;
  success: boolean;
  steps: StepResult[];
  predicates: PredicateResult[];
  networkCapture: NetworkCapture;
  timings: TimingMetrics;
  error?: string;
  flakyRetries: number;
}

export interface StepResult {
  stepIndex: number;
  action: any;
  result: any;
  observationId: string;
  durationMs: number;
}

export interface TimingMetrics {
  totalMs: number;
  perceptionMs: number;
  sanitizeMs: number;
  gateMs: number;
  networkMs: number;
  executeMs: number;
  verifyMs: number;
  stepTimings: Array<{
    step: number;
    perception: number;
    sanitize: number;
    gate: number;
    network: number;
    execute: number;
    verify: number;
    total: number;
  }>;
}

export interface SuiteConfig {
  tasksDir: string;
  extensionPath: string;
  baseUrl: string;
  headless?: boolean;
  slowMo?: number;
  retries?: number;
  smokeTasks?: string[];
  seeds?: number[];
  policyProfile?: 'STRICT' | 'BALANCED' | 'PERMISSIVE';
  outputDir?: string;
}

const DEFAULT_CONFIG: Partial<SuiteConfig> = {
  headless: false,
  slowMo: 0,
  retries: 3,
  seeds: [1337],
  policyProfile: 'STRICT',
  outputDir: 'eval/reports',
};

export async function loadTask(filePath: string): Promise<TaskDefinition> {
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as TaskDefinition;
}

export async function loadAllTasks(tasksDir: string): Promise<TaskDefinition[]> {
  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const tasks: TaskDefinition[] = [];
  for (const file of files) {
    const task = await loadTask(path.join(tasksDir, file));
    tasks.push(task);
  }
  return tasks;
}

export async function runTask(
  task: TaskDefinition,
  config: SuiteConfig,
  seed: number
): Promise<RunResult> {
  const extensionPath = config.extensionPath;
  const baseUrl = config.baseUrl;
  const headless = config.headless ?? false;
  const slowMo = config.slowMo ?? 0;
  const policyProfile = config.policyProfile ?? 'STRICT';

  let extContext: ExtensionContext | null = null;
  let lastError: Error | null = null;
  let flakyRetries = 0;

  for (let attempt = 0; attempt <= (config.retries ?? 3); attempt++) {
    try {
      if (attempt > 0) {
        flakyRetries++;
        console.log(`[${task.id}] Retry attempt ${attempt}/${config.retries} (seed: ${seed})`);
      }

      extContext = await launchExtension({
        extensionPath,
        headless,
        slowMo,
      });

      await waitForExtensionReady(extContext.page, extContext.extensionId);

      const startUrl = `${baseUrl}${task.entry}?seed=${seed}`;
      await navigateToTask(extContext.page, startUrl);

      await sendMessageToExtension(extContext.page, extContext.extensionId, {
        type: 'extension:start-task',
        payload: {
          task: task.instruction,
          policyProfile,
          siteAllowlist: ['localhost'],
        },
      });

      const stepResults: StepResult[] = [];
      const networkCapture = createNetworkCapture(extContext.cdpSession);
      const startTime = Date.now();
      let stepIndex = 0;

      while (stepIndex < task.max_steps) {
        const stepStart = Date.now();
        
        await extContext.page.waitForFunction(
          (extId: string) => {
            return !!(window as any).__GLASSWALL_STEP_COMPLETE__ && (window as any).__GLASSWALL_STEP_COMPLETE__[extId];
          },
          extContext.extensionId,
          { timeout: 60000 }
        );

        const traceEntry = await evaluateOnPage(extContext!.page, () => {
          return (window as any).__GLASSWALL_LAST_TRACE__?.[extContext!.extensionId];
        });

        if (!traceEntry) {
          throw new Error('No trace entry received from extension');
        }

        stepResults.push({
          stepIndex: traceEntry.step,
          action: traceEntry.action,
          result: traceEntry.result,
          observationId: traceEntry.observationId || '',
          durationMs: Date.now() - stepStart,
        });

        if (traceEntry.action?.type === 'DONE') {
          break;
        }

        stepIndex++;
      }

      const totalMs = Date.now() - startTime;

      const timings = calculateTimings(stepResults, totalMs);

      const predicates = await Promise.all(
        task.success.map(pred => checkPredicate(pred, extContext!, task, seed))
      );

      const success = predicates.every(p => p.passed);

      return {
        taskId: task.id,
        seed,
        success,
        steps: stepResults,
        predicates,
        networkCapture,
        timings,
        flakyRetries,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[${task.id}] Attempt ${attempt + 1} failed:`, lastError.message);
      
      if (extContext) {
        await closeExtension(extContext);
        extContext = null;
      }
      
      if (attempt === (config.retries ?? 3)) {
        break;
      }
      
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  if (extContext) {
    await closeExtension(extContext);
  }

  throw lastError || new Error('Task failed after all retries');
}

function calculateTimings(steps: StepResult[], totalMs: number): TimingMetrics {
  return {
    totalMs,
    perceptionMs: 0,
    sanitizeMs: 0,
    gateMs: 0,
    networkMs: 0,
    executeMs: 0,
    verifyMs: 0,
    stepTimings: steps.map((s, i) => ({
      step: i,
      perception: 0,
      sanitize: 0,
      gate: 0,
      network: 0,
      execute: s.durationMs,
      verify: 0,
      total: s.durationMs,
    })),
  };
}

export async function runSuite(config: SuiteConfig): Promise<RunResult[]> {
  const tasks = config.smokeTasks 
    ? (await loadAllTasks(config.tasksDir)).filter(t => config.smokeTasks!.includes(t.id))
    : await loadAllTasks(config.tasksDir);

  const seeds = config.seeds ?? [1337];
  const results: RunResult[] = [];

  for (const task of tasks) {
    for (const seed of seeds) {
      console.log(`Running ${task.id} with seed ${seed}...`);
      const result = await runTask(task, config, seed);
      results.push(result);
      console.log(`  ${result.success ? 'PASS' : 'FAIL'} (${result.flakyRetries} retries)`);
    }
  }

  return results;
}

export function generateReport(results: RunResult[], outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true });

  const summary = {
    timestamp: new Date().toISOString(),
    totalTasks: results.length,
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    flakyRate: results.reduce((sum, r) => sum + r.flakyRetries, 0) / Math.max(results.length, 1),
    results: results.map(r => ({
      taskId: r.taskId,
      seed: r.seed,
      success: r.success,
      steps: r.steps.length,
      totalMs: r.timings.totalMs,
      flakyRetries: r.flakyRetries,
      predicates: r.predicates.map(p => ({ kind: p.kind, passed: p.passed, message: p.message })),
    })),
  };

  fs.writeFileSync(
    path.join(outputDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  const md = generateMarkdownReport(summary);
  fs.writeFileSync(path.join(outputDir, 'report.md'), md);

  console.log(`Report written to ${outputDir}`);
}

function generateMarkdownReport(summary: any): string {
  let md = `# Evaluation Report\n\n`;
  md += `**Generated:** ${summary.timestamp}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total Tasks | ${summary.totalTasks} |\n`;
  md += `| Passed | ${summary.passed} |\n`;
  md += `| Failed | ${summary.failed} |\n`;
  md += `| Flake Rate | ${summary.flakyRate.toFixed(2)} |\n\n`;
  
  md += `## Results\n\n`;
  md += `| Task | Seed | Status | Steps | Time (ms) | Retries |\n`;
  md += `|------|------|--------|-------|-----------|---------|\n`;
  
  for (const r of summary.results) {
    md += `| ${r.taskId} | ${r.seed} | ${r.success ? '✅ PASS' : '❌ FAIL'} | ${r.steps} | ${r.totalMs} | ${r.flakyRetries} |\n`;
  }

  return md;
}