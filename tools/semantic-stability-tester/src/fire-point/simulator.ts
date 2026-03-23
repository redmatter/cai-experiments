// Simulator — emulates the transcribed → cai-websocket pipeline.
//
// For each scenario:
//   1. "transcribed" progressively reveals words (like Deepgram interim results)
//   2. At each word boundary, the fire-point detector decides: fire or wait?
//   3. If fired, "cai-websocket" gets the partial and starts LLM (simulated)
//   4. When the final transcript arrives, cai-websocket runs stability check
//   5. We measure: how early did we fire? Was it safe?

import type { FirePointScenario, FirePointEvalResult } from './types';
import { detectFirePoint } from './detector';
import { TokenDeltaHeuristicStrategy } from '../strategies/token-delta-heuristic';

const stabilityChecker = new TokenDeltaHeuristicStrategy();

export async function simulateScenario(
  scenario: FirePointScenario,
): Promise<FirePointEvalResult> {
  await stabilityChecker.init();

  const words = scenario.userUtterance.split(/\s+/);
  const decisions: FirePointEvalResult['decisions'] = [];
  let firstFireAt: string | undefined;
  let firstFireWordCount: number | undefined;
  const start = performance.now();

  // Progressive word reveal — emulates Deepgram interim transcripts
  for (let i = 1; i <= words.length; i++) {
    const partial = words.slice(0, i).join(' ');

    const decision = detectFirePoint(partial, scenario.assistantTurn);

    decisions.push({
      wordsHeard: partial,
      wordCount: i,
      shouldFire: decision.shouldFire,
      confidence: decision.confidence,
      reason: decision.reason,
    });

    if (decision.shouldFire && !firstFireAt) {
      firstFireAt = partial;
      firstFireWordCount = i;
    }
  }

  const decisionLatencyMs = performance.now() - start;

  // Was the fire safe? Check if the partial meaning matches the final.
  // Pass conversation context so the stability checker knows what was asked.
  let fireOutcome: 'safe' | 'caught' | 'no-fire' = 'no-fire';
  if (firstFireAt) {
    const stabilityResult = await stabilityChecker.compare(
      firstFireAt,
      scenario.userUtterance,
      {
        turns: [{ role: 'assistant', content: scenario.assistantTurn }],
      },
    );
    fireOutcome = stabilityResult.verdict === 'SAME' ? 'safe' : 'caught';
  }

  return {
    scenarioId: scenario.id,
    domain: scenario.domain,
    assistantTurn: scenario.assistantTurn,
    userUtterance: scenario.userUtterance,
    firstFireAt,
    firstFireWordCount,
    totalWordCount: words.length,
    fireRatio: firstFireWordCount ? firstFireWordCount / words.length : undefined,
    fireOutcome,
    fireSafe: fireOutcome === 'safe',
    decisionLatencyMs,
    decisions,
  };
}
