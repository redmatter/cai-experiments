// Code Pattern Detection — fires early when transcribed input
// matches an expected structured code pattern.
//
// When the assistant asks for an account number, postcode, sort code, etc.,
// we know the expected shape. Instead of waiting for content-word detection,
// we normalise the ASR output (word-numbers → digits, NATO → letters) and
// fire as soon as the normalised buffer fills the pattern.
//
// The normaliser doesn't need to be perfect — false fires are safe
// (stability checker catches them at end-of-turn).

// --- Pattern Hint ---
// Can come from:
//   1. Auto-detection by turn classifier (assistant said "account number")
//   2. Explicit hint from cai-websocket (structured metadata alongside the turn)

export interface CodePatternHint {
  type: CodePatternType;
  minLength?: number;       // for digits-n / reference patterns
  maxLength?: number;
  customRegex?: string;     // for 'custom' type — cai provides the regex
  label?: string;           // human-readable label for reports
}

export type CodePatternType =
  | 'uk-postcode'       // SW1A 1AA — letter(s) + digit(s) + space + digit + letters
  | 'account-number'    // 8 digits (configurable)
  | 'sort-code'         // 6 digits (NN-NN-NN)
  | 'phone-uk'          // 11 digits starting with 0
  | 'digits-n'          // exactly N digits (generic)
  | 'reference-code'    // alphanumeric, configurable length
  | 'custom';           // regex from cai hint

// --- ASR Normaliser ---
// Converts spoken-form transcription to a normalised string for pattern matching.
// Handles: word-numbers, NATO alphabet, "double"/"triple", homophones.

const WORD_TO_DIGIT: Record<string, string> = {
  zero: '0', oh: '0', o: '0', nought: '0',
  one: '1', won: '1',
  two: '2', to: '2', too: '2',
  three: '3', tree: '3',
  four: '4', for: '4', fore: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8', ate: '8',
  nine: '9', niner: '9',
};

// Teens and tens — normalise to digit sequences
const TEENS: Record<string, string> = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19',
};

const TENS: Record<string, string> = {
  twenty: '2', thirty: '3', forty: '4', fifty: '5',
  sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};

const NATO_TO_LETTER: Record<string, string> = {
  alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D',
  echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H', india: 'I',
  juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M',
  november: 'N', oscar: 'O', papa: 'P', quebec: 'Q', romeo: 'R',
  sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W',
  whisky: 'W', xray: 'X', 'x-ray': 'X', yankee: 'Y', zulu: 'Z',
};

// German number words
const DE_WORD_TO_DIGIT: Record<string, string> = {
  null: '0',
  eins: '1', ein: '1', eine: '1',
  zwei: '2', zwo: '2',
  drei: '3',
  vier: '4',
  fünf: '5', fuenf: '5',
  sechs: '6',
  sieben: '7',
  acht: '8',
  neun: '9',
};

const DE_TEENS: Record<string, string> = {
  zehn: '10', elf: '11', zwölf: '12', zwoelf: '12',
  dreizehn: '13', vierzehn: '14', fünfzehn: '15', fuenfzehn: '15',
  sechzehn: '16', siebzehn: '17', achtzehn: '18', neunzehn: '19',
};

const DE_TENS: Record<string, string> = {
  zwanzig: '2', dreißig: '3', dreissig: '3', vierzig: '4',
  fünfzig: '5', fuenfzig: '5', sechzig: '6', siebzig: '7',
  achtzig: '8', neunzig: '9',
};

export interface NormalisedResult {
  normalised: string;       // digits + uppercase letters only
  digitCount: number;
  letterCount: number;
  totalLength: number;
  endsWithTens: boolean;    // last token was a tens word — might be partial compound
  endsWithCodeToken: boolean; // last word resolved to a code char — more code may follow
  raw: string;              // original input
}

