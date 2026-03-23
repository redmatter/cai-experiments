// Word lists for semantic stability heuristic analysis.
// Organised by language and function.
//
// These lists determine whether new tokens in an extended utterance
// change the meaning (content words) or just reinforce it (fillers).
//
// RULES:
// - A word in FILLER_WORDS will never trigger a DIFFERENT verdict on its own
// - A word in NEGATION_MARKERS will push toward DIFFERENT
// - REVERSAL_PHRASES are multi-word patterns that always mean DIFFERENT
// - ADDITION_MARKERS + substantial content = DIFFERENT (topic shift)
//
// SAFETY: When in doubt, do NOT add a word to FILLER_WORDS.
// A missing filler = false negative (safe, just extra latency).
// A wrong filler = false positive (dangerous, wrong response sent).

// === FILLER / DISCOURSE MARKERS ===
// Words that reinforce, acknowledge, or elaborate without changing actionable meaning.

export const FILLER_WORDS: Record<string, Set<string>> = {
  en: new Set([
    // Backchannels & acknowledgements
    'yeah', 'yes', 'yep', 'yup', 'no', 'nope',
    'ok', 'okay', 'right', 'sure', 'well', 'alright',

    // Discourse markers & hedges
    'so', 'like', 'just', 'actually', 'basically',
    'anyway', 'though', 'really', 'honestly',

    // Pronouns (never actionable on their own)
    'i', 'me', 'my', 'mine', 'you', 'your', 'yours',
    'we', 'us', 'our', 'he', 'she', 'they', 'them',

    // Cognitive verbs (used in hedging: "I think", "I guess")
    'think', 'guess', 'mean', 'know', 'see', 'believe', 'suppose',

    // Determiners & articles
    'that', 'this', 'it', 'the', 'a', 'an', 'some', 'any',

    // Copulas & auxiliaries
    'is', 'are', 'was', 'am', 'be', 'been', 'being',
    'do', 'does', 'did', 'has', 'have', 'had',
    'would', 'could', 'should', 'can', 'will', 'may', 'might',

    // Positive evaluations (reinforcement, not new info)
    'makes', 'sense', 'sounds', 'good', 'great', 'fine', 'perfect',
    'wonderful', 'lovely', 'excellent', 'brilliant', 'fantastic', 'nice',
    'awesome', 'helpful',
    'absolutely', 'definitely', 'certainly', 'exactly', 'indeed',

    // Politeness & gratitude
    'please', 'thanks', 'thank', 'appreciate', 'cheers', 'ta',

    // Prepositions (structural, not content)
    'for', 'to', 'of', 'in', 'on', 'at', 'with', 'by', 'from', 'about',

    // Conjunctions
    'and', 'or', 'but', 'if', 'then', 'so', 'because', 'since',

    // Degree words
    'very', 'quite', 'pretty', 'rather', 'really', 'too',

    // Hesitation markers
    'um', 'uh', 'hmm', 'ah', 'oh', 'er', 'erm',

    // Contractions
    "that's", "it's", "i'm", "don't", "doesn't", "isn't", "won't",
    "i'll", "we'll", "you're", "they're", "i've", "we've",

    // Conversational reinforcement (safe in tail position)
    // NOTE: 'broken', 'problem', 'work', 'working', 'help', 'need', 'want'
    // intentionally excluded — they carry content in many contexts.
    'worries', 'course', 'way',
    'possible',
    'go', 'going', 'gone', 'get', 'got',
    'try',
    'much', 'more', 'enough',
    'all', 'everything', 'nothing',
    'here', 'there',
    'now', 'again',
    'already', 'still',
    'say', 'said', 'tell', 'told',
    'look', 'looking',
    'take', 'give',
    'come', 'came',
    'make', 'made',
    'let', 'put',
  ]),

  de: new Set([
    // Backchannels & acknowledgements
    'ja', 'genau', 'richtig', 'gut', 'stimmt',
    'ok', 'okay', 'also', 'na', 'nun', 'eben',

    // Discourse markers & hedges
    'schon', 'halt', 'mal', 'denn', 'wohl',
    'eigentlich', 'sozusagen', 'irgendwie',

    // Pronouns
    'ich', 'mich', 'mir', 'du', 'dich', 'dir',
    'wir', 'uns', 'sie', 'er', 'ihm', 'ihr',

    // Cognitive verbs
    'glaube', 'denke', 'meine', 'finde', 'weiß',

    // Evaluations
    'klar', 'klingt', 'passt', 'alles',
    'wunderbar', 'prima', 'super', 'toll', 'schön',
    'selbstverständlich',

    // Determiners & articles
    'das', 'dies', 'es', 'der', 'die', 'den', 'dem', 'des',
    'ein', 'eine', 'einen', 'einem', 'einer',

    // Copulas & auxiliaries
    'ist', 'sind', 'war', 'bin', 'sein', 'gewesen',
    'haben', 'hat', 'hatte', 'habe',
    'kann', 'könnte', 'würde', 'soll', 'sollte', 'will', 'möchte',
    'werden', 'wird', 'wurde',

    // Politeness
    'bitte', 'danke', 'gerne', 'vielen', 'dank',
    'auf', 'jeden', 'fall',

    // Degree words
    'so', 'sehr', 'ganz', 'ziemlich', 'recht',

    // Hesitation markers
    'äh', 'ähm', 'hmm', 'ach', 'oh', 'na ja',

    // NOTE: 'nicht', 'kein', 'keine', 'nein', 'doch' intentionally excluded
    // — they signal negation/reversal

    // Conjunctions & prepositions
    'und', 'oder', 'aber', 'wenn', 'dann', 'weil',
    'für', 'zu', 'von', 'in', 'an', 'auf', 'mit', 'bei', 'nach',

    // Conversational reinforcement
    // NOTE: 'funktioniert', 'brauche' intentionally excluded — content words
    'einfach', 'geht', 'möglich',
    'wirklich', 'natürlich', 'sicher',
    'hier', 'da', 'dort',
    'jetzt', 'noch', 'schon', 'wieder',
    'sagen', 'gesagt',
    'machen', 'gemacht',
    'geben', 'nehmen',
    'kommen', 'gehen',
    'lassen',
  ]),
};

