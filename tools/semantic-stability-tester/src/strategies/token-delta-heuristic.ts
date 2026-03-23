// Strategy 3: Token Delta Heuristic
// Fast approach — analyses only the new tokens added between interim and final.
// Classifies delta tokens as fillers, content words, negation markers, etc.
// No model needed — pure linguistic rules.

import type { StabilityStrategy, StabilityResult, ConversationContext, ContextRichness, ContextRichnessLevel } from '../types';
import {
  FILLER_WORDS,
  NEGATION_MARKERS,
  REVERSAL_PHRASES,
  ADDITION_MARKERS,
  CLOSING_WORDS,
  CLOSING_PHRASES,
  CATEGORY_NOUNS,
} from '../word-lists';
import { classifyAssistantTurn } from '../fire-point/turn-classifier';
import type { AssistantTurnType } from '../fire-point/types';
import { detectLanguage } from '../detect-language';

function extractDelta(interim: string, final: string): string {
  const interimLower = interim.toLowerCase().trim();
  const finalLower = final.toLowerCase().trim();

  if (finalLower.startsWith(interimLower)) {
    return finalLower.slice(interimLower.length).trim();
  }

  // Handle case where interim is a prefix with minor ASR differences
  const interimWords = interimLower.split(/\s+/);
  const finalWords = finalLower.split(/\s+/);

  let matchedUpTo = 0;
  for (let i = 0; i < interimWords.length && i < finalWords.length; i++) {
    if (interimWords[i] === finalWords[i]) {
      matchedUpTo = i + 1;
    } else {
      // Check if it's a partial word match (ASR artefact)
      if (finalWords[i].startsWith(interimWords[i]) && i === interimWords.length - 1) {
        matchedUpTo = i; // Don't count the partial word as matched
      }
      break;
    }
  }

  return finalWords.slice(matchedUpTo).join(' ');
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"…\-()]/g, ' ')  // keep apostrophes — they're part of contractions, not punctuation
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// Richness levels in order — used for threshold comparison
const RICHNESS_ORDER: ContextRichnessLevel[] = ['none', 'low', 'medium', 'high'];

function richnessAtOrAbove(level: ContextRichnessLevel, threshold: ContextRichnessLevel): boolean {
  return RICHNESS_ORDER.indexOf(level) >= RICHNESS_ORDER.indexOf(threshold);
}

export interface TokenDeltaHeuristicOptions {
  // Richness level at which a SAME verdict gets demoted to DIFFERENT.
  // 'none'   = never demote (always prefer speed)
  // 'low'    = demote on any richness signal
  // 'medium' = demote on medium or high (conservative)
  // 'high'   = only demote on high richness (default)
  // undefined = no demotion (richness is informational only)
  richnessThreshold?: ContextRichnessLevel;
}

export class TokenDeltaHeuristicStrategy implements StabilityStrategy {
  name = 'token-delta-heuristic';
  private richnessThreshold?: ContextRichnessLevel;

  constructor(options?: TokenDeltaHeuristicOptions) {
    this.richnessThreshold = options?.richnessThreshold;
  }

  async init(): Promise<void> {
    // No initialization needed
  }

  private isPartialWordCompletion(interim: string, final: string): boolean {
    const interimTrimmed = interim.toLowerCase().trim();
    const finalTrimmed = final.toLowerCase().trim();

    const interimWords = interimTrimmed.split(/\s+/);
    const finalWords = finalTrimmed.split(/\s+/);

    if (interimWords.length === 0 || finalWords.length === 0) return false;

    // Check if the last word in interim is a prefix of a word in final
    const lastInterimWord = interimWords[interimWords.length - 1];
    const precedingInterimWords = interimWords.slice(0, -1);

    // All preceding words must match
    for (let i = 0; i < precedingInterimWords.length; i++) {
      if (i >= finalWords.length || precedingInterimWords[i] !== finalWords[i]) {
        return false;
      }
    }

    // The last interim word must be a prefix of the corresponding final word
    const correspondingIdx = precedingInterimWords.length;
    if (correspondingIdx >= finalWords.length) return false;

    const correspondingFinalWord = finalWords[correspondingIdx];
    if (!correspondingFinalWord.startsWith(lastInterimWord)) return false;
    if (correspondingFinalWord === lastInterimWord) return false; // Exact match, not partial

    // Any remaining final words after the completed word must be fillers or closing words
    const lang = detectLanguage(final);
    const fillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
    const closers = CLOSING_WORDS[lang] ?? CLOSING_WORDS['en'];
    const remainingWords = finalWords.slice(correspondingIdx + 1);

    return remainingWords.every((w) => {
      const cleaned = w.replace(/[.,!?;:'"…\-()]/g, '');
      return cleaned.length === 0 || fillers.has(cleaned) || closers.has(cleaned);
    });
  }

  async compare(
    interim: string,
    final: string,
    context?: ConversationContext,
  ): Promise<StabilityResult> {
    const result = await this.compareInner(interim, final, context);

    // Attach context richness to SAME verdicts
    if (result.verdict === 'SAME') {
      const delta = extractDelta(interim, final);
      const lang = detectLanguage(final);
      result.contextRichness = this.analyseContextRichness(delta, lang);

      // Demote SAME → DIFFERENT if richness meets/exceeds threshold
      if (
        this.richnessThreshold
        && result.contextRichness.level !== 'none'
        && richnessAtOrAbove(result.contextRichness.level, this.richnessThreshold)
      ) {
        return {
          ...result,
          verdict: 'DIFFERENT',
          details: {
            ...result.details as Record<string, unknown>,
            originalVerdict: 'SAME',
            demotedBy: 'context-richness',
            richnessLevel: result.contextRichness.level,
            richnessThreshold: this.richnessThreshold,
          },
        };
      }
    }

    return result;
  }

  private async compareInner(
    interim: string,
    final: string,
    context?: ConversationContext,
  ): Promise<StabilityResult> {
    const start = performance.now();
    const lang = detectLanguage(final);

    const delta = extractDelta(interim, final);

    // If no delta (identical or just whitespace), it's the same
    if (!delta || delta.trim().length === 0) {
      return {
        verdict: 'SAME',
        confidence: 1.0,
        latencyMs: performance.now() - start,
        details: { delta: '', reason: 'no-delta' },
      };
    }

    // Check for partial-word completion (ASR artefact)
    if (this.isPartialWordCompletion(interim, final)) {
      return {
        verdict: 'SAME',
        confidence: 0.9,
        latencyMs: performance.now() - start,
        details: { delta, reason: 'partial-word-completion' },
      };
    }

    // Check for reversal phrases first (highest priority — always DIFFERENT)
    const finalLower = final.toLowerCase();
    const reversals = REVERSAL_PHRASES[lang] ?? REVERSAL_PHRASES['en'];
    for (const phrase of reversals) {
      if (finalLower.includes(phrase)) {
        return {
          verdict: 'DIFFERENT',
          confidence: 0.95,
          latencyMs: performance.now() - start,
          details: { delta, reason: 'reversal-phrase', matchedPhrase: phrase },
        };
      }
    }

    const deltaTokens = tokenize(delta);

    if (deltaTokens.length === 0) {
      return {
        verdict: 'SAME',
        confidence: 1.0,
        latencyMs: performance.now() - start,
        details: { delta, reason: 'punctuation-only' },
      };
    }

    // Check if delta is only closing/farewell words + fillers
    // "Thank" → "Thank you. Goodbye." — delta "you goodbye" is filler + closing
    const fillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
    const closers = CLOSING_WORDS[lang] ?? CLOSING_WORDS['en'];
    const nonClosingTokens = deltaTokens.filter((t) =>
      !fillers.has(t) && !closers.has(t),
    );
    if (nonClosingTokens.length === 0) {
      return {
        verdict: 'SAME',
        confidence: 0.85,
        latencyMs: performance.now() - start,
        details: { delta, reason: 'closing-farewell-only', deltaTokens },
      };
    }

    // Check if delta contains a closing phrase ("that works", "that is all I need")
    // These are multi-word idioms that function as acknowledgements.
    const deltaLower = delta.toLowerCase();
    const closingPhrases = CLOSING_PHRASES[lang] ?? CLOSING_PHRASES['en'];
    for (const phrase of closingPhrases) {
      if (deltaLower.includes(phrase)) {
        // Verify the rest of the delta (outside the phrase) is filler/closing
        const remaining = deltaLower.replace(phrase, '').trim();
        const remainingTokens = remaining
          ? tokenize(remaining).filter((t) => !fillers.has(t) && !closers.has(t))
          : [];
        if (remainingTokens.length === 0) {
          return {
            verdict: 'SAME',
            confidence: 0.85,
            latencyMs: performance.now() - start,
            details: { delta, reason: 'closing-phrase', matchedPhrase: phrase, deltaTokens },
          };
        }
      }
    }

    // Check if delta is a single category noun (implied clarifier)
    // "Italian" → "Italian food" — "food" was already implied
    const categoryNouns = CATEGORY_NOUNS[lang] ?? CATEGORY_NOUNS['en'];
    const nonFillerTokens = deltaTokens.filter((t) => !fillers.has(t) && !closers.has(t));
    if (
      nonFillerTokens.length >= 1
      && nonFillerTokens.every((t) => categoryNouns.has(t))
      && interim.trim().split(/\s+/).length >= 2
    ) {
      return {
        verdict: 'SAME',
        confidence: 0.85,
        latencyMs: performance.now() - start,
        details: { delta, reason: 'implied-category-noun', noun: nonFillerTokens[0], deltaTokens },
      };
    }

    // Check for negation markers in the delta
    const negations = NEGATION_MARKERS[lang] ?? NEGATION_MARKERS['en'];
    const negationTokens = deltaTokens.filter((t) => negations.has(t));

    if (negationTokens.length > 0) {
      if (negationTokens.length >= 2 || negationTokens.length >= deltaTokens.length / 2) {
        return {
          verdict: 'DIFFERENT',
          confidence: 0.9,
          latencyMs: performance.now() - start,
          details: { delta, reason: 'negation-dominant', deltaTokens, negationTokens },
        };
      }
    }

    // Check for addition markers (topic shift)
    const additions = ADDITION_MARKERS[lang] ?? ADDITION_MARKERS['en'];
    const hasAdditionMarker = deltaTokens.some((t) => additions.has(t));
    if (hasAdditionMarker && deltaTokens.length > 3) {
      return {
        verdict: 'DIFFERENT',
        confidence: 0.8,
        latencyMs: performance.now() - start,
        details: { delta, reason: 'addition-marker-with-content', deltaTokens },
      };
    }

    // === CONTEXT-AWARE CHECK ===
    // If we know what the assistant asked, we can be much smarter about
    // whether the delta changes the actionable meaning.
    const contextResult = this.checkWithContext(
      interim, final, delta, deltaTokens, lang, context, start,
    );
    if (contextResult) return contextResult;

    // === CONTEXT-FREE FALLBACK ===
    // fillers, closers already in scope from closing-words check above
    const contentTokens = deltaTokens.filter((t) => !fillers.has(t) && !closers.has(t));
    const fillerRatio = 1 - contentTokens.length / deltaTokens.length;

    if (contentTokens.length === 0) {
      return {
        verdict: 'SAME',
        confidence: 0.85 + fillerRatio * 0.1,
        latencyMs: performance.now() - start,
        details: { delta, reason: 'all-fillers', deltaTokens, contentTokens },
      };
    }

    const contentRatio = contentTokens.length / deltaTokens.length;
    const confidence = 0.5 + contentRatio * 0.4;

    return {
      verdict: 'DIFFERENT',
      confidence,
      latencyMs: performance.now() - start,
      details: {
        delta,
        reason: 'content-tokens-detected',
        deltaTokens,
        contentTokens,
        fillerRatio,
        contentRatio,
      },
    };
  }

  // Context-aware stability check.
  // Uses the assistant's last turn to determine what kind of answer was expected,
  // then checks whether the delta changes the actionable response.
  //
  // Returns a StabilityResult if context gives a clear answer, or null to
  // fall through to the context-free check.
  private checkWithContext(
    interim: string,
    _final: string,
    delta: string,
    deltaTokens: string[],
    lang: string,
    context: ConversationContext | undefined,
    startTime: number,
  ): StabilityResult | null {
    if (!context || context.turns.length === 0) return null;

    // Find the last assistant turn
    const lastAssistantTurn = [...context.turns]
      .reverse()
      .find((t) => t.role === 'assistant');
    if (!lastAssistantTurn) return null;

    const turnType = classifyAssistantTurn(lastAssistantTurn.content);
    if (turnType === 'unknown') return null;

    // Check if the interim already contains the core answer
    const interimLower = interim.toLowerCase().trim();
    const interimAnswersYesNo = this.containsYesNo(interimLower, lang);

    // Qualification markers in the delta — "but", "however", "only if", "except"
    const qualificationMarkers = lang === 'de'
      ? /\b(aber|jedoch|nur|außer|wenn|erst|allerdings|trotzdem)\b/i
      : /\b(but|however|only|except|unless|instead|rather|although|though)\b/i;
    const deltaHasQualification = qualificationMarkers.test(delta);

    switch (turnType) {
      case 'yes-no-question':
      case 'confirmation': {
        // If interim already has a yes/no answer, the delta is elaboration
        // UNLESS it contains a qualification ("but only on weekdays"),
        // a topic shift ("and also can you..."), or a new request.
        if (interimAnswersYesNo) {
          if (deltaHasQualification) {
            return {
              verdict: 'DIFFERENT',
              confidence: 0.85,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: yes-no answered but delta qualifies',
                turnType,
                qualification: true,
              },
            };
          }

          // Check if delta introduces a new request (topic shift without "but")
          // But NOT if the delta also contains negation — "das brauche ich nicht"
          // means "I don't need that" (reinforcement), not a new request.
          const negationInDelta = lang === 'de'
            ? /\b(nicht|kein|keine|keinen|nie)\b/i
            : /\b(not|n't|don't|doesn't|can't|won't|never|no)\b/i;
          const newRequestPattern = lang === 'de'
            ? /\b(können|könnten|brauche|möchte|ich will|bitte auch|muss|hilfe)\b/i
            : /\b(can you|could you|I need|I want|I'd like|please also|help me|I have to|I must)\b/i;
          if (newRequestPattern.test(delta) && !negationInDelta.test(delta)) {
            return {
              verdict: 'DIFFERENT',
              confidence: 0.85,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: yes-no answered but delta has new request',
                turnType,
              },
            };
          }

          // If the interim is a short answer (1-2 words like "Yes", "No thanks"),
          // the delta is almost always elaboration — trust the context verdict.
          // For longer interims (3+ words like "Yes please book the"), the user
          // may be mid-sentence and the delta completes critical content — verify
          // the delta is filler-only before returning SAME.
          const interimWords = interim.trim().split(/\s+/);
          if (interimWords.length <= 2) {
            return {
              verdict: 'SAME',
              confidence: 0.9,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: short yes-no answer, delta is elaboration',
                turnType,
              },
            };
          }
          const fillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
          const negMarkers = NEGATION_MARKERS[lang] ?? NEGATION_MARKERS['en'];
          const deltaContentTokens = deltaTokens.filter((t) =>
            !fillers.has(t) && !negMarkers.has(t),
          );
          if (deltaContentTokens.length === 0) {
            return {
              verdict: 'SAME',
              confidence: 0.9,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: yes-no answered, delta is filler-only elaboration',
                turnType,
              },
            };
          }
          // Delta has content tokens after a long interim — fall through
        }
        break;
      }

      case 'action-complete':
      case 'information': {
        // After info/action-complete, user typically acknowledges.
        // If interim is an ack, delta is elaboration UNLESS it's a new request.
        if (interimAnswersYesNo || this.isAcknowledgement(interimLower, lang)) {
          if (deltaHasQualification) {
            return {
              verdict: 'DIFFERENT',
              confidence: 0.8,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: ack after info but delta qualifies',
                turnType,
              },
            };
          }

          // Check if delta introduces a new request (topic shift)
          // But NOT if the delta also contains negation (reinforcement, not new request)
          const infoNegationInDelta = lang === 'de'
            ? /\b(nicht|kein|keine|keinen|nie)\b/i
            : /\b(not|n't|don't|doesn't|can't|won't|never|no)\b/i;
          const infoNewRequestPattern = lang === 'de'
            ? /\b(können|könnten|brauche|möchte|ich will|bitte auch)\b/i
            : /\b(can you|could you|I need|I want|I'd like|please also|book me|help me)\b/i;
          if (infoNewRequestPattern.test(delta) && !infoNegationInDelta.test(delta)) {
            return {
              verdict: 'DIFFERENT',
              confidence: 0.85,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: ack after info but delta has new request',
                turnType,
              },
            };
          }

          // If the interim is a short ack (1-2 words like "OK", "Thanks"),
          // the delta is almost always elaboration — trust the context verdict.
          // For longer interims, verify delta is filler-only before returning SAME.
          const infoInterimWords = interim.trim().split(/\s+/);
          if (infoInterimWords.length <= 2) {
            return {
              verdict: 'SAME',
              confidence: 0.85,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: short ack after info/action, delta is elaboration',
                turnType,
              },
            };
          }
          const infoFillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
          const infoNegMarkers = NEGATION_MARKERS[lang] ?? NEGATION_MARKERS['en'];
          const infoContentTokens = deltaTokens.filter((t) =>
            !infoFillers.has(t) && !infoNegMarkers.has(t),
          );
          if (infoContentTokens.length === 0) {
            return {
              verdict: 'SAME',
              confidence: 0.85,
              latencyMs: performance.now() - startTime,
              details: {
                delta,
                reason: 'context: ack after info/action, delta is filler-only elaboration',
                turnType,
              },
            };
          }
          // Delta has content tokens — fall through to context-free check
        }
        break;
      }

      case 'wh-question':
      case 'open-ended':
      case 'choice-question': {
        // For these, the delta likely contains critical content.
        // Don't override the context-free check — let it fall through.
        return null;
      }
    }

    return null;
  }

  private containsYesNo(text: string, lang: string): boolean {
    const yesNoPatterns = lang === 'de'
      ? /^(ja|nein|genau|richtig|klar|natürlich|stimmt|ok|okay|nö|ne)\b/i
      : /^(yes|yeah|yep|yup|no|nope|nah|sure|ok|okay|right|correct|absolutely|definitely)\b/i;
    return yesNoPatterns.test(text);
  }

  private isAcknowledgement(text: string, lang: string): boolean {
    const ackPatterns = lang === 'de'
      ? /^(danke|super|prima|toll|wunderbar|perfekt|gut|schön|alles klar)\b/i
      : /^(thanks?|thank you|great|perfect|wonderful|lovely|brilliant|excellent|fantastic|nice|good|fine|cool)\b/i;
    return ackPatterns.test(text);
  }

  // Analyse context richness of the delta — how much useful context exists
  // in the words beyond the core actionable answer.
  // Only meaningful for SAME verdicts (the action doesn't change, but the
  // full utterance may carry context that improves response quality).
  private analyseContextRichness(delta: string, lang: string): ContextRichness {
    if (!delta || delta.trim().length === 0) {
      return { level: 'none', signals: [] };
    }

    const signals: string[] = [];
    const deltaLower = delta.toLowerCase();

    // Causal explanations — "because", "since", "after I..."
    const causalPattern = lang === 'de'
      ? /\b(weil|da|nachdem|seit|seitdem|deswegen|deshalb|darum|denn)\b/i
      : /\b(because|since|after|due to|as a result|that's why|so that|caused by)\b/i;
    if (causalPattern.test(deltaLower)) {
      signals.push('causal-explanation');
    }

    // Resolution/method — how something was done
    const resolutionPattern = lang === 'de'
      ? /\b(neugestartet|aktualisiert|installiert|gelöscht|geändert|repariert|behoben|versucht|gemacht)\b/i
      : /\b(restart|reboot|reset|update|install|delete|remov|chang|fix|repair|replac|clear|refresh|reinstall|unplug|replug|tried|attempt|switch|turn|unplugg|plugg)\w*\b/i;
    if (resolutionPattern.test(deltaLower)) {
      signals.push('resolution-method');
    }

    // Temporal context — when something happened
    const temporalPattern = lang === 'de'
      ? /\b(gestern|vorgestern|letzte woche|heute morgen|vor \w+ (tagen|stunden|minuten)|seitdem|neulich)\b/i
      : /\b(yesterday|last (week|night|time|month)|this morning|earlier|ago|recently|for the (last|past)|since (then|yesterday|last))\b/i;
    if (temporalPattern.test(deltaLower)) {
      signals.push('temporal-context');
    }

    // Frequency/pattern — recurring issue
    const frequencyPattern = lang === 'de'
      ? /\b(immer wieder|manchmal|oft|ständig|jedes mal|regelmäßig|ab und zu)\b/i
      : /\b(always|sometimes|often|constantly|every time|keeps? (happening|doing|going)|intermittent|on and off|recurring|repeatedly|again and again)\b/i;
    if (frequencyPattern.test(deltaLower)) {
      signals.push('frequency-pattern');
    }

    // Emotional/sentiment context
    const emotionalPattern = lang === 'de'
      ? /\b(frustriert|verärgert|enttäuscht|besorgt|genervt|wütend|zufrieden|froh|erleichtert|dringend)\b/i
      : /\b(frustrat|annoy|disappoint|worried|concern|upset|angry|furious|happy|glad|relieved|urgent|desperate|fed up)\b/i;
    if (emotionalPattern.test(deltaLower)) {
      signals.push('emotional-context');
    }

    // Specific details — names, numbers, identifiers
    const detailPattern = /\b(\d{2,}|[A-Z]{2,}\d+|version|model|order|account|ticket|reference|serial|number)\b/i;
    if (detailPattern.test(delta)) {
      signals.push('specific-details');
    }

    // Scope/impact — how many things affected, how severe
    const scopePattern = lang === 'de'
      ? /\b(alle|komplett|gar nicht|überhaupt nicht|nur|teilweise|mehrere|verschiedene)\b/i
      : /\b(all|every|complete|entire|nothing|none|only|partial|multiple|several|different|various|both|whole)\b/i;
    if (scopePattern.test(deltaLower)) {
      signals.push('scope-impact');
    }

    // Determine level from signal count
    let level: ContextRichnessLevel;
    if (signals.length === 0) level = 'none';
    else if (signals.length === 1) level = 'low';
    else if (signals.length <= 3) level = 'medium';
    else level = 'high';

    // Build summary
    let summary: string | undefined;
    if (signals.length > 0) {
      const descriptions: Record<string, string> = {
        'causal-explanation': 'explains why/how',
        'resolution-method': 'describes resolution method',
        'temporal-context': 'includes timing information',
        'frequency-pattern': 'describes recurrence pattern',
        'emotional-context': 'carries emotional/sentiment context',
        'specific-details': 'contains specific identifiers/numbers',
        'scope-impact': 'describes scope or impact',
      };
      summary = signals.map((s) => descriptions[s] ?? s).join('; ');
    }

    return { level, signals, summary };
  }
}
