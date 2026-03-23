#!/usr/bin/env bun
// Fire Point Test Rig — entry point
//
// Emulates the transcribed → cai-websocket speculative fire pipeline.
// For each scenario, progressively reveals words and tests when the
// fire-point detector decides to speculatively send to LLM.
//
// Two separate concerns being tested:
//   1. TRANSCRIBED side: "Should I send this partial to cai-ws now?"
//      (fire-point detector)
//   2. CAI-WS side: "Is this partial's meaning the same as the final?"
//      (stability checker — already built)

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FIRE_POINT_SCENARIOS } from './src/fire-point/scenarios';
import { simulateScenario } from './src/fire-point/simulator';
import type { FirePointEvalResult } from './src/fire-point/types';

const RESULTS_DIR = join(import.meta.dir, 'results');

interface CliArgs {
  verbose: boolean;
  scenarioFilter?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { verbose: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-v' || args[i] === '--verbose') {
      result.verbose = true;
    } else if (args[i] === '-s' || args[i] === '--scenario') {
      result.scenarioFilter = args[++i];
    } else if (args[i] === '-h' || args[i] === '--help') {
      printUsage();
      process.exit(0);
    }
  }
  return result;
}

function printUsage(): void {
  console.log(`
Usage: bun run fire-point-test [options]

Options:
  -v, --verbose            Show word-by-word decisions
  -s, --scenario <id>      Run only scenarios matching this prefix
  -h, --help               Show this help

Examples:
  bun run fire-point-test
  bun run fire-point-test -v
  bun run fire-point-test -s yn -v
  bun run fire-point-test -s de -v
`);
}

function printScenarioResult(result: FirePointEvalResult, verbose: boolean): void {
  const outcomeLabel = {
    'safe': 'SAFE',
    'caught': 'CAUGHT',
    'no-fire': 'NO FIRE',
  }[result.fireOutcome];
  const fireIcon = outcomeLabel;
  const ratio = result.fireRatio !== undefined ? `${(result.fireRatio * 100).toFixed(0)}%` : 'n/a';
  const savings = result.fireRatio !== undefined ? `${((1 - result.fireRatio) * 100).toFixed(0)}%` : 'n/a';

  console.log(
    `  [${fireIcon}] ${result.scenarioId}`
    + ` | fired at word ${result.firstFireWordCount ?? '-'}/${result.totalWordCount}`
    + ` (${ratio} through, ${savings} saved)`
    + ` | ${result.decisionLatencyMs.toFixed(2)}ms`,
  );
  console.log(`    Assistant: "${result.assistantTurn}"`);
  console.log(`    User:      "${result.userUtterance}"`);
  if (result.firstFireAt) {
    console.log(`    Fired on:  "${result.firstFireAt}"`);
  }

  if (verbose) {
    console.log('    Word-by-word:');
    for (const d of result.decisions) {
      const icon = d.shouldFire ? 'FIRE >>>' : '  wait  ';
      console.log(
        `      [${icon}] "${d.wordsHeard}" `
        + `(conf=${d.confidence.toFixed(2)}, ${d.reason})`,
      );
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log('Fire Point Test Rig\n');
  console.log('Emulates: transcribed → [fire decision] → cai-websocket → [stability check]\n');

  const args = parseArgs();

  let scenarios = FIRE_POINT_SCENARIOS;
  if (args.scenarioFilter) {
    scenarios = scenarios.filter((s) => s.id.startsWith(args.scenarioFilter!));
    console.log(`Filtered to ${scenarios.length} scenarios matching "${args.scenarioFilter}"\n`);
  }

  console.log(`Running ${scenarios.length} scenarios...\n`);

  const results: FirePointEvalResult[] = [];

  for (const scenario of scenarios) {
    const result = await simulateScenario(scenario);
    results.push(result);
    printScenarioResult(result, args.verbose);
  }

  // Summary statistics
  const fired = results.filter((r) => r.fireOutcome !== 'no-fire');
  const safe = results.filter((r) => r.fireOutcome === 'safe');
  const caught = results.filter((r) => r.fireOutcome === 'caught');
  const noFire = results.filter((r) => r.fireOutcome === 'no-fire');

  const avgRatio = fired.length > 0
    ? fired.reduce((sum, r) => sum + (r.fireRatio ?? 0), 0) / fired.length
    : 0;
  const avgSavings = fired.length > 0
    ? fired.reduce((sum, r) => sum + (1 - (r.fireRatio ?? 1)), 0) / fired.length
    : 0;

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total scenarios:     ${results.length}`);
  console.log(`Fired:               ${fired.length} (${(fired.length / results.length * 100).toFixed(0)}%)`);
  console.log(`  Safe (latency win): ${safe.length}`);
  console.log(`  Caught (discarded): ${caught.length}`);
  console.log(`Did not fire:        ${noFire.length}`);
  console.log(`Avg fire point:      ${(avgRatio * 100).toFixed(0)}% through utterance`);
  console.log(`Avg latency saved:   ${(avgSavings * 100).toFixed(0)}% of utterance`);
  console.log(`Decision latency:    ${(results.reduce((s, r) => s + r.decisionLatencyMs, 0) / results.length).toFixed(2)}ms avg`);

  if (caught.length > 0) {
    console.log(`\nCAUGHT FIRES (stability checker correctly discarded — no harm, no win):`);
    for (const r of caught) {
      console.log(`  ${r.scenarioId}: fired on "${r.firstFireAt}" but final was "${r.userUtterance}"`);
    }
  }

  // Write CSV
  mkdirSync(RESULTS_DIR, { recursive: true });
  const csvPath = join(RESULTS_DIR, 'fire-point.csv');

  const headers = [
    'scenario_id', 'domain', 'assistant_turn', 'user_utterance',
    'fired', 'fire_at', 'fire_word', 'total_words', 'fire_ratio',
    'fire_outcome', 'decision_ms',
  ];
  const rows = results.map((r) => [
    r.scenarioId,
    r.domain,
    `"${r.assistantTurn.replace(/"/g, '""')}"`,
    `"${r.userUtterance.replace(/"/g, '""')}"`,
    r.firstFireAt ? 'true' : 'false',
    r.firstFireAt ? `"${r.firstFireAt.replace(/"/g, '""')}"` : '',
    r.firstFireWordCount ?? '',
    r.totalWordCount,
    r.fireRatio?.toFixed(4) ?? '',
    r.fireOutcome,
    r.decisionLatencyMs.toFixed(2),
  ].join(','));

  writeFileSync(csvPath, [headers.join(','), ...rows].join('\n') + '\n');
  console.log(`\nResults: ${csvPath}`);
  console.log('='.repeat(80));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