// === NEGATION / REVERSAL MARKERS ===
// Individual words that signal the speaker is reversing or negating.

export const NEGATION_MARKERS: Record<string, Set<string>> = {
  en: new Set([
    'not', "n't", 'never', 'no', 'none', 'neither', 'nor',
    'wait', 'sorry', 'wrong', 'mistake',
    'instead', 'cancel', 'stop',
  ]),
  de: new Set([
    'nicht', 'kein', 'keine', 'keinen', 'keinem', 'nie', 'niemals',
    'warten', 'nein', 'doch', 'falsch', 'fehler',
    'stattdessen', 'lieber', 'stornieren',
    'entschuldigung', 'moment',
  ]),
};

// === REVERSAL PHRASES ===
// Multi-word patterns that always indicate meaning has changed.
// Checked against the full final utterance (case-insensitive).

export const REVERSAL_PHRASES: Record<string, string[]> = {
  en: [
    'actually no', 'wait no', 'sorry no', 'never mind',
    "don't want", 'not right', "that's wrong", 'I meant',
    'I mean', 'correction', 'let me correct',
    'on second thought', 'changed my mind',
  ],
  de: [
    'doch nicht', 'nein warten', 'moment mal',
    'ich meine', 'ich meinte', 'korrektur',
    'gar nicht', 'stimmt nicht', 'anders gesagt',
  ],
};

// === CLOSING / FAREWELL WORDS ===
// Words and short phrases that signal end-of-conversation.
// These don't change the actionable meaning — "Yes" and "Yes, goodbye"
// require the same action from the assistant.
// Kept separate from FILLER_WORDS because these ARE content words in other
// contexts (e.g. "I need to say goodbye to someone").

export const CLOSING_WORDS: Record<string, Set<string>> = {
  en: new Set([
    'goodbye', 'bye', 'byebye',
    // NOTE: 'today', 'later', 'morning', 'afternoon', 'evening'
    // intentionally excluded — they carry temporal content in many contexts
    // ("schedule it for later today", "events this afternoon").
    'day', 'night',  // safe alone — only "today"/"tonight" compounds are risky
    'have', 'nice', 'lovely',
    'done', 'finished',
    'see', 'soon', 'around',
    'care', 'safe',
  ]),
  de: new Set([
    'tschüss', 'tschüs', 'wiedersehen', 'wiederhören',
    'schönen', 'tag', 'nacht',
    'bis', 'bald',
    'mach', 'pass',
  ]),
};

// === CLOSING PHRASES ===
// Multi-word patterns that signal acknowledgement/closing without changing
// actionable meaning. Checked against the delta (new tokens only).
// These handle phrases like "that works" and "that is all I need" where
// individual words are too risky to add to FILLER_WORDS or CLOSING_WORDS.

export const CLOSING_PHRASES: Record<string, string[]> = {
  en: [
    'that works', 'that works for me', 'that works well',
    'that is all', 'that is all i need', "that's all", "that's all i need",
    'all i need', 'all that i need', 'all for today',
    'sounds awesome', 'sounds perfect', 'sounds wonderful',
    'have a good', 'have a great', 'have a nice', 'have a lovely',
  ],
  de: [
    'das passt', 'das passt mir', 'das ist alles',
    'das wäre alles', 'mehr brauche ich nicht',
    'schönen tag noch',
  ],
};

// === CATEGORY NOUNS ===
// Generic nouns that clarify an already-obvious category without adding
// new actionable information. "Italian" → "Italian food" is the same intent.
// Only used when a single category noun is the sole content in the delta.

export const CATEGORY_NOUNS: Record<string, Set<string>> = {
  en: new Set([
    'food', 'restaurant', 'hotel', 'place',
    'cuisine', 'style', 'type', 'kind',
    // NOTE: 'one' intentionally excluded — too ambiguous
    // ("the premium one" = filler, "one in the afternoon" = time content)
  ]),
  de: new Set([
    'essen', 'restaurant', 'hotel', 'küche',
    'art', 'sorte', 'typ',
  ]),
};

// === ADDITION MARKERS ===
// Conjunctions/phrases that signal a new topic or request is being appended.
// Only triggers DIFFERENT if followed by substantial content (>3 tokens).

export const ADDITION_MARKERS: Record<string, Set<string>> = {
  en: new Set([
    'and', 'also', 'plus', 'another', 'besides',
    'additionally', 'furthermore', 'moreover',
    'one more', 'before you go', 'while I have you',
  ]),
  de: new Set([
    'und', 'auch', 'außerdem', 'zusätzlich',
    'noch', 'dazu', 'darüber hinaus',
    'bevor', 'noch eine',
  ]),
};
