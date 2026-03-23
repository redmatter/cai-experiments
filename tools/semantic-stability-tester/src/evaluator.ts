// Evaluator — runs all strategies against the corpus and computes metrics

import type {
  UtterancePair,
  StabilityStrategy,
  EvaluationResult,
  StrategyMetrics,
  CategoryMetrics,
} from './types';

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function computeMetrics(
  strategyName: string,
  results: EvaluationResult[],
): StrategyMetrics {
  const totalPairs = results.length;
  const correct = results.filter((r) => r.correct).length;
  const incorrect = totalPairs - correct;

  // For our purposes, "positive" = SAME (meaning we fire early).
  // False positive = we said SAME but it was actually DIFFERENT → dangerous!
  // False negative = we said DIFFERENT but it was actually SAME → just extra latency
  const falsePositives = results.filter(
    (r) => r.actualVerdict === 'SAME' && r.expectedVerdict === 'DIFFERENT',
  ).length;
  const falseNegatives = results.filter(
    (r) => r.actualVerdict === 'DIFFERENT' && r.expectedVerdict === 'SAME',
  ).length;
  const truePositives = results.filter(
    (r) => r.actualVerdict === 'SAME' && r.expectedVerdict === 'SAME',
  ).length;

  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : 0;
  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : 0;
  const f1 = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  const latencies = results.map((r) => r.latencyMs);

  // Per-category breakdown
  const categories = [...new Set(results.map((r) => r.category))];
  const byCategory: Record<string, CategoryMetrics> = {};
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catCorrect = catResults.filter((r) => r.correct).length;
    byCategory[cat] = {
      correct: catCorrect,
      total: catResults.length,
      accuracy: catCorrect / catResults.length,
      falsePositives: catResults.filter(
        (r) => r.actualVerdict === 'SAME' && r.expectedVerdict === 'DIFFERENT',
      ).length,
      falseNegatives: catResults.filter(
        (r) => r.actualVerdict === 'DIFFERENT' && r.expectedVerdict === 'SAME',
      ).length,
    };
  }

  // Per-language breakdown
  const languages = [...new Set(results.map((r) => r.language))];
  const byLanguage: Record<string, { correct: number; total: number; accuracy: number }> = {};
  for (const lang of languages) {
    const langResults = results.filter((r) => r.language === lang);
    const langCorrect = langResults.filter((r) => r.correct).length;
    byLanguage[lang] = {
      correct: langCorrect,
      total: langResults.length,
      accuracy: langCorrect / langResults.length,
    };
  }

  return {
    strategyName,
    totalPairs,
    correct,
    incorrect,
    accuracy: correct / totalPairs,
    precision,
    recall,
    f1,
    falsePositives,
    falseNegatives,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    latencyP99Ms: percentile(latencies, 99),
    byCategory,
    byLanguage,
  };
}

export async function evaluateStrategy(
  strategy: StabilityStrategy,
  corpus: UtterancePair[],
  verbose: boolean,
): Promise<EvaluationResult[]> {
  const results: EvaluationResult[] = [];

  for (const pair of corpus) {
    const result = await strategy.compare(pair.interim, pair.final, pair.context);

    const correct = result.verdict === pair.expectedVerdict;
    const evalResult: EvaluationResult = {
      strategyName: strategy.name,
      pairId: pair.id,
      interim: pair.interim,
      final: pair.final,
      category: pair.category,
      language: pair.language,
      expectedVerdict: pair.expectedVerdict,
      actualVerdict: result.verdict,
      confidence: result.confidence,
      correct,
      latencyMs: result.latencyMs,
    };

    results.push(evalResult);

    if (verbose) {
      const icon = correct ? 'PASS' : 'FAIL';
      const danger = !correct && result.verdict === 'SAME' ? ' ** FALSE POSITIVE **' : '';
      console.log(
        `  [${icon}] ${pair.id}: "${pair.interim}" → "${pair.final}" `
        + `| expected=${pair.expectedVerdict} got=${result.verdict} `
        + `conf=${result.confidence.toFixed(2)} ${result.latencyMs.toFixed(1)}ms${danger}`,
      );
    }
  }

  return results;
}
