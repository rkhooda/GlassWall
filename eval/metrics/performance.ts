import { RunResult } from '../harness/runner';

export interface PerformanceMetrics {
  perceptionLatency: LatencyStats;
  sanitizeLatency: LatencyStats;
  gateLatency: LatencyStats;
  networkLatency: LatencyStats;
  executeLatency: LatencyStats;
  totalStepLatency: LatencyStats;
  coldStartMs: number;
  warmStartMs: number;
  peakMemoryMB: number;
  payloadBytesPerStep: LatencyStats;
  webgpuAvailable: boolean;
  wasmFallbackUsed: boolean;
}

export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  samples: number;
}

export interface ResourceMetrics {
  jsHeapUsedMB: number;
  jsHeapTotalMB: number;
  gpuMemoryMB?: number;
  cpuPercent: number;
}

export function calculatePerformanceMetrics(results: RunResult[]): PerformanceMetrics {
  const perceptionLatencies: number[] = [];
  const sanitizeLatencies: number[] = [];
  const gateLatencies: number[] = [];
  const networkLatencies: number[] = [];
  const executeLatencies: number[] = [];
  const totalStepLatencies: number[] = [];
  const payloadSizes: number[] = [];
  
  let coldStartMs = 0;
  let warmStartMs = 0;
  let peakMemoryMB = 0;
  let webgpuAvailable = false;
  let wasmFallbackUsed = false;
  
  for (const result of results) {
    for (const step of result.timings.stepTimings) {
      if (step.perception > 0) perceptionLatencies.push(step.perception);
      if (step.sanitize > 0) sanitizeLatencies.push(step.sanitize);
      if (step.gate > 0) gateLatencies.push(step.gate);
      if (step.network > 0) networkLatencies.push(step.network);
      if (step.execute > 0) executeLatencies.push(step.execute);
      if (step.total > 0) totalStepLatencies.push(step.total);
    }
    
    for (const req of result.networkCapture.requests) {
      if (req.postData) {
        payloadSizes.push(req.postData.length);
      }
    }
    
    if (result.timings.stepTimings.length > 0) {
      const firstStep = result.timings.stepTimings[0];
      if (firstStep) {
        coldStartMs = Math.max(coldStartMs, firstStep.total);
      }
      const warmSteps = result.timings.stepTimings.slice(1);
      if (warmSteps.length > 0) {
        warmStartMs = Math.max(warmStartMs, warmSteps.reduce((max, s) => Math.max(max, s.total), 0));
      }
    }
  }
  
  return {
    perceptionLatency: calculateLatencyStats(perceptionLatencies),
    sanitizeLatency: calculateLatencyStats(sanitizeLatencies),
    gateLatency: calculateLatencyStats(gateLatencies),
    networkLatency: calculateLatencyStats(networkLatencies),
    executeLatency: calculateLatencyStats(executeLatencies),
    totalStepLatency: calculateLatencyStats(totalStepLatencies),
    coldStartMs,
    warmStartMs: warmStartMs || coldStartMs,
    peakMemoryMB,
    payloadBytesPerStep: calculateLatencyStats(payloadSizes),
    webgpuAvailable,
    wasmFallbackUsed,
  };
}

function calculateLatencyStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0, samples: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sum / sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    samples: sorted.length,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export function formatPerformanceReport(metrics: PerformanceMetrics): string {
  let report = '# Performance Metrics Report\n\n';
  
  report += '## Latency Breakdown (ms)\n\n';
  report += '| Stage | p50 | p95 | p99 | Mean | Min | Max | Samples |\n';
  report += '|-------|-----|-----|-----|------|-----|-----|---------|\n';
  report += formatLatencyRow('Perception', metrics.perceptionLatency);
  report += formatLatencyRow('Sanitize', metrics.sanitizeLatency);
  report += formatLatencyRow('Egress Gate', metrics.gateLatency);
  report += formatLatencyRow('Network', metrics.networkLatency);
  report += formatLatencyRow('Execute', metrics.executeLatency);
  report += formatLatencyRow('Total Step', metrics.totalStepLatency);
  report += formatLatencyRow('Payload Bytes', metrics.payloadBytesPerStep);
  report += '\n';
  
  report += '## Key NFR Targets\n\n';
  report += '| NFR | Target | Actual | Status |\n';
  report += '|-----|--------|--------|--------|\n';
  report += `| NFR-01 (Perception p50 WebGPU) | ≤ 400ms | ${metrics.perceptionLatency.p50}ms | ${metrics.perceptionLatency.p50 <= 400 ? '✅ PASS' : '❌ FAIL'} |\n`;
  report += `| NFR-02 (Perception p50 WASM) | ≤ 1200ms | ${metrics.perceptionLatency.p50}ms | ${metrics.perceptionLatency.p50 <= 1200 ? '✅ PASS' : '❌ FAIL'} |\n`;
  report += `| NFR-03 (Cold Start) | ≤ 3s | ${(metrics.coldStartMs / 1000).toFixed(2)}s | ${metrics.coldStartMs <= 3000 ? '✅ PASS' : '❌ FAIL'} |\n`;
  report += `| NFR-05 (Payload text-only) | ≤ 25KB | ${(metrics.payloadBytesPerStep.p50 / 1024).toFixed(1)}KB | ${metrics.payloadBytesPerStep.p50 <= 25000 ? '✅ PASS' : '❌ FAIL'} |\n`;
  report += `| NFR-06 (Payload with image) | ≤ 120KB | ${(metrics.payloadBytesPerStep.p50 / 1024).toFixed(1)}KB | ${metrics.payloadBytesPerStep.p50 <= 120000 ? '✅ PASS' : '❌ FAIL'} |\n\n`;
  
  report += '## Environment\n\n';
  report += `- WebGPU Available: ${metrics.webgpuAvailable ? 'Yes' : 'No'}\n`;
  report += `- WASM Fallback Used: ${metrics.wasmFallbackUsed ? 'Yes' : 'No'}\n`;
  report += `- Peak Memory: ${metrics.peakMemoryMB} MB\n`;
  
  return report;
}

