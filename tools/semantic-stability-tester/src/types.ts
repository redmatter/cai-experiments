// Semantic Stability Tester - Type Definitions

export interface UtterancePair {
  id: string;
  interim: string;
  final: string;
  expectedVerdict: Verdict;
  category: SemanticChangeCategory;
  language: Language;
  description: string;
  context?: ConversationContext;
}

export type Verdict = 'SAME' | 'DIFFERENT';

export type SemanticChangeCategory =
  | 'filler-only'        // "Yes" → "Yes, I think so"
  | 'elaboration'        // "That works" → "That works for me, yeah"
  | 'entity-addition'    // "I'd love to go" → "I'd love to go to Tuscany"
  | 'negation-reversal'  // "Yes" → "Yes but actually no"
  | 'qualification'      // "Sure" → "Sure, but only on weekdays"
  | 'topic-shift'        // "Yes" → "Yes, and can you check my bill?"
  | 'correction'         // "Tuesday" → "Tuesday... wait, Wednesday"
  | 'number-addition'    // "Book a table" → "Book a table for four"
  | 'time-addition'      // "I'll come" → "I'll come at three"
  | 'partial-word'       // ASR artefact: "I'd lo" → "I'd love to go"
  | 'new-request';       // "Yes" → "Yes and I need to cancel" (after yes-no)

export type Language = 'en' | 'de';

export interface ConversationContext {
  systemPrompt?: string;
  turns: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

// Context richness — estimates how much useful context the delta contains
// beyond the core actionable answer. Even when the verdict is SAME (the
// action doesn't change), the full utterance may carry context that would
// improve response quality.
//
// Example: "Are you still experiencing the issue?"
//   Fired on: "No"          → action = mark resolved
//   Full:     "No it's working now actually since I restarted it"
//   The delta carries causal context ("since I restarted it") that would
//   make the LLM's response more relevant ("Glad a restart fixed it...")
//
// Pipeline behaviour is controlled by a tuneable richness threshold:
//   - Below threshold: SAME verdict stands → send speculative response (latency win)
//   - At/above threshold: SAME demoted to DIFFERENT → discard speculative, reprocess
//     with full utterance for better quality (no latency win but better response)
//
// Default threshold: 'high' (only demote on high richness)
// Conservative:      'medium' (demote on medium or high)
// Aggressive:        'none' (never demote — always prefer speed)
export type ContextRichnessLevel = 'none' | 'low' | 'medium' | 'high';

export interface ContextRichness {
  level: ContextRichnessLevel;
  signals: string[];        // what contextual signals were found
  summary?: string;         // human-readable explanation
}

export interface StabilityResult {
  verdict: Verdict;
  confidence: number;
  latencyMs: number;
  contextRichness?: ContextRichness;
  details?: Record<string, unknown>;
}

export interface StabilityStrategy {
  name: string;
  init(): Promise<void>;
  compare(
    interim: string,
    final: string,
    context?: ConversationContext,
  ): Promise<StabilityResult>;
  dispose?(): Promise<void>;
}

export interface EvaluationResult {
  strategyName: string;
  pairId: string;
  interim: string;
  final: string;
  category: SemanticChangeCategory;
  language: Language;
  expectedVerdict: Verdict;
  actualVerdict: Verdict;
  confidence: number;
  correct: boolean;
  latencyMs: number;
}

export interface StrategyMetrics {
  strategyName: string;
  totalPairs: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  precision: number;   // precision for "SAME" verdict (we care about false positives)
  recall: number;      // recall for "SAME" verdict
  f1: number;
  falsePositives: number;  // said SAME when actually DIFFERENT (dangerous!)
  falseNegatives: number;  // said DIFFERENT when actually SAME (just extra latency)
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  byCategory: Record<string, CategoryMetrics>;
  byLanguage: Record<string, { correct: number; total: number; accuracy: number }>;
}

export interface CategoryMetrics {
  correct: number;
  total: number;
  accuracy: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface TestConfig {
  corpus: string[];       // paths to corpus JSON files
  strategies: string[];   // strategy names to evaluate
  outputCsv: string;
  outputSummary: string;
  verbose: boolean;
}
