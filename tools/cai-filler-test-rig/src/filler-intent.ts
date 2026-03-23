import { NovaClient } from '../../../lib/nova-client';
import type { FillerPair } from './types';
import type { PromptLoader } from './prompt-loader';

export interface IntentFillerResult {
  filler: FillerPair;
  latencyMs: number;
  detectedIntent: string;
}

/**
 * Strategy B: Intent-conditioned template selection.
 * Classify intent, then select pre-defined filler pair from template bank.
 */
export class IntentFillerGenerator {
  private novaClient: NovaClient;
  private promptLoader: PromptLoader;

  constructor(novaClient: NovaClient, promptLoader: PromptLoader) {
    this.novaClient = novaClient;
    this.promptLoader = promptLoader;
  }

  async generateFiller(userUtterance: string): Promise<IntentFillerResult> {
    try {
      // Step 1: Classify intent
      const classificationPrompt = this.promptLoader.getIntentClassificationPrompt(userUtterance);

      const response = await this.novaClient.sendMessage(classificationPrompt, {
        maxTokens: 10,
        temperature: 0.3, // Lower temperature for classification
      });

      // Extract just the first word (intent category), ignore any explanation or formatting
      // Remove markdown formatting (**, *, etc.) and extract first word
      const detectedIntent = response.text
        .trim()
        .replace(/[\*_]/g, '') // Remove markdown formatting
        .split(/[\s\n]/)[0]
        .toUpperCase();

      // Step 2: Select template from loaded prompts
      const filler = this.promptLoader.getIntentTemplate(detectedIntent);

      return {
        filler,
        latencyMs: response.latencyMs,
        detectedIntent,
      };
    } catch (error) {
      throw new Error(
        `Intent filler generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
