// Strategy 4: Entity Diff
// Extracts named entities and key noun phrases from both utterances.
// Any new entities in the final that aren't in the interim → DIFFERENT.
// Uses a lightweight NER model via transformers.js.

import type { StabilityStrategy, StabilityResult, ConversationContext } from '../types';

let nerPipeline: any;

async function loadNerPipeline() {
  if (!nerPipeline) {
    const { pipeline } = await import('@huggingface/transformers');
    nerPipeline = await pipeline(
      'token-classification',
      'Xenova/bert-base-NER',
      { aggregation_strategy: 'simple' },
    );
  }
  return nerPipeline;
}

interface NerEntity {
  entity_group: string;
  word: string;
  score: number;
  start: number;
  end: number;
}

function normalizeEntity(entity: string): string {
  return entity.toLowerCase().replace(/[^a-z0-9äöüß\s]/gi, '').trim();
}

function extractNumberWords(text: string): string[] {
  // Match spoken numbers and digit strings
  const numberPattern = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwanzig|dreißig|vierzig|fünfzig|hundert|tausend|\d+)\b/gi;
  const matches = text.match(numberPattern);
  return matches ? matches.map((m) => m.toLowerCase()) : [];
}

function extractTimeExpressions(text: string): string[] {
  const patterns = [
    /\b\d{1,2}:\d{2}\b/g,
    /\b\d{1,2}\s*(?:o'clock|uhr)\b/gi,
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/gi,
    /\b(?:morning|afternoon|evening|night|noon|midnight)\b/gi,
    /\b(?:morgen|nachmittag|abend|nacht|mittag)\b/gi,
    /\b(?:tomorrow|yesterday|today|next\s+\w+|last\s+\w+)\b/gi,
    /\b(?:morgen|gestern|heute|nächste[rns]?\s+\w+|letzte[rns]?\s+\w+)\b/gi,
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
    /\b(?:januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/gi,
    /\b(?:in\s+(?:an?\s+)?(?:hour|minute|week|month)s?)\b/gi,
    /\b(?:in\s+(?:einer?\s+)?(?:stunde|minute|woche|monat)(?:n|en)?)\b/gi,
    /\b(?:before|after|until|by)\s+(?:noon|midnight|\d{1,2})\b/gi,
    /\b(?:vor|nach|bis)\s+(?:mittag|mitternacht|\d{1,2})\b/gi,
  ];

  const results: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      results.push(...matches.map((m) => m.toLowerCase()));
    }
  }
  return results;
}

export class EntityDiffStrategy implements StabilityStrategy {
  name = 'entity-diff';
  private ner: any;

  async init(): Promise<void> {
    this.ner = await loadNerPipeline();
  }

  async compare(
    interim: string,
    final: string,
    _context?: ConversationContext,
  ): Promise<StabilityResult> {
    const start = performance.now();

    // Run NER on both utterances
    const [interimEntities, finalEntities] = await Promise.all([
      this.ner(interim) as Promise<NerEntity[]>,
      this.ner(final) as Promise<NerEntity[]>,
    ]);

    const interimNames = new Set(interimEntities.map((e: NerEntity) => normalizeEntity(e.word)));
    const finalNames = new Set(finalEntities.map((e: NerEntity) => normalizeEntity(e.word)));

    // Find new entities in final that aren't in interim
    const newEntities = [...finalNames].filter((e) => !interimNames.has(e) && e.length > 1);

    // Also check for new numbers and time expressions (NER often misses these)
    const interimNumbers = new Set(extractNumberWords(interim));
    const finalNumbers = new Set(extractNumberWords(final));
    const newNumbers = [...finalNumbers].filter((n) => !interimNumbers.has(n));

    const interimTimes = new Set(extractTimeExpressions(interim));
    const finalTimes = new Set(extractTimeExpressions(final));
    const newTimes = [...finalTimes].filter((t) => !interimTimes.has(t));

    const totalNewItems = newEntities.length + newNumbers.length + newTimes.length;
    const latencyMs = performance.now() - start;

    if (totalNewItems > 0) {
      return {
        verdict: 'DIFFERENT',
        confidence: Math.min(0.6 + totalNewItems * 0.15, 0.98),
        latencyMs,
        details: {
          interimEntities: [...interimNames],
          finalEntities: [...finalNames],
          newEntities,
          newNumbers,
          newTimes,
        },
      };
    }

    return {
      verdict: 'SAME',
      confidence: 0.7,
      latencyMs,
      details: {
        interimEntities: [...interimNames],
        finalEntities: [...finalNames],
        newEntities: [],
        newNumbers: [],
        newTimes: [],
      },
    };
  }

  async dispose(): Promise<void> {
    this.ner = null;
  }
}
