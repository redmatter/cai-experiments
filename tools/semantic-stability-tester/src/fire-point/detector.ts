// Fire Point Detector — decides whether a partial utterance contains
// enough meaning to speculatively fire LLM generation.
//
// This runs on the "transcribed" side. For each new word from Deepgram,
// it checks: "Is there enough here to be worth sending to cai-websocket?"
//
// The decision depends heavily on what the assistant just asked.
// "Yes" is enough after "Would you like to proceed?" but not after "How can I help?"

import type { AssistantTurnType, FirePointDecision, CaiHint } from './types';
import { classifyAssistantTurn } from './turn-classifier';
import { FILLER_WORDS } from '../word-lists';
import { detectLanguage } from '../detect-language';
import {
  normaliseCodeInput,
  matchCodePattern,
  detectCodePatternFromTurn,
  type CodePatternHint,
} from './code-patterns';

// Words that indicate the speaker is clearly mid-sentence and more is coming
const DANGLING_WORDS: Record<string, Set<string>> = {
  en: new Set([
    // Prepositions expecting an object
    'to', 'for', 'from', 'at', 'in', 'on', 'with', 'by', 'about',
    'into', 'onto', 'between', 'through', 'during', 'until', 'towards',
    // Determiners expecting a noun
    'the', 'a', 'an', 'my', 'your', 'his', 'her', 'their', 'our', 'this', 'that', 'some', 'any',
    // Verbs that need a complement
    'is', 'are', 'was', 'am', 'been', 'being',
    // Conjunctions expecting a clause
    'and', 'but', 'or', 'because', 'since', 'although', 'while', 'if', 'when', 'that',
    // Incomplete phrases
    'of', 'than',
  ]),
  de: new Set([
    'zu', 'für', 'von', 'bei', 'mit', 'nach', 'auf', 'in', 'an', 'über', 'unter',
    'zwischen', 'durch', 'während', 'bis',
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer',
    'mein', 'dein', 'sein', 'ihr', 'unser', 'euer',
    'ist', 'sind', 'war', 'bin',
    'und', 'aber', 'oder', 'weil', 'wenn', 'dass', 'ob',
  ]),
};

// Strong affirmative/negative responses — sufficient for yes/no and confirmation questions
const AFFIRMATIVES: Record<string, Set<string>> = {
  en: new Set([
    'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'absolutely',
    'definitely', 'certainly', 'of course', 'right', 'correct',
    'please', 'go ahead', 'perfect', 'great', 'sounds good',
    'that works', "that's right", "that's correct", "that's fine",
  ]),
  de: new Set([
    'ja', 'genau', 'richtig', 'klar', 'natürlich', 'selbstverständlich',
    'ok', 'okay', 'stimmt', 'passt', 'gut', 'bitte', 'gerne',
    'auf jeden fall', 'das stimmt', 'das passt',
  ]),
};

const NEGATIVES: Record<string, Set<string>> = {
  en: new Set([
    'no', 'nope', 'nah', "don't", "doesn't", "can't", "won't",
    'never', 'not really', 'no thanks', 'no thank you',
    "i don't think so", "that's not right", "that's wrong",
  ]),
  de: new Set([
    'nein', 'ne', 'nö', 'nicht', 'kein', 'keine',
    'nein danke', 'das stimmt nicht', 'das ist falsch',
    'lieber nicht', 'eher nicht',
  ]),
};

function isPartialWord(word: string): boolean {
  // Only applies to single-word utterances (checked at call site).
  // A single word is "partial" if it's very short AND looks like a truncated word.
  // Known short words (I, a, no, ok, yes, hi) are valid — only flag truly ambiguous ones.
  if (word.length <= 3) return false;
  // If it ends mid-consonant-cluster, likely partial (e.g. "Ber" for "Berlin")
  // But 4+ letter words ending in consonant are usually complete (e.g. "Next", "Yes")
  return /[^aeiouyäöü]{2,}$/i.test(word) && word.length <= 4;
}

