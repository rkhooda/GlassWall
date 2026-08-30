#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { runSuite, SuiteConfig, loadAllTasks, RunResult } from './runner';
import { calculateUtilityMetrics, formatUtilityReport, checkUtilityTargets } from '../metrics/utility';
import { calculatePerformanceMetrics, formatPerformanceReport, checkPerformanceTargets, formatComparisonReport } from '../metrics/performance';

async function main() {
  const args = process.argv.slice(2);
  const isSmoke = args.includes('--smoke');
  const isFull = args.includes('--full');
  const isLeakage = args.includes('--leakage');
  const isAblation = args.includes('--ablation');
  const isPerf = args.includes('--perf');
  
  const extensionPath = process.env.EXTENSION_PATH || path.resolve(__dirname, '../../apps/extension/dist');
  const baseUrl = process.env.BASE_URL || 'http://localhost:5173';
  const headless = !args.includes('--headed');
  const outputDir = process.env.OUTPUT_DIR || path.resolve(__dirname, '../reports', `run-${Date.now()}`);
  
  const config: SuiteConfig = {
    tasksDir: path.resolve(__dirname, '../tasks'),
    extensionPath,
    baseUrl,
    headless,
    slowMo: 0,
    retries: 3,
    seeds: [1337, 42, 999],
    policyProfile: 'STRICT',
    outputDir,
  };
  
  if (isSmoke) {
    config.smokeTasks = ['T1', 'T3'];
    config.seeds = [1337];
    console.log('Running smoke suite (T1, T3 × seed 1337)...');
  } else if (isFull) {
    console.log('Running full suite (all tasks × all seeds)...');
  } else if (isLeakage) {
    config.smokeTasks = ['T1', 'T3'];
    config.seeds = [1337];
    console.log('Running leakage suite...');
  } else if (isAblation) {
    console.log('Running ablation suite...');
  } else if (isPerf) {
    console.log('Running performance suite...');
  } else {
    console.log('Usage: pnpm bench:smoke | bench:all | bench:leakage | bench:ablation | bench:perf');
    process.exit(1);
  }
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  try {
    const results = await runSuite(config);
    
    const tasks = await loadAllTasks(config.tasksDir);
    const utilityMetrics = calculateUtilityMetrics(results, tasks);
    const performanceMetrics = calculatePerformanceMetrics(results);
    
    const utilityReport = formatUtilityReport(utilityMetrics);
    const perfReport = formatPerformanceReport(performanceMetrics);
    
    fs.writeFileSync(path.join(outputDir, 'utility-report.md'), utilityReport);
    fs.writeFileSync(path.join(outputDir, 'performance-report.md'), perfReport);
    
    console.log('\n' + utilityReport);
    console.log('\n' + perfReport);
    
    const utilityCheck = checkUtilityTargets(utilityMetrics);
    const perfCheck = checkPerformanceTargets(performanceMetrics);
    
    if (!utilityCheck.passed) {
      console.log('\n❌ Utility targets not met:');
      for (const f of utilityCheck.failures) {
        console.log(`  - ${f}`);
      }
    }
    
    if (!perfCheck.passed) {
      console.log('\n❌ Performance targets not met:');
      for (const f of perfCheck.failures) {
        console.log(`  - ${f}`);
      }
    }
    
    if (utilityCheck.passed && perfCheck.passed) {
      console.log('\n✅ All targets met!');
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (error) {
    console.error('Bench run failed:', error);
    process.exit(1);
  }
}

main();