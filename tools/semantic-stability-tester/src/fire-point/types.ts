// Fire Point Detector — Type Definitions
//
// Emulates the transcribed → cai-websocket speculative fire pipeline.
// "transcribed" progressively reveals words and asks "should I fire?"
// "cai-websocket" receives the fire and speculatively generates a response.

// What the assistant last asked — determines what constitutes a "sufficient" answer
export type AssistantTurnType =
  | 'yes-no-question'     // "Would you like to proceed?" → just need yes/no
  | 'wh-question'         // "What city?" → need the specific entity
  | 'choice-question'     // "Standard or premium?" → need a choice
  | 'confirmation'        // "So that's 3 nights at the Hilton?" → need yes/no + possible correction
  | 'open-ended'          // "How can I help?" → need intent + possibly entity
  | 'information'         // "Your balance is £42" → user might just ack, or ask follow-up
  | 'action-complete'     // "I've booked that for you" → user likely to ack or raise new topic
  | 'unknown';

export interface FirePointDecision {
  shouldFire: boolean;
  confidence: number;
  reason: string;
  assistantTurnType: AssistantTurnType;
  detectedAnswer?: string;  // What the classifier thinks the user is answering
  codePatternMatch?: {      // Set when fire was triggered by code pattern match
    normalisedValue: string;
    patternType: string;
    label?: string;
  };
}

// Hint from cai-websocket: structured metadata about what the assistant is expecting.
// Passed alongside the assistant turn to give the fire-point detector more context.
export interface CaiHint {
  // Code pattern the assistant is expecting (e.g. account number, postcode)
  codePattern?: import('./code-patterns').CodePatternHint;
}

// A single moment in the progressive transcription
export interface TranscriptionMoment {
  wordsHeard: string;       // What we've heard so far
  fullUtterance: string;    // What the user actually ends up saying (ground truth)
  assistantPrior: string;   // What the assistant said before this
}

// Test scenario: a full conversation exchange
export interface FirePointScenario {
  id: string;
  language: string;
  domain: string;           // e.g. 'booking', 'support', 'billing'
  assistantTurn: string;    // What the assistant said
  userUtterance: string;    // Full user response
  expectedFirePoints: ExpectedFirePoint[];
  description: string;
}

// Where we expect the detector to fire (or not)
export interface ExpectedFirePoint {
  wordsHeard: string;       // The partial at this point
  shouldFire: boolean;      // Should the detector fire here?
  reason: string;           // Why
}

// Evaluation result for a single scenario
export interface FirePointEvalResult {
  scenarioId: string;
  domain: string;
  assistantTurn: string;
  userUtterance: string;
  // Where the detector first fired
  firstFireAt?: string;
  firstFireWordCount?: number;
  totalWordCount: number;
  // How much of the utterance was heard before firing (0-1, lower = better)
  fireRatio?: number;
  // Outcome of the speculative fire:
  //   'safe'    — stability says SAME, response is valid (latency win!)
  //   'caught'  — stability says DIFFERENT, discard and reprocess (no win, but no harm)
  //   'no-fire' — detector never fired
  fireOutcome: 'safe' | 'caught' | 'no-fire';
  // Legacy compat
  fireSafe: boolean;
  // Latency of the fire decision
  decisionLatencyMs: number;
  // All decisions at each word boundary
  decisions: Array<{
    wordsHeard: string;
    wordCount: number;
    shouldFire: boolean;
    confidence: number;
    reason: string;
  }>;
}
