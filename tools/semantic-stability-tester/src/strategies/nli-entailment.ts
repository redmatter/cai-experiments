// Strategy 2: Natural Language Inference (Entailment)
// Uses a zero-shot NLI model to check if interim entails final and vice versa.
// If bidirectional entailment → SAME. Otherwise → DIFFERENT.

import type { StabilityStrategy, StabilityResult, ConversationContext } from '../types';

let classifier: any;

async function loadClassifier() {
  if (!classifier) {
    const { pipeline } = await import('@huggingface/transformers');
    classifier = await pipeline(
      'zero-shot-classification',
      'Xenova/mobilebert-uncased-mnli',
    );
  }
  return classifier;
}

const ENTAILMENT_THRESHOLD = 0.7;

export class NliEntailmentStrategy implements StabilityStrategy {
  name = 'nli-entailment';
  private classifier: any;

  async init(): Promise<void> {
    this.classifier = await loadClassifier();
  }

  async compare(
    interim: string,
    final: string,
    _context?: ConversationContext,
  ): Promise<StabilityResult> {
    const start = performance.now();

    // Check: does the final utterance entail the interim meaning?
    // We frame it as: "Given the final text, is the interim text's meaning preserved?"
    const result = await this.classifier(final, [interim], {
      hypothesis_template: 'The speaker means: {}',
    });

    const entailmentScore = result.scores[0];

    // Also check reverse: does interim entail final?
    const reverseResult = await this.classifier(interim, [final], {
      hypothesis_template: 'The speaker means: {}',
    });

    const reverseScore = reverseResult.scores[0];

    // Bidirectional entailment: both directions must be high
    const bidirectionalScore = Math.min(entailmentScore, reverseScore);

    const latencyMs = performance.now() - start;

    return {
      verdict: bidirectionalScore >= ENTAILMENT_THRESHOLD ? 'SAME' : 'DIFFERENT',
      confidence: bidirectionalScore >= ENTAILMENT_THRESHOLD
        ? bidirectionalScore
        : 1 - bidirectionalScore,
      latencyMs,
      details: {
        entailmentScore,
        reverseScore,
        bidirectionalScore,
        threshold: ENTAILMENT_THRESHOLD,
      },
    };
  }

  async dispose(): Promise<void> {
    this.classifier = null;
  }
}
