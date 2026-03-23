// Strategy 5: Hybrid (Heuristic Gate → NLI → Entity Safety Net)
// Three-stage pipeline designed for production use:
// Stage 1 (<1ms): Token delta heuristic — catches easy cases
// Stage 2 (~20ms): NLI entailment — handles ambiguous cases
// Stage 3 (~5ms): Entity diff safety net — catches missed entities
//
// Conservative: when in doubt, says DIFFERENT (safe fallback).

import type { StabilityStrategy, StabilityResult, ConversationContext } from '../types';
import { TokenDeltaHeuristicStrategy } from './token-delta-heuristic';
import { NliEntailmentStrategy } from './nli-entailment';
import { EntityDiffStrategy } from './entity-diff';

const HEURISTIC_HIGH_CONFIDENCE = 0.9;

export class HybridStrategy implements StabilityStrategy {
  name = 'hybrid';
  private heuristic = new TokenDeltaHeuristicStrategy();
  private nli = new NliEntailmentStrategy();
  private entityDiff = new EntityDiffStrategy();

  async init(): Promise<void> {
    // Initialise all sub-strategies in parallel
    await Promise.all([
      this.heuristic.init(),
      this.nli.init(),
      this.entityDiff.init(),
    ]);
  }

  async compare(
    interim: string,
    final: string,
    context?: ConversationContext,
  ): Promise<StabilityResult> {
    const start = performance.now();

    // Stage 1: Fast heuristic gate
    const heuristicResult = await this.heuristic.compare(interim, final, context);

    // If heuristic is very confident about DIFFERENT (negation, reversal), trust it
    if (
      heuristicResult.verdict === 'DIFFERENT'
      && heuristicResult.confidence >= HEURISTIC_HIGH_CONFIDENCE
    ) {
      return {
        verdict: 'DIFFERENT',
        confidence: heuristicResult.confidence,
        latencyMs: performance.now() - start,
        details: {
          stage: 'heuristic',
          heuristicResult: heuristicResult.details,
        },
      };
    }

    // If heuristic says SAME with high confidence (all fillers), still run entity check
    if (
      heuristicResult.verdict === 'SAME'
      && heuristicResult.confidence >= HEURISTIC_HIGH_CONFIDENCE
    ) {
      // Stage 3 shortcut: Just run entity diff as safety net
      const entityResult = await this.entityDiff.compare(interim, final, context);

      if (entityResult.verdict === 'DIFFERENT') {
        return {
          verdict: 'DIFFERENT',
          confidence: entityResult.confidence,
          latencyMs: performance.now() - start,
          details: {
            stage: 'entity-safety-net',
            heuristicResult: heuristicResult.details,
            entityResult: entityResult.details,
          },
        };
      }

      return {
        verdict: 'SAME',
        confidence: heuristicResult.confidence,
        latencyMs: performance.now() - start,
        details: {
          stage: 'heuristic-confirmed',
          heuristicResult: heuristicResult.details,
        },
      };
    }

    // Stage 2: Ambiguous case — run NLI and entity diff in parallel
    const [nliResult, entityResult] = await Promise.all([
      this.nli.compare(interim, final, context),
      this.entityDiff.compare(interim, final, context),
    ]);

    // Entity diff overrides NLI if it finds new entities (safety net)
    if (entityResult.verdict === 'DIFFERENT') {
      return {
        verdict: 'DIFFERENT',
        confidence: Math.max(entityResult.confidence, nliResult.confidence),
        latencyMs: performance.now() - start,
        details: {
          stage: 'entity-override',
          heuristicResult: heuristicResult.details,
          nliResult: nliResult.details,
          entityResult: entityResult.details,
        },
      };
    }

    // Otherwise, trust NLI verdict
    return {
      verdict: nliResult.verdict,
      confidence: nliResult.confidence,
      latencyMs: performance.now() - start,
      details: {
        stage: 'nli-decision',
        heuristicResult: heuristicResult.details,
        nliResult: nliResult.details,
        entityResult: entityResult.details,
      },
    };
  }

  async dispose(): Promise<void> {
    await Promise.all([
      this.entityDiff.dispose?.(),
      this.nli.dispose?.(),
    ]);
  }
}
