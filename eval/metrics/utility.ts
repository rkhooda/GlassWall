import { RunResult, TaskDefinition } from '../harness/runner';

export interface UtilityMetrics {
  taskCompletionRate: number;
  stepEfficiency: number;
  actionValidityRate: number;
  actionSuccessRate: number;
  semanticFidelity: number;
  perTask: Record<string, TaskUtilityMetrics>;
}

export interface TaskUtilityMetrics {
  taskId: string;
  seed: number;
  completed: boolean;
  stepsTaken: number;
  oracleSteps: number;
  stepEfficiency: number;
  actionsTotal: number;
  actionsValid: number;
  actionValidityRate: number;
  actionsSuccessful: number;
  actionSuccessRate: number;
  semanticFidelity: number;
}

export function calculateUtilityMetrics(
  results: RunResult[],
  tasks: TaskDefinition[]
): UtilityMetrics {
  const perTask: Record<string, TaskUtilityMetrics> = {};
  
  for (const result of results) {
    const task = tasks.find(t => t.id === result.taskId);
    const oracleSteps = task?.max_steps ?? result.steps.length;
    
    const actionsTotal = result.steps.length;
    const actionsValid = result.steps.filter(s => s.result?.ok !== false).length;
    const actionsSuccessful = result.steps.filter(s => s.result?.effect_observed === true).length;
    
    const stepEfficiency = oracleSteps > 0 ? result.steps.length / oracleSteps : 1;
    const actionValidityRate = actionsTotal > 0 ? actionsValid / actionsTotal : 1;
    const actionSuccessRate = actionsTotal > 0 ? actionsSuccessful / actionsTotal : 1;
    
    const semanticFidelity = calculateSemanticFidelity(result);
    
    perTask[`${result.taskId}-${result.seed}`] = {
      taskId: result.taskId,
      seed: result.seed,
      completed: result.success,
      stepsTaken: result.steps.length,
      oracleSteps,
      stepEfficiency,
      actionsTotal,
      actionsValid,
      actionValidityRate,
      actionsSuccessful,
      actionSuccessRate,
      semanticFidelity,
    };
  }
  
  const completedTasks = Object.values(perTask).filter(t => t.completed).length;
  const totalTasks = Object.keys(perTask).length;
  
  return {
    taskCompletionRate: totalTasks > 0 ? completedTasks / totalTasks : 0,
    stepEfficiency: average(Object.values(perTask).map(t => t.stepEfficiency)),
    actionValidityRate: average(Object.values(perTask).map(t => t.actionValidityRate)),
    actionSuccessRate: average(Object.values(perTask).map(t => t.actionSuccessRate)),
    semanticFidelity: average(Object.values(perTask).map(t => t.semanticFidelity)),
    perTask,
  };
}

function calculateSemanticFidelity(result: RunResult): number {
  if (!result.success) return 0;
  
  let correct = 0;
  let total = 0;
  
  for (const predicate of result.predicates) {
    total++;
    if (predicate.passed) correct++;
  }
  
  return total > 0 ? correct / total : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function formatUtilityReport(metrics: UtilityMetrics): string {
  let report = '# Utility Metrics Report\n\n';
  
  report += '## Summary\n\n';
  report += '| Metric | Value | Target |\n';
  report += '|--------|-------|--------|\n';
  report += `| Task Completion Rate | ${(metrics.taskCompletionRate * 100).toFixed(1)}% | ≥ 80% |\n`;
  report += `| Step Efficiency | ${metrics.stepEfficiency.toFixed(2)}× | ≤ 1.6× |\n`;
  report += `| Action Validity Rate | ${(metrics.actionValidityRate * 100).toFixed(1)}% | ≥ 95% |\n`;
  report += `| Action Success Rate | ${(metrics.actionSuccessRate * 100).toFixed(1)}% | ≥ 90% |\n`;
  report += `| Semantic Fidelity | ${(metrics.semanticFidelity * 100).toFixed(1)}% | ≥ 85% |\n\n`;
  
  report += '## Per-Task Breakdown\n\n';
  report += '| Task | Seed | Completed | Steps | Oracle | Efficiency | Validity | Success | Fidelity |\n';
  report += '|------|------|-----------|-------|--------|------------|----------|---------|----------|\n';
  
  for (const [key, m] of Object.entries(metrics.perTask)) {
    report += `| ${m.taskId} | ${m.seed} | ${m.completed ? '✅' : '❌'} | ${m.stepsTaken} | ${m.oracleSteps} | ${m.stepEfficiency.toFixed(2)}× | ${(m.actionValidityRate * 100).toFixed(1)}% | ${(m.actionSuccessRate * 100).toFixed(1)}% | ${(m.semanticFidelity * 100).toFixed(1)}% |\n`;
  }
  
  return report;
}

export function checkUtilityTargets(metrics: UtilityMetrics): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  
  if (metrics.taskCompletionRate < 0.8) {
    failures.push(`Task completion rate ${(metrics.taskCompletionRate * 100).toFixed(1)}% below 80% target`);
  }
  if (metrics.stepEfficiency > 1.6) {
    failures.push(`Step efficiency ${metrics.stepEfficiency.toFixed(2)}× above 1.6× target`);
  }
  if (metrics.actionValidityRate < 0.95) {
    failures.push(`Action validity rate ${(metrics.actionValidityRate * 100).toFixed(1)}% below 95% target`);
  }
  if (metrics.actionSuccessRate < 0.9) {
    failures.push(`Action success rate ${(metrics.actionSuccessRate * 100).toFixed(1)}% below 90% target`);
  }
  if (metrics.semanticFidelity < 0.85) {
    failures.push(`Semantic fidelity ${(metrics.semanticFidelity * 100).toFixed(1)}% below 85% target`);
  }
  
  return { passed: failures.length === 0, failures };
}