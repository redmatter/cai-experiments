// Turn Classifier — classifies the assistant's last turn to determine
// what kind of answer the user is expected to give.
// This is the key insight: what counts as "enough" depends entirely
// on what was asked.

import type { AssistantTurnType } from './types';
import { detectLanguage } from '../detect-language';

// Patterns for each turn type, checked in order (first match wins)
const PATTERNS: Array<{ type: AssistantTurnType; patterns: RegExp[] }> = [
  // Open-ended first — "How can I help?" is open-ended, not a wh-question
  {
    type: 'open-ended',
    patterns: [
      /\bhow can (I|we) (help|assist)\b/i,
      /\bwhat can (I|we) (do|help)\b/i,
      /\b(tell me more|go ahead|please continue)\b/i,
    ],
  },
  // WH-questions before yes-no — "What would you like?" is a wh-question, not yes-no
  {
    type: 'wh-question',
    patterns: [
      /\b(what|which|where|when|how|who|whose|how many|how much|how long)\b.*\?/i,
      /\b(what'?s?|where'?s?|when'?s?|who'?s?)\b/i,
      // Indirect questions
      /\bcould you (tell|give|provide)\b/i,
      /\bcan you (tell|give|provide)\b/i,
    ],
  },
  // Choice before yes-no — "Would you prefer X or Y?" is a choice question
  {
    type: 'choice-question',
    patterns: [
      /\b(or)\b.*\?/i,                           // "X or Y?"
      /\b(prefer|rather)\b.*\?/i,                 // "Would you prefer?"
      /\b(standard|premium|basic|economy|first)\b.*\bor\b/i,
    ],
  },
  {
    type: 'confirmation',
    patterns: [
      /\bso\s+(that'?s?|it'?s?|you)\b/i,         // "So that's 3 nights..."
      /\bjust to confirm\b/i,
      /\blet me (confirm|check|verify|repeat)\b/i,
      /\bto (confirm|summarise|recap)\b/i,
      /\byou('d| would) like\b.*\b(correct|right)\b/i,
    ],
  },
  {
    type: 'yes-no-question',
    patterns: [
      // Direct yes/no questions
      /\b(would you|do you|can I|shall I|should I|may I|could I|will you|are you|is that|does that|did you|have you|has it|was it|were you)\b.*\?/i,
      // Tag questions
      /\b(right|correct|ok|okay)\s*\?/i,
      // "Is there anything else"
      /\b(is there|are there)\s+(anything|something)\b/i,
      // "Would that work"
      /\bwould that\b.*\?/i,
    ],
  },
  {
    type: 'action-complete',
    patterns: [
      /\b(i'?ve|i have)\s+(booked|reserved|cancelled|updated|changed|sent|confirmed|processed)\b/i,
      /\b(booking|reservation|cancellation|update)\s+(is\s+)?(confirmed|complete|done)\b/i,
      /\b(that'?s?\s+)?(all\s+)?(done|sorted|taken care of|processed)\b/i,
      /\breference\s+(number|code|id)\b/i,
    ],
  },
  {
    type: 'information',
    patterns: [
      /\b(your|the)\s+(\w+\s+)*(balance|total|amount|price|cost|fee|charge)\b/i,
      /\b(it|that)\s+(costs?|is|was|will be)\b/i,
      /\b(here|there)\s+(are|is)\s+(your|the)\b/i,
      /\bthe\s+(address|phone|number|email|postcode|reference)\s+(is|was)\b/i,
      /\b(I can see|I found|the results show|we have)\b/i,
    ],
  },
];

// German patterns
const DE_PATTERNS: Array<{ type: AssistantTurnType; patterns: RegExp[] }> = [
  // Open-ended first
  {
    type: 'open-ended',
    patterns: [
      /\bwie kann ich (Ihnen )?helfen\b/i,
      /\bwas kann ich (für Sie )?(tun|machen)\b/i,
      /\b(gibt es|haben Sie)\s+(noch)?\s*(etwas|was)\b/i,
    ],
  },
  // WH-questions before yes-no
  {
    type: 'wh-question',
    patterns: [
      /\b(was|welche[rns]?|wo|wann|wie|wer|wessen|wie ?viel[e]?|wie ?lange)\b.*\?/i,
      /\bkönn(t?en|ten) Sie (mir|uns)\s+(sagen|geben|nennen)\b/i,
    ],
  },
  // Choice before yes-no
  {
    type: 'choice-question',
    patterns: [
      /\b(oder)\b.*\?/i,
      /\b(bevorzugen|lieber)\b.*\?/i,
    ],
  },
  {
    type: 'confirmation',
    patterns: [
      /\balso\b.*\b(richtig|korrekt|stimmt)\b/i,
      /\bzur Bestätigung\b/i,
      /\bnoch ?mal zusammen(gefasst|fassen)\b/i,
    ],
  },
  {
    type: 'yes-no-question',
    patterns: [
      /\b(möchten Sie|wollen Sie|soll ich|kann ich|darf ich|haben Sie|sind Sie|ist das|war das)\b.*\?/i,
      /\b(richtig|korrekt|stimmt das)\s*\?/i,
    ],
  },
  {
    type: 'action-complete',
    patterns: [
      /\b(ich habe|wir haben)\s+(gebucht|reserviert|storniert|aktualisiert|geändert|bestätigt)\b/i,
      /\b(buchung|reservierung|stornierung)\s+(ist\s+)?(bestätigt|abgeschlossen)\b/i,
    ],
  },
  {
    type: 'information',
    patterns: [
      /\b(Ihr|der|die|das)\s+(\w+\s+)*(Kontostand|Betrag|Preis|Kosten|Gebühr)\b/i,
      /\b(es|das)\s+(kostet|beträgt|ist|war)\b/i,
    ],
  },
];

export function classifyAssistantTurn(turn: string): AssistantTurnType {
  const lang = detectLanguage(turn);
  const patterns = lang === 'de' ? DE_PATTERNS : PATTERNS;

  for (const { type, patterns: regexes } of patterns) {
    for (const regex of regexes) {
      if (regex.test(turn)) {
        return type;
      }
    }
  }

  return 'unknown';
}
