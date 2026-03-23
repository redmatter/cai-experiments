import { NovaClient } from '../../../lib/nova-client';
import type { FillerPair } from './types';
import type { PromptLoader, ConversationHistoryEntry } from './prompt-loader';

export interface DynamicFillerResult {
  filler: FillerPair;
  latencyMs: number;
  detectedIntent: string; // Empty for dynamic strategy
}

/**
 * Strategy A: Dynamic filler generation.
 * Generate both primary and bridge filler phrases dynamically for each utterance.
 */
export class DynamicFillerGenerator {
  private novaClient: NovaClient;
  private promptLoader: PromptLoader;

  constructor(novaClient: NovaClient, promptLoader: PromptLoader) {
    this.novaClient = novaClient;
    this.promptLoader = promptLoader;
  }

  async generateFiller(
    userUtterance: string,
    conversationHistory?: ConversationHistoryEntry[]
  ): Promise<DynamicFillerResult> {
    try {
      const prompt = this.promptLoader.getDynamicPrompt(userUtterance, conversationHistory);

      const response = await this.novaClient.sendMessage(prompt, {
        maxTokens: 50,
        temperature: 0.7,
      });

      // Parse PRIMARY and BRIDGE from response
      const lines = response.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      let primary = '';
      let bridge = '';

      for (const line of lines) {
        if (line.startsWith('PRIMARY:')) {
          primary = line.substring(8).trim();
        } else if (line.startsWith('BRIDGE:')) {
          bridge = line.substring(7).trim();
        }
      }

      if (!primary || !bridge) {
        // Fallback: try to parse without labels
        if (lines.length >= 2) {
          primary = lines[0];
          bridge = lines[1];
        } else {
          throw new Error('Failed to parse filler pair from response');
        }
      }

      const result = {
        primary,
        bridge,
        latencyMs: response.latencyMs,
      };

      // Validate word counts
      const primaryWords = result.primary.trim().split(/\s+/).length;
      const bridgeWords = result.bridge.trim().split(/\s+/).length;

      if (primaryWords < 2 || primaryWords > 4) {
        console.warn(
          `⚠️  Primary filler has ${primaryWords} words (expected 2-4): "${result.primary}"`
        );
      }

      if (bridgeWords < 1 || bridgeWords > 2) {
        console.warn(
          `⚠️  Bridge filler has ${bridgeWords} words (expected 1-2): "${result.bridge}"`
        );
      }

      return {
        filler: {
          primary: result.primary,
          bridge: result.bridge,
        },
        latencyMs: result.latencyMs,
        detectedIntent: '', // Not used in dynamic strategy
      };
    } catch (error) {
      throw new Error(
        `Dynamic filler generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
