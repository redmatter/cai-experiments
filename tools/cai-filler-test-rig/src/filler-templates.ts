import type { IntentCategory, FillerPair } from './types';

/**
 * Intent-based filler template bank.
 * Each intent has a primary phrase (4-6 words) and a bridge phrase (2-3 words).
 */
export const INTENT_TEMPLATES: Record<IntentCategory, FillerPair> = {
  QUESTION: {
    primary: 'Let me think through that.',
    bridge: 'Just a moment.',
  },
  REQUEST: {
    primary: 'Sure, one moment please.',
    bridge: 'Almost there.',
  },
  COMPLAINT: {
    primary: 'Let me look into that.',
    bridge: 'Just checking.',
  },
  CLARIFICATION: {
    primary: 'Hmm, let me consider that.',
    bridge: 'One second.',
  },
  GREETING: {
    primary: 'Hello, how can I help.',
    bridge: 'Just a moment.',
  },
  OTHER: {
    primary: 'Let me think through that.',
    bridge: 'Just a moment.',
  },
};

/**
 * Validate that an intent string is a valid IntentCategory.
 */
export function isValidIntent(intent: string): intent is IntentCategory {
  return intent in INTENT_TEMPLATES;
}

/**
 * Get filler pair for a given intent. Falls back to OTHER if invalid.
 */
export function getFillerForIntent(intent: string): FillerPair {
  if (isValidIntent(intent)) {
    return INTENT_TEMPLATES[intent];
  }
  console.warn(`⚠️  Unknown intent "${intent}", falling back to OTHER`);
  return INTENT_TEMPLATES.OTHER;
}
