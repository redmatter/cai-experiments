import { NovaClient } from '../../../lib/nova-client';
import { classifySpeechAct, type SpeechActClassification } from './speech-act-classifier';
import type { FillerPair } from './types';
import type { PromptLoader, ConversationHistoryEntry } from './prompt-loader';

export interface OpeningSentenceResult {
  filler: FillerPair;
  latencyMs: number;
  detectedIntent: string;
}

/**
 * Strategy C: Opening Sentence model.
 * Fast LLM generates a complete, direction-neutral opening sentence.
 * Speech act classification provides structured hints for tone calibration.
 * Reasoning LLM generates independently (no filler injection).
 * Coherence is measured at a natural sentence boundary.
 */
export class OpeningSentenceGenerator {
  private novaClient: NovaClient;
  private promptLoader: PromptLoader;

  constructor(novaClient: NovaClient, promptLoader: PromptLoader) {
    this.novaClient = novaClient;
    this.promptLoader = promptLoader;
  }

  async generateFiller(
    userUtterance: string,
    conversationHistory?: ConversationHistoryEntry[]
  ): Promise<OpeningSentenceResult> {
    try {
      // Classify speech act (zero-latency regex heuristic)
      const classification = classifySpeechAct(userUtterance);

      const prompt = this.promptLoader.getOpeningSentencePrompt(
        userUtterance,
        conversationHistory,
        classification.tags
      );

      const response = await this.novaClient.sendMessage(prompt, {
        maxTokens: 80,
        temperature: 0.7,
      });

      // Parse CATEGORY, OPENING, and BRIDGE from response
      const lines = response.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      let category = '';
      let opening = '';
      let bridge = '';

      for (const line of lines) {
        if (line.startsWith('CATEGORY:')) {
          category = line.substring(9).trim();
        } else if (line.startsWith('OPENING:')) {
          opening = line.substring(8).trim();
        } else if (line.startsWith('BRIDGE:')) {
          bridge = line.substring(7).trim();
        }
      }

      if (!opening) {
        // Fallback: try first non-empty line
        if (lines.length >= 1) {
          opening = lines[0];
          bridge = lines[1] || 'Hmm...';
        } else {
          throw new Error('Failed to parse opening sentence from response');
        }
      }

      if (!bridge) {
        bridge = 'Hmm...';
      }

      // Validate word counts
      const openingWords = opening.trim().split(/\s+/).length;
      if (openingWords < 4 || openingWords > 12) {
        console.warn(
          `⚠️  Opening sentence has ${openingWords} words (expected 5-10): "${opening}"`
        );
      }

      return {
        filler: {
          primary: opening,
          bridge,
        },
        latencyMs: response.latencyMs,
        detectedIntent: `${classification.tags} [CATEGORY: ${category || 'unknown'}]`,
      };
    } catch (error) {
      throw new Error(
        `Opening sentence generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