function endsWithDanglingWord(words: string[], lang: string): boolean {
  if (words.length === 0) return false;
  const lastWord = words[words.length - 1].toLowerCase().replace(/[.,!?;:'"…\-()]/g, '');
  const danglers = DANGLING_WORDS[lang] ?? DANGLING_WORDS['en'];
  return danglers.has(lastWord);
}

function matchesAnyPhrase(text: string, phrases: Set<string>): string | undefined {
  const lower = text.toLowerCase().trim();
  for (const phrase of phrases) {
    if (lower === phrase || lower.startsWith(phrase + ' ') || lower.startsWith(phrase + ',') || lower.startsWith(phrase + '.')) {
      return phrase;
    }
  }
  return undefined;
}

// Words that look like content but aren't real answers to wh/choice questions
// (contractions, question words used in counter-questions)
const NOT_ANSWER_WORDS = new Set([
  "i'd", "i'll", "i've", "i'm", "we'd", "we'll", "we've", "we're",
  "he'd", "he'll", "he's", "she'd", "she'll", "she's",
  "they'd", "they'll", "they've", "they're",
  "you'd", "you'll", "you've", "you're",
  "what's", "where's", "when's", "who's", "how's",
  "what", "where", "when", "who", "how", "why", "which",
]);

function getContentWords(text: string, lang: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const fillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
  return words.filter((w) => {
    const cleaned = w.replace(/[.,!?;:'"…\-()]/g, '');
    return cleaned.length > 0 && !fillers.has(cleaned);
  });
}

function hasSubstantialContent(text: string, lang: string, minContentWords = 2): boolean {
  return getContentWords(text, lang).length >= minContentWords;
}

// For wh/choice questions: needs at least 1 content word that looks like an actual
// answer (not a contraction or question word used in a counter-question)
function hasAnswerContent(text: string, lang: string): boolean {
  const words = text.toLowerCase().split(/\s+/);
  const fillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
  return words.some((w) => {
    const cleaned = w.replace(/[.,!?;:'"…\-()]/g, '');
    if (cleaned.length === 0) return false;
    if (fillers.has(cleaned) || fillers.has(w)) return false;
    // Check both raw and cleaned forms against not-answer words
    return !NOT_ANSWER_WORDS.has(w) && !NOT_ANSWER_WORDS.has(cleaned);
  });
}

export function detectFirePoint(
  partialUtterance: string,
  assistantPriorTurn: string,
  caiHint?: CaiHint,
): FirePointDecision {
  const lang = detectLanguage(partialUtterance || assistantPriorTurn);
  const turnType = classifyAssistantTurn(assistantPriorTurn);
  const words = partialUtterance.trim().split(/\s+/).filter((w) => w.length > 0);

  // Nothing heard yet
  if (words.length === 0) {
    return {
      shouldFire: false,
      confidence: 1.0,
      reason: 'no-words-yet',
      assistantTurnType: turnType,
    };
  }

  // Single partial word — never fire
  if (words.length === 1 && isPartialWord(words[0])) {
    return {
      shouldFire: false,
      confidence: 0.95,
      reason: 'partial-word',
      assistantTurnType: turnType,
    };
  }

  // --- Code pattern check ---
  // Resolve pattern hint: explicit cai hint takes priority, otherwise auto-detect.
  // Only applies to wh-question / unknown turn types — yes-no / confirmation
  // questions ask WHETHER the user has the code, not for the code itself.
  // Use assistant turn language for code detection — the partial utterance
  // may be too short for reliable language detection (e.g. "Die" = ambiguous).
  const codeLang = detectLanguage(assistantPriorTurn) || lang;
  const codeHint: CodePatternHint | undefined =
    (turnType === 'wh-question' || turnType === 'unknown' || turnType === 'open-ended')
      ? (caiHint?.codePattern ?? detectCodePatternFromTurn(assistantPriorTurn, codeLang))
      : caiHint?.codePattern; // explicit cai hint still honoured for any turn type

  if (codeHint) {
    const normalised = normaliseCodeInput(partialUtterance, codeLang);
    const match = matchCodePattern(normalised, codeHint);
    if (match.matched) {
      return {
        shouldFire: true,
        confidence: match.confidence,
        reason: `code-pattern: ${match.reason}`,
        assistantTurnType: turnType,
        detectedAnswer: partialUtterance.trim(),
        codePatternMatch: {
          normalisedValue: match.normalisedValue,
          patternType: codeHint.type,
          label: codeHint.label,
        },
      };
    }
    // Code pattern active but not yet filled — suppress regular fire logic.
    // Stay in code-waiting mode if:
    //   - We've seen digit-like content (user is dictating)
    //   - Last word is code-adjacent ("double", "triple", NATO, number word)
    //   - We've seen fewer than 3 words (might still be preamble)
    const hasCodeContent = normalised.digitCount > 0
      || normalised.endsWithCodeToken
      || normalised.endsWithTens;
    if (hasCodeContent || words.length < 3) {
      return {
        shouldFire: false,
        confidence: 0.8,
        reason: `code-pattern waiting: ${match.reason}`,
        assistantTurnType: turnType,
      };
    }
    // 3+ words with no code content — user isn't providing a code, fall through
  }

  // Last word is dangling (preposition, determiner, conjunction) — more is coming
  if (endsWithDanglingWord(words, lang)) {
    return {
      shouldFire: false,
      confidence: 0.9,
      reason: 'dangling-word',
      assistantTurnType: turnType,
    };
  }

  // Now decide based on what was asked
  const affirmatives = AFFIRMATIVES[lang] ?? AFFIRMATIVES['en'];
  const negatives = NEGATIVES[lang] ?? NEGATIVES['en'];

  switch (turnType) {
    case 'yes-no-question': {
      // Just need an affirmative or negative
      const affirm = matchesAnyPhrase(partialUtterance, affirmatives);
      if (affirm) {
        return {
          shouldFire: true,
          confidence: 0.9,
          reason: `yes-no answered with affirmative: "${affirm}"`,
          assistantTurnType: turnType,
          detectedAnswer: affirm,
        };
      }
      const neg = matchesAnyPhrase(partialUtterance, negatives);
      if (neg) {
        return {
          shouldFire: true,
          confidence: 0.9,
          reason: `yes-no answered with negative: "${neg}"`,
          assistantTurnType: turnType,
          detectedAnswer: neg,
        };
      }
      // If we have >3 words and it starts with yes/no, the rest is elaboration
      if (words.length >= 3) {
        const firstWord = words[0].toLowerCase().replace(/[.,!?]/g, '');
        if (affirmatives.has(firstWord) || negatives.has(firstWord)) {
          return {
            shouldFire: true,
            confidence: 0.8,
            reason: `yes-no answered with "${firstWord}" + elaboration`,
            assistantTurnType: turnType,
            detectedAnswer: firstWord,
          };
        }
      }
      break;
    }

    case 'confirmation': {
      // Similar to yes/no but also watch for corrections
      const affirm = matchesAnyPhrase(partialUtterance, affirmatives);
      if (affirm) {
        return {
          shouldFire: true,
          confidence: 0.85, // Slightly lower — user might correct after confirming
          reason: `confirmation affirmed: "${affirm}"`,
          assistantTurnType: turnType,
          detectedAnswer: affirm,
        };
      }
      const neg = matchesAnyPhrase(partialUtterance, negatives);
      if (neg) {
        // Negative to confirmation — wait until the correction arrives.
        // "No" → wait. "No it should be Saturday" → fire (has correction).
        if (hasAnswerContent(partialUtterance, lang)) {
          return {
            shouldFire: true,
            confidence: 0.8,
            reason: `confirmation rejected with correction: "${neg}"`,
            assistantTurnType: turnType,
            detectedAnswer: partialUtterance.trim(),
          };
        }
        return {
          shouldFire: false,
          confidence: 0.8,
          reason: 'confirmation rejected — waiting for correction',
          assistantTurnType: turnType,
        };
      }
      break;
    }

    case 'choice-question': {
      // Need to hear which choice they picked — a single answer word is enough
      // ("Premium" after "Standard or premium?")
      if (hasAnswerContent(partialUtterance, lang)) {
        return {
          shouldFire: true,
          confidence: 0.8,
          reason: 'choice answered with content',
          assistantTurnType: turnType,
          detectedAnswer: partialUtterance.trim(),
        };
      }
      break;
    }

    case 'wh-question': {
      // Need the specific entity/answer — a single answer word is enough
      // ("Berlin" after "What city?", "Four" after "How many?")
      if (hasAnswerContent(partialUtterance, lang)) {
        return {
          shouldFire: true,
          confidence: 0.75,
          reason: 'wh-question answered with content',
          assistantTurnType: turnType,
          detectedAnswer: partialUtterance.trim(),
        };
      }
      break;
    }

    case 'information':
    case 'action-complete': {
      // User is likely to acknowledge — fire on any ack
      const affirm = matchesAnyPhrase(partialUtterance, affirmatives);
      if (affirm) {
        return {
          shouldFire: true,
          confidence: 0.85,
          reason: `acknowledged: "${affirm}"`,
          assistantTurnType: turnType,
          detectedAnswer: affirm,
        };
      }
      const neg = matchesAnyPhrase(partialUtterance, negatives);
      if (neg) {
        return {
          shouldFire: true,
          confidence: 0.8,
          reason: `disagreed: "${neg}"`,
          assistantTurnType: turnType,
          detectedAnswer: neg,
        };
      }
      // User might ask a follow-up — need substantial content
      if (words.length >= 4 && hasSubstantialContent(partialUtterance, lang)) {
        return {
          shouldFire: true,
          confidence: 0.7,
          reason: 'follow-up with content after information',
          assistantTurnType: turnType,
          detectedAnswer: partialUtterance.trim(),
        };
      }
      break;
    }

    case 'open-ended': {
      // Need to hear the intent AND likely an entity — require more words
      if (words.length >= 4 && hasSubstantialContent(partialUtterance, lang)) {
        return {
          shouldFire: true,
          confidence: 0.7,
          reason: 'open-ended answered with sufficient content',
          assistantTurnType: turnType,
          detectedAnswer: partialUtterance.trim(),
        };
      }
      break;
    }

    case 'unknown': {
      // Conservative: require substantial content and no dangling
      if (words.length >= 3 && hasSubstantialContent(partialUtterance, lang)) {
        return {
          shouldFire: true,
          confidence: 0.6,
          reason: 'unknown context — has substantial content',
          assistantTurnType: turnType,
          detectedAnswer: partialUtterance.trim(),
        };
      }
      break;
    }
  }

  // Default: don't fire
  return {
    shouldFire: false,
    confidence: 0.5,
    reason: 'insufficient content for turn type',
    assistantTurnType: turnType,
  };
}
