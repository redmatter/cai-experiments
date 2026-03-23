import type { FillerPair } from './types';
import type { ReasoningResponse } from '../../../lib/reasoning-bedrock-client';
import { calculateAudioDuration } from './csv-reporter';

// Estimated TTS synthesis latency (time to convert text to audio and start playback)
// Based on spec assumption of ~200ms for 4-6 word phrases
const TTS_SYNTHESIS_LATENCY_MS = 200;

export interface CoordinationResult {
  fillerPhrase: string;
  bridgeFillerPhrase: string;
  fastLLMLatencyMs: number;
  reasoningLLMTTFTMs: number;
  fillerAudioDurationMs: number;
  bridgeAudioDurationMs: number;
  bufferGapMs: number;
  bridgeFillerTriggered: boolean;
  totalPerceivedLatencyMs: number;
  reasoningResponse: ReasoningResponse;
}

export interface ParallelExecutionOptions {
  filler: FillerPair;
  fastLLMLatencyMs: number;
  reasoningPromise: Promise<ReasoningResponse>;
  bridgeThresholdMs: number;
  wordsPerMinute: number;
}

/**
 * Orchestrates parallel execution of fast LLM + reasoning LLM with timing coordination.
 */
export class StreamCoordinator {
  /**
   * Execute parallel coordination:
   * 1. Fast LLM returns filler pair
   * 2. Primary filler "plays" (simulated via audio duration calculation)
   * 3. If reasoning LLM hasn't responded, bridge filler triggers
   * 4. Reasoning LLM response collected
   */
  async coordinateParallelExecution(
    options: ParallelExecutionOptions
  ): Promise<CoordinationResult> {
    const {
      filler,
      fastLLMLatencyMs,
      reasoningPromise,
      bridgeThresholdMs,
      wordsPerMinute,
    } = options;

    // Calculate audio durations
    const primaryAudioDuration = calculateAudioDuration(filler.primary, wordsPerMinute);
    const bridgeAudioDuration = calculateAudioDuration(filler.bridge, wordsPerMinute);

    // Simulate filler playback: wait for primary audio duration
    const primaryPlaybackStart = Date.now();

    // Race: reasoning LLM vs primary filler audio duration
    const primaryAudioPromise = this.sleep(primaryAudioDuration);

    const result = await Promise.race([
      reasoningPromise.then(r => ({ type: 'reasoning' as const, response: r })),
      primaryAudioPromise.then(() => ({ type: 'audio_end' as const })),
    ]);

    let bridgeTriggered = false;
    let reasoningResponse: ReasoningResponse;

    if (result.type === 'reasoning') {
      // Reasoning LLM finished before primary audio ended (good!)
      reasoningResponse = result.response;
    } else {
      // Primary audio ended, reasoning LLM still processing
      // Check if we need bridge filler
      const elapsedMs = Date.now() - primaryPlaybackStart;

      if (elapsedMs < bridgeThresholdMs) {
        // Within threshold, wait for reasoning LLM
        reasoningResponse = await reasoningPromise;
      } else {
        // Beyond threshold, trigger bridge filler
        bridgeTriggered = true;
        console.log(`   🌉 Bridge filler triggered (${elapsedMs}ms elapsed)`);

        // Simulate bridge playback
        await this.sleep(bridgeAudioDuration);

        // Now wait for reasoning LLM
        reasoningResponse = await reasoningPromise;
      }
    }

    // Calculate metrics
    const reasoningTTFT = reasoningResponse.metrics.ttftMs;
    const bufferGap = reasoningTTFT - primaryAudioDuration;

    // Total perceived latency = time from utterance end to first audio byte
    // For filler strategies: fast_llm_latency + TTS_synthesis_latency
    // This is when the user actually HEARS something (filler audio starts playing)
    const totalPerceivedLatency = fastLLMLatencyMs + TTS_SYNTHESIS_LATENCY_MS;

    return {
      fillerPhrase: filler.primary,
      bridgeFillerPhrase: filler.bridge,
      fastLLMLatencyMs,
      reasoningLLMTTFTMs: reasoningTTFT,
      fillerAudioDurationMs: primaryAudioDuration,
      bridgeAudioDurationMs: bridgeAudioDuration,
      bufferGapMs: bufferGap,
      bridgeFillerTriggered: bridgeTriggered,
      totalPerceivedLatencyMs: totalPerceivedLatency,
      reasoningResponse,
    };
  }

  /**
   * Execute baseline (no filler) coordination.
   */
  async coordinateBaseline(
    reasoningPromise: Promise<ReasoningResponse>
  ): Promise<CoordinationResult> {
    const reasoningResponse = await reasoningPromise;

    // For baseline: perceived latency = reasoning TTFT
    // (no filler, so user waits until reasoning LLM produces first token)
    return {
      fillerPhrase: '',
      bridgeFillerPhrase: '',
      fastLLMLatencyMs: 0,
      reasoningLLMTTFTMs: reasoningResponse.metrics.ttftMs,
      fillerAudioDurationMs: 0,
      bridgeAudioDurationMs: 0,
      bufferGapMs: 0,
      bridgeFillerTriggered: false,
      totalPerceivedLatencyMs: reasoningResponse.metrics.ttftMs, // User hears response at TTFT
      reasoningResponse,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
