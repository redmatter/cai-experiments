#!/usr/bin/env bun
// Speculative Handoff — Stability Strategy Evaluator
// Evaluates different strategies for detecting whether an extended
// utterance has changed meaning compared to an earlier interim version.

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { StabilityStrategy, UtterancePair } from './src/types';
import { evaluateStrategy, computeMetrics } from './src/evaluator';
import { writeResultsCsv, writeSummaryCsv, printSummaryTable } from './src/csv-reporter';
import { EN_CORPUS } from './src/corpus/en';
import { DE_CORPUS } from './src/corpus/de';

const TOOL_DIR = join(import.meta.dir);
const RESULTS_DIR = join(TOOL_DIR, 'results');

interface CliArgs {
  strategies: string[];
  languages: string[];
  verbose: boolean;
  heuristicOnly: boolean;
  corpusSource: 'handcrafted' | 'generated' | 'all';
}

const ALL_STRATEGIES = [
  'token-delta-heuristic',
  'embedding-similarity',
  'nli-entailment',
  'entity-diff',
  'hybrid',
];

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    strategies: [],
    languages: [],
    verbose: false,
    heuristicOnly: false,
    corpusSource: 'all',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--strategy' || arg === '-s') {
      i++;
      if (i < args.length) result.strategies.push(args[i]);
    } else if (arg === '--language' || arg === '-l') {
      i++;
      if (i < args.length) result.languages.push(args[i]);
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--heuristic-only') {
      result.heuristicOnly = true;
    } else if (arg === '--corpus' || arg === '-c') {
      i++;
      if (i < args.length) {
        const val = args[i] as CliArgs['corpusSource'];
        if (!['handcrafted', 'generated', 'all'].includes(val)) {
          console.error(`Invalid corpus source: ${val}`);
          process.exit(1);
        }
        result.corpusSource = val;
      }
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  // Defaults
  if (result.strategies.length === 0) {
    result.strategies = result.heuristicOnly ? ['token-delta-heuristic'] : [...ALL_STRATEGIES];
  }
  if (result.languages.length === 0) {
    result.languages = ['en', 'de'];
  }

  return result;
}

function printUsage(): void {
  console.log(`
Usage: bun run stability-test [options]

Options:
  -s, --strategy <name>    Strategy to evaluate (can repeat). Default: all
  -l, --language <code>    Language corpus to use (can repeat). Default: en, de
  -v, --verbose            Print per-pair results
  --heuristic-only         Only run token-delta-heuristic (fast, no model downloads)
  -c, --corpus <source>    Corpus source: handcrafted, generated, all (default: all)
  -h, --help               Show this help

Strategies: ${ALL_STRATEGIES.join(', ')}
Languages:  en, de
Corpus:     handcrafted (hand-labelled), generated (from MultiWOZ), all

Examples:
  bun run stability-test
  bun run stability-test --heuristic-only -v
  bun run stability-test -s token-delta-heuristic -s entity-diff -l en
`);
}

async function loadStrategy(name: string): Promise<StabilityStrategy> {
  switch (name) {
    case 'token-delta-heuristic': {
      const { TokenDeltaHeuristicStrategy } = await import('./src/strategies/token-delta-heuristic');
      return new TokenDeltaHeuristicStrategy();
    }
    case 'embedding-similarity': {
      const { EmbeddingSimilarityStrategy } = await import('./src/strategies/embedding-similarity');
      return new EmbeddingSimilarityStrategy();
    }
    case 'nli-entailment': {
      const { NliEntailmentStrategy } = await import('./src/strategies/nli-entailment');
      return new NliEntailmentStrategy();
    }
    case 'entity-diff': {
      const { EntityDiffStrategy } = await import('./src/strategies/entity-diff');
      return new EntityDiffStrategy();
    }
    case 'hybrid': {
      const { HybridStrategy } = await import('./src/strategies/hybrid');
      return new HybridStrategy();
    }
    default:
      throw new Error(`Unknown strategy: ${name}`);
  }
}

function loadCorpus(languages: string[], source: CliArgs['corpusSource']): UtterancePair[] {
  const corpus: UtterancePair[] = [];

  // Handcrafted corpus
  if (source === 'handcrafted' || source === 'all') {
    if (languages.includes('en')) corpus.push(...EN_CORPUS);
    if (languages.includes('de')) corpus.push(...DE_CORPUS);
  }

  // Generated corpus from public datasets
  if (source === 'generated' || source === 'all') {
    const generatedPath = join(TOOL_DIR, 'corpus', 'generated-en.json');
    if (existsSync(generatedPath) && languages.includes('en')) {
      const generated: UtterancePair[] = JSON.parse(readFileSync(generatedPath, 'utf-8'));
      corpus.push(...generated);
    }
    const generatedDePath = join(TOOL_DIR, 'corpus', 'generated-de.json');
    if (existsSync(generatedDePath) && languages.includes('de')) {
      const generated: UtterancePair[] = JSON.parse(readFileSync(generatedDePath, 'utf-8'));
      corpus.push(...generated);
    }
  }

  return corpus;
}

async function main(): Promise<void> {
  console.log('Speculative Handoff — Stability Strategy Evaluator\n');

  const args = parseArgs();
  const corpus = loadCorpus(args.languages, args.corpusSource);

  console.log(`Corpus: ${corpus.length} pairs (${args.languages.join(', ')})`);
  console.log(`Strategies: ${args.strategies.join(', ')}`);
  console.log(`Verbose: ${args.verbose}\n`);

  const allResults: Array<{ strategy: string; results: ReturnType<typeof computeMetrics> }> = [];
  const allEvalResults: Array<Awaited<ReturnType<typeof evaluateStrategy>>> = [];

  for (const strategyName of args.strategies) {
    console.log(`\n--- Evaluating: ${strategyName} ---`);

    const strategy = await loadStrategy(strategyName);

    console.log(`  Initializing ${strategyName}...`);
    const initStart = performance.now();
    await strategy.init();
    console.log(`  Initialized in ${(performance.now() - initStart).toFixed(0)}ms`);

    console.log(`  Running ${corpus.length} comparisons...`);
    const evalResults = await evaluateStrategy(strategy, corpus, args.verbose);
    allEvalResults.push(evalResults);

    const metrics = computeMetrics(strategyName, evalResults);
    allResults.push({ strategy: strategyName, results: metrics });

    console.log(
      `  Done: ${metrics.correct}/${metrics.totalPairs} correct `
      + `(${(metrics.accuracy * 100).toFixed(1)}%) | `
      + `FP=${metrics.falsePositives} FN=${metrics.falseNegatives} | `
      + `P50=${metrics.latencyP50Ms.toFixed(1)}ms`,
    );

    if (strategy.dispose) await strategy.dispose();
  }

  // Print summary
  printSummaryTable(allResults.map((r) => r.results));

  // Write CSV outputs
  const flatResults = allEvalResults.flat();

  const resultsCsvPath = join(RESULTS_DIR, 'stability-results.csv');
  const summaryCsvPath = join(RESULTS_DIR, 'stability-summary.csv');

  writeResultsCsv(flatResults, resultsCsvPath);
  writeSummaryCsv(allResults.map((r) => r.results), summaryCsvPath);

  console.log(`\nResults written to:`);
  console.log(`  ${resultsCsvPath}`);
  console.log(`  ${summaryCsvPath}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
