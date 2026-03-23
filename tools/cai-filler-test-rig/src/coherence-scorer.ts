import { NovaClient } from '../../../lib/nova-client';

export interface CoherenceScore {
  score: number; // 1-5, or -1 on failure
  explanation: string;
  latencyMs: number;
}

/**
 * LLM-as-judge coherence scorer.
 * Evaluates whether the reasoning LLM response continues naturally from the filler.
 */
export class CoherenceScorer {
  private novaClient: NovaClient;

  constructor(novaClient: NovaClient) {
    this.novaClient = novaClient;
  }

  async scoreCoherence(fillerPhrase: string, responseText: string): Promise<CoherenceScore> {
    const prompt = `You are evaluating a voice assistant response for conversational coherence.

The assistant had already spoken this opening phrase to the user:
FILLER: "${fillerPhrase}"

The assistant then continued with:
CONTINUATION: "${responseText}"

Score the coherence of the transition on a scale of 1 to 5:
  5 = Perfectly natural, sounds like one continuous sentence
  4 = Natural, minor awkwardness
  3 = Acceptable but noticeable seam
  2 = Awkward, mismatch in tone or direction
  1 = Contradicts or ignores the filler entirely

Output format:
SCORE: [integer 1-5]
REASON: [one brief sentence explaining why]`;

    try {
      const response = await this.novaClient.sendMessage(prompt, {
        maxTokens: 50,
        temperature: 0.3, // Lower temperature for consistent scoring
      });

      // Parse score and reason
      const text = response.text.trim();
      const scoreMatch = text.match(/SCORE:\s*(\d+)/i);
      const reasonMatch = text.match(/REASON:\s*(.+)/i);

      if (!scoreMatch) {
        console.warn(`⚠️  Could not parse coherence score from: "${text}"`);
        return {
          score: -1,
          explanation: text,
          latencyMs: response.latencyMs,
        };
      }

      const score = parseInt(scoreMatch[1], 10);
      const explanation = reasonMatch ? reasonMatch[1].trim() : 'No explanation provided';

      // Validate score is in range 1-5
      if (isNaN(score) || score < 1 || score > 5) {
        console.warn(`⚠️  Invalid coherence score "${score}", returning -1`);
        return {
          score: -1,
          explanation,
          latencyMs: response.latencyMs,
        };
      }

      return {
        score,
        explanation,
        latencyMs: response.latencyMs,
      };
    } catch (error) {
      console.error(
        `❌ Coherence scoring failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        score: -1,
        explanation: 'Scoring failed',
        latencyMs: 0,
      };
    }
  }
}
