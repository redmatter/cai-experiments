// CSV Reporter — writes evaluation results and summary metrics to CSV files

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { EvaluationResult, StrategyMetrics } from './types';

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function writeResultsCsv(results: EvaluationResult[], outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });

  const headers = [
    'strategy', 'pair_id', 'interim', 'final', 'category', 'language',
    'expected', 'actual', 'correct', 'confidence', 'latency_ms',
  ];

  const rows = results.map((r) => [
    r.strategyName,
    r.pairId,
    escapeCsv(r.interim),
    escapeCsv(r.final),
    r.category,
    r.language,
    r.expectedVerdict,
    r.actualVerdict,
    r.correct ? 'true' : 'false',
    r.confidence.toFixed(4),
    r.latencyMs.toFixed(2),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n') + '\n';
  writeFileSync(outputPath, csv);
}

export function writeSummaryCsv(metrics: StrategyMetrics[], outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });

  const headers = [
    'strategy', 'total', 'correct', 'incorrect', 'accuracy',
    'precision', 'recall', 'f1',
    'false_positives', 'false_negatives',
    'latency_p50_ms', 'latency_p95_ms', 'latency_p99_ms',
  ];

  const rows = metrics.map((m) => [
    m.strategyName,
    m.totalPairs,
    m.correct,
    m.incorrect,
    m.accuracy.toFixed(4),
    m.precision.toFixed(4),
    m.recall.toFixed(4),
    m.f1.toFixed(4),
    m.falsePositives,
    m.falseNegatives,
    m.latencyP50Ms.toFixed(2),
    m.latencyP95Ms.toFixed(2),
    m.latencyP99Ms.toFixed(2),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n') + '\n';
  writeFileSync(outputPath, csv);
}

export function printSummaryTable(allMetrics: StrategyMetrics[]): void {
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));

  // Overall comparison table
  const header = [
    'Strategy'.padEnd(25),
    'Accuracy'.padStart(10),
    'Precision'.padStart(10),
    'Recall'.padStart(10),
    'F1'.padStart(10),
    'FP (bad)'.padStart(10),
    'FN (ok)'.padStart(10),
    'P50ms'.padStart(10),
    'P95ms'.padStart(10),
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const m of allMetrics) {
    console.log([
      m.strategyName.padEnd(25),
      `${(m.accuracy * 100).toFixed(1)}%`.padStart(10),
      `${(m.precision * 100).toFixed(1)}%`.padStart(10),
      `${(m.recall * 100).toFixed(1)}%`.padStart(10),
      `${(m.f1 * 100).toFixed(1)}%`.padStart(10),
      String(m.falsePositives).padStart(10),
      String(m.falseNegatives).padStart(10),
      `${m.latencyP50Ms.toFixed(1)}`.padStart(10),
      `${m.latencyP95Ms.toFixed(1)}`.padStart(10),
    ].join(' | '));
  }

  // Per-category breakdown for each strategy
  for (const m of allMetrics) {
    console.log(`\n--- ${m.strategyName} — per category ---`);
    const catHeader = [
      'Category'.padEnd(20),
      'Correct'.padStart(8),
      'Total'.padStart(8),
      'Accuracy'.padStart(10),
      'FP'.padStart(6),
      'FN'.padStart(6),
    ].join(' | ');
    console.log(catHeader);
    console.log('-'.repeat(catHeader.length));

    for (const [cat, cm] of Object.entries(m.byCategory)) {
      console.log([
        cat.padEnd(20),
        String(cm.correct).padStart(8),
        String(cm.total).padStart(8),
        `${(cm.accuracy * 100).toFixed(1)}%`.padStart(10),
        String(cm.falsePositives).padStart(6),
        String(cm.falseNegatives).padStart(6),
      ].join(' | '));
    }
  }

  // Per-language breakdown
  for (const m of allMetrics) {
    console.log(`\n--- ${m.strategyName} — per language ---`);
    for (const [lang, lm] of Object.entries(m.byLanguage)) {
      console.log(
        `  ${lang}: ${lm.correct}/${lm.total} (${(lm.accuracy * 100).toFixed(1)}%)`,
      );
    }
  }

  console.log('\n' + '='.repeat(120));
  console.log(
    'Key: FP (false positive) = said SAME when DIFFERENT — DANGEROUS, sends wrong response',
  );
  console.log(
    '     FN (false negative) = said DIFFERENT when SAME — safe, just adds latency',
  );
  console.log('='.repeat(120));
}