function formatLatencyRow(name: string, stats: LatencyStats): string {
  return `| ${name} | ${stats.p50.toFixed(1)} | ${stats.p95.toFixed(1)} | ${stats.p99.toFixed(1)} | ${stats.mean.toFixed(1)} | ${stats.min.toFixed(1)} | ${stats.max.toFixed(1)} | ${stats.samples} |\n`;
}

export function checkPerformanceTargets(metrics: PerformanceMetrics): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  
  if (metrics.perceptionLatency.p50 > 400) {
    failures.push(`NFR-01: Perception p50 ${metrics.perceptionLatency.p50}ms exceeds 400ms target (WebGPU)`);
  }
  if (metrics.perceptionLatency.p50 > 1200) {
    failures.push(`NFR-02: Perception p50 ${metrics.perceptionLatency.p50}ms exceeds 1200ms target (WASM)`);
  }
  if (metrics.coldStartMs > 3000) {
    failures.push(`NFR-03: Cold start ${(metrics.coldStartMs / 1000).toFixed(2)}s exceeds 3s target`);
  }
  if (metrics.payloadBytesPerStep.p50 > 25000) {
    failures.push(`NFR-05: Payload ${(metrics.payloadBytesPerStep.p50 / 1024).toFixed(1)}KB exceeds 25KB target (text-only)`);
  }
  if (metrics.payloadBytesPerStep.p50 > 120000) {
    failures.push(`NFR-06: Payload ${(metrics.payloadBytesPerStep.p50 / 1024).toFixed(1)}KB exceeds 120KB target (with image)`);
  }
  
  return { passed: failures.length === 0, failures };
}

export function compareWithBaseline(
  current: PerformanceMetrics,
  baseline: PerformanceMetrics
): { regression: boolean; deltas: Record<string, number> } {
  const deltas: Record<string, number> = {};
  let regression = false;
  
  const compare = (name: string, currentVal: number, baselineVal: number) => {
    if (baselineVal > 0) {
      const delta = ((currentVal - baselineVal) / baselineVal) * 100;
      deltas[name] = delta;
      if (delta > 20) {
        regression = true;
      }
    }
  };
  
  compare('perception_p50', current.perceptionLatency.p50, baseline.perceptionLatency.p50);
  compare('perception_p95', current.perceptionLatency.p95, baseline.perceptionLatency.p95);
  compare('sanitize_p50', current.sanitizeLatency.p50, baseline.sanitizeLatency.p50);
  compare('gate_p50', current.gateLatency.p50, baseline.gateLatency.p50);
  compare('execute_p50', current.executeLatency.p50, baseline.executeLatency.p50);
  compare('total_step_p50', current.totalStepLatency.p50, baseline.totalStepLatency.p50);
  compare('cold_start', current.coldStartMs, baseline.coldStartMs);
  compare('payload_p50', current.payloadBytesPerStep.p50, baseline.payloadBytesPerStep.p50);
  
  return { regression, deltas };
}

export function formatComparisonReport(
  current: PerformanceMetrics,
  baseline: PerformanceMetrics
): string {
  const { regression, deltas } = compareWithBaseline(current, baseline);
  
  let report = '# Performance Comparison Report\n\n';
  report += `**Regression Detected:** ${regression ? '❌ YES (>20% increase)' : '✅ NO'}\n\n`;
  
  report += '## Delta Table\n\n';
  report += '| Metric | Baseline | Current | Delta | Status |\n';
  report += '|--------|----------|---------|-------|--------|\n';
  
  for (const [metric, delta] of Object.entries(deltas)) {
    const baselineVal = getBaselineValue(baseline, metric);
    const currentVal = getCurrentValue(current, metric);
    report += `| ${metric} | ${formatValue(metric, baselineVal)} | ${formatValue(metric, currentVal)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% | ${delta > 20 ? '❌ REGRESSION' : delta > 0 ? '⚠️ Increased' : '✅ Improved'} |\n`;
  }
  
  return report;
}

function getBaselineValue(baseline: PerformanceMetrics, metric: string): number {
  switch (metric) {
    case 'perception_p50': return baseline.perceptionLatency.p50;
    case 'perception_p95': return baseline.perceptionLatency.p95;
    case 'sanitize_p50': return baseline.sanitizeLatency.p50;
    case 'gate_p50': return baseline.gateLatency.p50;
    case 'execute_p50': return baseline.executeLatency.p50;
    case 'total_step_p50': return baseline.totalStepLatency.p50;
    case 'cold_start': return baseline.coldStartMs;
    case 'payload_p50': return baseline.payloadBytesPerStep.p50;
    default: return 0;
  }
}

function getCurrentValue(current: PerformanceMetrics, metric: string): number {
  switch (metric) {
    case 'perception_p50': return current.perceptionLatency.p50;
    case 'perception_p95': return current.perceptionLatency.p95;
    case 'sanitize_p50': return current.sanitizeLatency.p50;
    case 'gate_p50': return current.gateLatency.p50;
    case 'execute_p50': return current.executeLatency.p50;
    case 'total_step_p50': return current.totalStepLatency.p50;
    case 'cold_start': return current.coldStartMs;
    case 'payload_p50': return current.payloadBytesPerStep.p50;
    default: return 0;
  }
}

function formatValue(metric: string, value: number): string {
  if (metric.includes('payload') || metric.includes('bytes')) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (metric.includes('cold_start')) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${value.toFixed(1)} ms`;
}