export function normaliseCodeInput(input: string, lang = 'en'): NormalisedResult {
  const words = input.toLowerCase().trim().split(/[\s\-,./]+/).filter((w) => w.length > 0);
  const chars: string[] = [];
  let endsWithTens = false;    // last resolved token was a tens word (might be partial compound)
  let endsWithCodeToken = false; // last word was a digit/number/NATO (more code may follow)

  const wordDigits = lang === 'de'
    ? { ...WORD_TO_DIGIT, ...DE_WORD_TO_DIGIT }
    : WORD_TO_DIGIT;
  const teens = lang === 'de' ? DE_TEENS : TEENS;
  const tens = lang === 'de' ? DE_TENS : TENS;

  let i = 0;
  while (i < words.length) {
    const w = words[i].replace(/[.,!?;:'"…()]/g, '');

    // Skip "as in" / "like" / "wie" preambles (e.g. "B as in Bravo")
    if (w === 'as' && words[i + 1] === 'in') {
      i += 2;
      continue;
    }
    if (w === 'wie') {
      i += 1;
      continue;
    }

    // "double" / "triple" → repeat next char
    if (w === 'double' || w === 'doppel') {
      i++;
      if (i < words.length) {
        const next = resolveChar(words[i], wordDigits, teens, tens);
        chars.push(next, next);
        endsWithCodeToken = true;
        i++;
      } else {
        // "double" at end of partial — next word hasn't arrived yet
        endsWithCodeToken = true;
      }
      endsWithTens = false;
      continue;
    }
    if (w === 'triple' || w === 'dreifach') {
      i++;
      if (i < words.length) {
        const next = resolveChar(words[i], wordDigits, teens, tens);
        chars.push(next, next, next);
        endsWithCodeToken = true;
        i++;
      } else {
        endsWithCodeToken = true;
      }
      endsWithTens = false;
      continue;
    }

    // Tens + unit compound: "twenty three" → "23", "forty two" → "42"
    if (tens[w]) {
      const tensDigit = tens[w];
      const nextWord = words[i + 1]?.replace(/[.,!?;:'"…()]/g, '');
      if (nextWord && wordDigits[nextWord]) {
        chars.push(tensDigit, wordDigits[nextWord]);
        endsWithTens = false;
        endsWithCodeToken = true;
        i += 2;
        continue;
      }
      // Tens alone: "twenty" → "20" but mark as potentially incomplete
      // (user might say "twenty three" with the unit arriving next word)
      chars.push(tensDigit, '0');
      endsWithTens = true;
      endsWithCodeToken = true;
      i++;
      continue;
    }

    // Resolve single char
    const resolved = resolveChar(w, wordDigits, teens, tens);
    if (resolved) {
      chars.push(resolved);
      endsWithTens = false;
      endsWithCodeToken = true;
    } else {
      endsWithTens = false;
      endsWithCodeToken = false;
    }
    i++;
  }

  const normalised = chars.join('');
  const digitCount = (normalised.match(/\d/g) || []).length;
  const letterCount = (normalised.match(/[A-Z]/g) || []).length;

  return {
    normalised,
    digitCount,
    letterCount,
    totalLength: normalised.length,
    endsWithTens,
    endsWithCodeToken,
    raw: input,
  };
}

function resolveChar(
  word: string,
  wordDigits: Record<string, string>,
  teens: Record<string, string>,
  tens: Record<string, string>,
): string {
  const cleaned = word.replace(/[.,!?;:'"…()]/g, '');

  // Bare digit(s) — pass through
  if (/^\d+$/.test(cleaned)) return cleaned;

  // Single letter (A-Z) — pass through as uppercase
  if (/^[a-z]$/i.test(cleaned)) return cleaned.toUpperCase();

  // Word number → digit
  if (wordDigits[cleaned]) return wordDigits[cleaned];

  // Teens → two-digit string
  if (teens[cleaned]) return teens[cleaned];

  // NATO alphabet → letter
  if (NATO_TO_LETTER[cleaned]) return NATO_TO_LETTER[cleaned];

  // Unknown word — skip (filler, preposition, etc.)
  return '';
}

// --- Pattern Matching ---

export interface PatternMatchResult {
  matched: boolean;
  confidence: number;
  normalisedValue: string;
  reason: string;
}

export function matchCodePattern(
  normalised: NormalisedResult,
  hint: CodePatternHint,
): PatternMatchResult {
  const val = normalised.normalised;

  // If the last word resolved to a tens word (e.g. "sixty"), the unit might
  // be arriving next ("sixty seven"). Don't fire on tens-ending partials
  // unless we're already well past the min length.
  if (normalised.endsWithTens) {
    return { matched: false, confidence: 0.3, normalisedValue: val, reason: `ends with tens word — unit may follow (${val})` };
  }

  // For truly variable-length patterns (reference-code), if the last word
  // resolved to a code token the user is likely still dictating. Wait for
  // a non-code word (e.g. "please", "that's it") or maxLength.
  // Does NOT apply to fixed-range patterns (account-number, sort-code, etc.)
  // where the acceptable range is narrow enough to fire on min.
  if (hint.type === 'reference-code' && normalised.endsWithCodeToken) {
    const max = hint.maxLength ?? 12;
    if (normalised.totalLength < max) {
      return { matched: false, confidence: 0.4, normalisedValue: val, reason: `still dictating (${val}), waiting for non-code word or max length` };
    }
  }

  switch (hint.type) {
    case 'digits-n': {
      const min = hint.minLength ?? 4;
      const max = hint.maxLength ?? min;
      if (normalised.digitCount >= min && normalised.digitCount <= max && normalised.letterCount === 0) {
        return {
          matched: true,
          confidence: 0.85,
          normalisedValue: val,
          reason: `${normalised.digitCount}-digit code detected (expected ${min}${max !== min ? `-${max}` : ''})`,
        };
      }
      return { matched: false, confidence: 0, normalisedValue: val, reason: `need ${min} digits, have ${normalised.digitCount}` };
    }

    case 'account-number': {
      const min = hint.minLength ?? 7;
      const max = hint.maxLength ?? 10;
      if (normalised.digitCount >= min && normalised.digitCount <= max) {
        return {
          matched: true,
          confidence: 0.85,
          normalisedValue: val,
          reason: `${normalised.digitCount}-digit account number detected`,
        };
      }
      return { matched: false, confidence: 0, normalisedValue: val, reason: `need ${min}-${max} digits, have ${normalised.digitCount}` };
    }

    case 'sort-code': {
      // 6 digits
      const digits = val.replace(/\D/g, '');
      if (digits.length >= 6) {
        return {
          matched: true,
          confidence: 0.9,
          normalisedValue: digits.slice(0, 6),
          reason: `sort code detected: ${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`,
        };
      }
      return { matched: false, confidence: 0, normalisedValue: val, reason: `need 6 digits, have ${digits.length}` };
    }

    case 'phone-uk': {
      const digits = val.replace(/\D/g, '');
      if (digits.length >= 11) {
        return {
          matched: true,
          confidence: 0.85,
          normalisedValue: digits.slice(0, 11),
          reason: `UK phone number detected (${digits.length} digits)`,
        };
      }
      return { matched: false, confidence: 0, normalisedValue: val, reason: `need 11 digits, have ${digits.length}` };
    }

    case 'uk-postcode': {
      // UK postcode: A9 9AA, A99 9AA, A9A 9AA, AA9 9AA, AA99 9AA, AA9A 9AA
      // After normalisation: letters and digits mixed
      const pcRegex = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
      if (pcRegex.test(val)) {
        return {
          matched: true,
          confidence: 0.9,
          normalisedValue: val,
          reason: `UK postcode pattern matched: ${val}`,
        };
      }
      // Partial match — check if we're getting close
      const partialPc = /^[A-Z]{1,2}\d/;
      if (partialPc.test(val) && val.length < 5) {
        return { matched: false, confidence: 0.3, normalisedValue: val, reason: `partial postcode: ${val}` };
      }
      return { matched: false, confidence: 0, normalisedValue: val, reason: `not a UK postcode pattern: ${val}` };
    }

    case 'reference-code': {
      const min = hint.minLength ?? 4;
      const max = hint.maxLength ?? 12;
      if (normalised.totalLength >= min && normalised.totalLength <= max) {
        return {
          matched: true,
          confidence: 0.75,
          normalisedValue: val,
          reason: `reference code detected (${normalised.totalLength} chars)`,
        };
      }
      return { matched: false, confidence: 0, normalisedValue: val, reason: `need ${min}-${max} chars, have ${normalised.totalLength}` };
    }

    case 'custom': {
      if (!hint.customRegex) {
        return { matched: false, confidence: 0, normalisedValue: val, reason: 'no custom regex provided' };
      }
      const regex = new RegExp(hint.customRegex);
      if (regex.test(val)) {
        return {
          matched: true,
          confidence: 0.8,
          normalisedValue: val,
          reason: `custom pattern matched: /${hint.customRegex}/`,
        };
      }
      return { matched: false, confidence: 0, normalisedValue: val, reason: `custom pattern not matched: ${val}` };
    }

    default:
      return { matched: false, confidence: 0, normalisedValue: val, reason: 'unknown pattern type' };
  }
}

// --- Pattern Extraction from Assistant Turn ---
// Auto-detects what kind of code the assistant is asking for.

const CODE_REQUEST_PATTERNS: Array<{ pattern: RegExp; hint: CodePatternHint }> = [
  // Account number
  {
    pattern: /\b(account|a\/c)\s*(number|no\.?|code|#)\b/i,
    hint: { type: 'account-number', minLength: 7, maxLength: 10, label: 'account number' },
  },
  // Sort code
  {
    pattern: /\bsort\s*code\b/i,
    hint: { type: 'sort-code', label: 'sort code' },
  },
  // Postcode
  {
    pattern: /\b(post\s*code|zip\s*code|postal\s*code)\b/i,
    hint: { type: 'uk-postcode', label: 'postcode' },
  },
  // Phone / mobile number
  {
    pattern: /\b(phone|mobile|telephone|contact)\s*(number|no\.?|#)?\b/i,
    hint: { type: 'phone-uk', label: 'phone number' },
  },
  // Reference / booking / order number
  {
    pattern: /\b(reference|booking|order|confirmation|tracking)\s*(number|no\.?|code|id|#)\b/i,
    hint: { type: 'reference-code', minLength: 4, maxLength: 12, label: 'reference code' },
  },
  // PIN
  {
    pattern: /\b(pin|pin\s*code|pin\s*number)\b/i,
    hint: { type: 'digits-n', minLength: 4, maxLength: 6, label: 'PIN' },
  },
  // Generic "number" / "code" with digit hint
  {
    pattern: /\b(\d+)\s*digit\s*(number|code|pin)\b/i,
    hint: { type: 'digits-n', label: 'numeric code' },
  },
  // Card number (last 4 / full 16)
  {
    pattern: /\b(card)\s*(number|no\.?|#)\b/i,
    hint: { type: 'digits-n', minLength: 4, maxLength: 16, label: 'card number' },
  },
  // "last four digits"
  {
    pattern: /\blast\s*(four|4)\s*digits\b/i,
    hint: { type: 'digits-n', minLength: 4, maxLength: 4, label: 'last 4 digits' },
  },
];

// German patterns
const DE_CODE_REQUEST_PATTERNS: Array<{ pattern: RegExp; hint: CodePatternHint }> = [
  {
    pattern: /\b(konto|konten)\s*(nummer|nr\.?)\b/i,
    hint: { type: 'account-number', minLength: 7, maxLength: 10, label: 'Kontonummer' },
  },
  {
    pattern: /\b(bankleitzahl|blz)\b/i,
    hint: { type: 'sort-code', label: 'BLZ' },
  },
  {
    pattern: /\b(postleitzahl|plz)\b/i,
    hint: { type: 'digits-n', minLength: 5, maxLength: 5, label: 'PLZ' },
  },
  {
    pattern: /\b(telefon|handy|mobil)\s*(nummer|nr\.?)?\b/i,
    hint: { type: 'phone-uk', label: 'Telefonnummer' },
  },
  {
    pattern: /\b(referenz|buchungs?|bestell?)\s*(nummer|nr\.?|code)?\b/i,
    hint: { type: 'reference-code', minLength: 4, maxLength: 12, label: 'Referenznummer' },
  },
  {
    pattern: /\bpin\b/i,
    hint: { type: 'digits-n', minLength: 4, maxLength: 6, label: 'PIN' },
  },
];

export function detectCodePatternFromTurn(
  assistantTurn: string,
  lang = 'en',
): CodePatternHint | undefined {
  const patterns = lang === 'de' ? DE_CODE_REQUEST_PATTERNS : CODE_REQUEST_PATTERNS;

  for (const { pattern, hint } of patterns) {
    const match = assistantTurn.match(pattern);
    if (match) {
      // Special handling: extract digit count from "N digit code" patterns
      if (hint.type === 'digits-n' && match[1] && /^\d+$/.test(match[1])) {
        const n = parseInt(match[1], 10);
        return { ...hint, minLength: n, maxLength: n, label: `${n}-digit code` };
      }
      return hint;
    }
  }

  return undefined;
}
