#!/usr/bin/env bun
// Corpus Builder — generates utterance pairs from public conversational corpora
//
// Sources:
//   1. MultiWOZ 2.2 — task-oriented dialogues with slot annotations
//      (hotel, restaurant, train, taxi, attraction bookings)
//
//   2. DailyDialog — casual conversation with dialog act labels
//      Useful for filler/elaboration patterns.
//
//   3. Schema-Guided Dialogue (SGD) — 20+ domains with slot annotations
//      (banking, flights, events, ridesharing, weather, calendar, services, etc.)
//      Adds domain diversity beyond MultiWOZ's restaurant/hotel focus.
//
// Approach:
//   For each user utterance, create interim/final pairs by truncating
//   at different word boundaries. Use the corpus annotations to determine
//   the expected verdict:
//     - If truncation removes a slot value → DIFFERENT
//     - If truncation only removes filler/discourse → SAME
//     - Edge cases get labelled by heuristic rules

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { UtterancePair, SemanticChangeCategory, ConversationContext } from './types';

const CORPUS_DIR = join(import.meta.dir, '..', 'corpus');

// === Shared Types ===

interface SlotSpan {
  slot: string;
  value: string;
  startWord: number;
  endWord: number;
  category: SemanticChangeCategory;
}

// === MultiWOZ Processing ===

interface MultiWozTurn {
  speaker: string;
  utterance: string;
  frames: Array<{
    service: string;
    state?: {
      slot_values: Record<string, string[]>;
    };
    slots?: Array<{
      slot: string;
      value: string;
      start: number;
      exclusive_end: number;
    }>;
  }>;
}

interface MultiWozDialogue {
  dialogue_id: string;
  services: string[];
  turns: MultiWozTurn[];
}

// Slot types that represent critical information (truncation = DIFFERENT)
const CRITICAL_SLOT_TYPES = new Set([
  'destination', 'departure', 'name', 'food', 'area', 'price',
  'pricerange', 'type', 'day', 'time', 'people', 'stay',
  'arrive', 'arriveby', 'leave', 'leaveat', 'book_time',
  'book_day', 'book_people', 'book_stay', 'stars',
  'internet', 'parking', 'department', 'phone',
  // Compound slot names across services
  'restaurant-name', 'hotel-name', 'attraction-name',
  'train-destination', 'train-departure', 'taxi-destination',
]);

function categoriseSlotType(slotName: string): SemanticChangeCategory {
  const lower = slotName.toLowerCase();
  if (lower.includes('time') || lower.includes('day') || lower.includes('arrive') || lower.includes('leave') || lower.includes('date')) {
    return 'time-addition';
  }
  if (lower.includes('people') || lower.includes('stay') || lower.includes('stars') || lower.includes('number') || lower.includes('count') || lower.includes('passengers')) {
    return 'number-addition';
  }
  if (lower.includes('price') || lower.includes('budget')) {
    return 'qualification';
  }
  return 'entity-addition';
}

// === SGD Processing ===
// Schema-Guided Dialogue has the same structure as MultiWOZ

interface SgdTurn {
  speaker: string;
  utterance: string;
  frames: Array<{
    service: string;
    slots?: Array<{
      slot: string;
      start: number;
      exclusive_end: number;
    }>;
    state?: {
      active_intent: string;
      requested_slots: string[];
      slot_values: Record<string, string[]>;
    };
    actions?: Array<{
      act: string;
      slot: string;
      values: string[];
    }>;
  }>;
}

interface SgdDialogue {
  dialogue_id: string;
  services: string[];
  turns: SgdTurn[];
}

// SGD shards selected for domain diversity
const SGD_SHARDS = [
  '030', // Homes, Services (appointments, home search)
  '040', // Banks, Hotels (account queries, transfers)
  '060', // Events, Flights, RentalCars (travel)
  '080', // Buses, Media, RideSharing (transport, entertainment)
  '090', // Buses, RideSharing, Travel, Weather
  '100', // Calendar, Events, Movies
  '110', // Calendar, Events, Services
];

const SGD_BASE_URL = 'https://raw.githubusercontent.com/google-research-datasets/dstc8-schema-guided-dialogue/master/train';

// === Shared Pair Creation ===

function findSlotSpans(utterance: string, words: string[], frameSlots: Array<{ slot: string; start: number; exclusive_end: number }>): SlotSpan[] {
  const spans: SlotSpan[] = [];

  for (const slot of frameSlots) {
    if (slot.start === undefined || slot.exclusive_end === undefined) continue;

    const valueText = utterance.substring(slot.start, slot.exclusive_end);
    let charPos = 0;
    let startWord = -1;
    let endWord = -1;

    for (let w = 0; w < words.length; w++) {
      const wordStart = utterance.indexOf(words[w], charPos);
      const wordEnd = wordStart + words[w].length;

      if (startWord === -1 && wordEnd > slot.start) {
        startWord = w;
      }
      if (wordEnd >= slot.exclusive_end) {
        endWord = w;
        break;
      }
      charPos = wordEnd;
    }

    if (startWord >= 0 && endWord >= 0) {
      spans.push({
        slot: slot.slot,
        value: valueText,
        startWord,
        endWord,
        category: categoriseSlotType(slot.slot),
      });
    }
  }

  return spans;
}

// Filler words for tail validation
const TAIL_FILLER_WORDS = new Set([
  'please', 'thanks', 'thank', 'you', 'very', 'much',
  'that', 'the', 'a', 'an', 'is', 'are', 'was', 'it',
  'too', 'also', 'as', 'well', 'if', 'possible',
  'though', 'restaurant', 'food', 'hotel',
]);

// Content patterns that should NOT be in a "filler" tail
const TAIL_CONTENT_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tonight|tomorrow|today|\d+|people|person|persons|street|road|avenue|north|south|east|west|at|on|for|by|before|after|arrive|arriving|depart|departing|cheap|expensive|moderate|free|parking|wifi|internet|stars?|dollars?|pounds?|percent|account|transfer|balance|flight|bus|train|ticket|reservation)\b/i;

// Ack starters for filler-only detection
const ACK_STARTERS = new Set([
  'yes', 'yeah', 'ok', 'okay', 'sure', 'right', 'thanks', 'thank',
  'great', 'perfect', 'no', 'good', 'fine', 'nice', 'cool',
  'awesome', 'wonderful', 'excellent', 'sounds', 'alright',
]);

// Filler words for ack-based SAME pairs
const ACK_FILLER_WORDS = new Set([
  'yes', 'yeah', 'yep', 'no', 'nope', 'ok', 'okay', 'sure', 'right',
  'thank', 'thanks', 'you', 'very', 'much', 'great', 'perfect', 'good',
  'that', 'is', 'was', 'sounds', 'fine', 'all', 'i', 'need', 'today',
  'have', 'a', 'nice', 'day', 'wonderful', 'will', 'do', 'bye',
  'goodbye', 'cheerio', 'cheers', 'helpful', 'been', "that's",
  'it', 'the', 'so', 'for', 'really', 'appreciate', 'just', 'well',
  'exactly', 'absolutely', 'certainly', 'definitely', 'indeed',
  'me', 'we', 'my', 'your', 'please', 'awesome', 'cool', 'excellent',
  'brilliant', 'fantastic', 'lovely', 'alright', 'works', 'done',
]);

function createPairsFromSlottedTurn(
  idPrefix: string,
  turnIdx: number,
  utterance: string,
  frameSlots: Array<{ slot: string; start: number; exclusive_end: number }>[],
  context: ConversationContext | undefined,
): UtterancePair[] {
  const pairs: UtterancePair[] = [];
  utterance = utterance.trim();
  const words = utterance.split(/\s+/);

  if (words.length < 3) return pairs;

  // Collect slot spans from all frames
  const slotSpans: SlotSpan[] = [];
  for (const slots of frameSlots) {
    slotSpans.push(...findSlotSpans(utterance, words, slots));
  }

  // Strategy 1: Cut BEFORE a slot value → DIFFERENT (slot is lost)
  for (const span of slotSpans) {
    if (span.startWord < 2) continue;

    const cutPoint = span.startWord;
    const interim = words.slice(0, cutPoint).join(' ');

    if (interim.split(/\s+/).length < 2) continue;

    pairs.push({
      id: `${idPrefix}-t${turnIdx}-slot-${span.slot}-${pairs.length}`,
      interim,
      final: utterance,
      expectedVerdict: 'DIFFERENT',
      category: span.category,
      language: 'en',
      description: `${idPrefix}: "${span.slot}" slot value "${span.value}" lost in truncation`,
      context,
    });
  }

  // Strategy 2: Cut AFTER all slot values → SAME if tail is pure filler
  if (slotSpans.length > 0) {
    const lastSlotEnd = Math.max(...slotSpans.map((s) => s.endWord));

    if (lastSlotEnd < words.length - 1) {
      const interim = words.slice(0, lastSlotEnd + 1).join(' ');
      const remainingWords = words.slice(lastSlotEnd + 1);
      const tailText = remainingWords.join(' ');
      const tailHasContent = TAIL_CONTENT_PATTERN.test(tailText);
      const tailAllFiller = remainingWords.every((w) => {
        const cleaned = w.toLowerCase().replace(/[.,!?;:'"…\-()]/g, '');
        return cleaned.length === 0 || TAIL_FILLER_WORDS.has(cleaned);
      });

      if (tailAllFiller && !tailHasContent && remainingWords.length >= 1 && remainingWords.length <= 4) {
        pairs.push({
          id: `${idPrefix}-t${turnIdx}-tail-${pairs.length}`,
          interim,
          final: utterance,
          expectedVerdict: 'SAME',
          category: 'elaboration',
          language: 'en',
          description: `${idPrefix}: remaining "${tailText}" after all slots`,
          context,
        });
      }
    }
  }

  // Strategy 3: No-slot utterances — check for pure ack/gratitude
  if (slotSpans.length === 0 && words.length >= 3 && words.length <= 10) {
    const firstWord = words[0].toLowerCase().replace(/[.,!?]/g, '');

    if (ACK_STARTERS.has(firstWord)) {
      const tail = words.slice(1);
      const tailAllFiller = tail.every((w) => {
        const cleaned = w.toLowerCase().replace(/[.,!?;:'"…\-()]/g, '');
        return cleaned.length === 0 || ACK_FILLER_WORDS.has(cleaned);
      });

      if (tailAllFiller) {
        pairs.push({
          id: `${idPrefix}-t${turnIdx}-ack-${pairs.length}`,
          interim: words[0],
          final: utterance,
          expectedVerdict: 'SAME',
          category: 'filler-only',
          language: 'en',
          description: `${idPrefix}: pure acknowledgement/gratitude turn`,
          context,
        });
      }
    }
  }

  return pairs;
}

function createPairsFromMultiWozTurn(
  dialogueId: string,
  turnIdx: number,
  turn: MultiWozTurn,
  prevTurn?: MultiWozTurn,
): UtterancePair[] {
  const context: ConversationContext | undefined = prevTurn
    ? { turns: [{ role: 'assistant', content: prevTurn.utterance.trim() }] }
    : undefined;

  const frameSlots = turn.frames
    .filter((f) => f.slots)
    .map((f) => f.slots!);

  return createPairsFromSlottedTurn(
    `mwoz-${dialogueId}`,
    turnIdx,
    turn.utterance,
    frameSlots,
    context,
  );
}

function createPairsFromSgdTurn(
  dialogueId: string,
  turnIdx: number,
  turn: SgdTurn,
  prevTurn?: SgdTurn,
): UtterancePair[] {
  const context: ConversationContext | undefined = prevTurn
    ? { turns: [{ role: 'assistant', content: prevTurn.utterance.trim() }] }
    : undefined;

  const frameSlots = turn.frames
    .filter((f) => f.slots && f.slots.length > 0)
    .map((f) => f.slots!);

  return createPairsFromSlottedTurn(
    `sgd-${dialogueId}`,
    turnIdx,
    turn.utterance,
    frameSlots,
    context,
  );
}

// === DailyDialog Processing ===

const DD_ACT_LABELS: Record<number, string> = {
  1: 'inform',
  2: 'question',
  3: 'directive',
  4: 'commissive',
};

interface DailyDialogEntry {
  dialog: string[];
  act: number[];
}

function createPairsFromDailyDialog(
  dialogIdx: number,
  dialog: string[],
  acts: number[],
): UtterancePair[] {
  const pairs: UtterancePair[] = [];

  for (let i = 0; i < dialog.length; i++) {
    const utterance = dialog[i].trim();
    const words = utterance.split(/\s+/);
    const act = acts[i];

    if (words.length < 4) continue;

    const ddContext: ConversationContext | undefined = i > 0
      ? { turns: [{ role: 'assistant', content: dialog[i - 1].trim() }] }
      : undefined;

    // For questions (act=2): cutting before the question object changes meaning
    if (act === 2 && words.length >= 5) {
      const qWordIdx = words.findIndex((w) =>
        /^(what|where|when|how|which|who|whose|why|can|could|would|do|does|is|are)$/i.test(w),
      );
      if (qWordIdx >= 0 && qWordIdx < words.length - 3) {
        const cutPoint = Math.min(qWordIdx + 2, words.length - 2);
        const interim = words.slice(0, cutPoint).join(' ');

        pairs.push({
          id: `dd-${dialogIdx}-t${i}-q-${pairs.length}`,
          interim,
          final: utterance,
          expectedVerdict: 'DIFFERENT',
          category: 'entity-addition',
          language: 'en',
          description: `DailyDialog: question object lost in truncation`,
          context: ddContext,
        });
      }
    }

    // For commissive/directive (acts 3,4): often "I'll [verb] [object]"
    if ((act === 3 || act === 4) && words.length >= 5) {
      const midpoint = Math.ceil(words.length * 0.6);
      const interim = words.slice(0, midpoint).join(' ');

      const remaining = words.slice(midpoint).join(' ').toLowerCase();
      const hasContent = /\b(please|tomorrow|today|tonight|morning|evening|o'clock|\d+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(remaining);

      if (hasContent) {
        pairs.push({
          id: `dd-${dialogIdx}-t${i}-dir-${pairs.length}`,
          interim,
          final: utterance,
          expectedVerdict: 'DIFFERENT',
          category: 'time-addition',
          language: 'en',
          description: `DailyDialog: directive/commissive with time/detail lost`,
          context: ddContext,
        });
      }
    }

    // For inform (act=1) with short utterances: likely filler/elaboration
    if (act === 1 && words.length >= 3 && words.length <= 8) {
      const firstWord = words[0].toLowerCase().replace(/[.,!?]/g, '');

      if (ACK_STARTERS.has(firstWord) && words.length > 2) {
        pairs.push({
          id: `dd-${dialogIdx}-t${i}-ack-${pairs.length}`,
          interim: words[0],
          final: utterance,
          expectedVerdict: 'SAME',
          category: 'filler-only',
          language: 'en',
          description: `DailyDialog: acknowledgement "${firstWord}" + elaboration`,
          context: ddContext,
        });
      }
    }
  }

  return pairs;
}

// === Download and Parse ===

async function downloadMultiWoz(): Promise<MultiWozDialogue[]> {
  console.log('Downloading MultiWOZ 2.2 (train split, shard 1)...');

  const urls = [
    'https://raw.githubusercontent.com/budzianowski/multiwoz/master/data/MultiWOZ_2.2/train/dialogues_001.json',
    'https://huggingface.co/datasets/pfb30/multi_woz_v22/resolve/main/data/train/dialogues_001.json',
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) return response.json();
      console.log(`  ${url} failed (${response.status})`);
    } catch {
      console.log(`  ${url} timed out`);
    }
  }

  throw new Error('Failed to download MultiWOZ from all sources');
}

async function downloadSgdShards(): Promise<SgdDialogue[]> {
  console.log(`Downloading SGD (${SGD_SHARDS.length} shards for domain diversity)...`);

  const allDialogues: SgdDialogue[] = [];

  for (const shard of SGD_SHARDS) {
    const url = `${SGD_BASE_URL}/dialogues_${shard}.json`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`  SGD shard ${shard}: failed (${response.status}), skipping`);
        continue;
      }
      const dialogues: SgdDialogue[] = await response.json();
      const services = new Set<string>();
      for (const d of dialogues) d.services.forEach((s) => services.add(s));
      console.log(`  SGD shard ${shard}: ${dialogues.length} dialogues [${[...services].join(', ')}]`);
      allDialogues.push(...dialogues);
    } catch (error) {
      console.log(`  SGD shard ${shard}: error, skipping`);
    }
  }

  return allDialogues;
}

async function downloadDailyDialog(): Promise<DailyDialogEntry[]> {
  console.log('Downloading DailyDialog...');

  // DailyDialog moved to a script-based dataset on HuggingFace and can't be
  // directly downloaded as JSON. Skip if unavailable.
  const url = 'https://huggingface.co/datasets/li2017dailydialog/daily_dialog/resolve/main/data/train.json';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      console.log(`DailyDialog download failed (${response.status}), skipping (dataset requires HF auth)`);
      return [];
    }
    return response.json();
  } catch {
    console.log('DailyDialog not available, skipping');
    return [];
  }
}

// === Main ===

async function main(): Promise<void> {
  console.log('Corpus Builder — generating utterance pairs from public corpora\n');

  mkdirSync(CORPUS_DIR, { recursive: true });

  const allPairs: UtterancePair[] = [];
  let lastCount = 0;

  // Process MultiWOZ
  try {
    const dialogues = await downloadMultiWoz();
    console.log(`Downloaded ${dialogues.length} MultiWOZ dialogues`);

    for (const dialogue of dialogues) {
      for (let t = 0; t < dialogue.turns.length; t++) {
        const turn = dialogue.turns[t];
        if (turn.speaker !== 'USER') continue;

        const prevTurn = t > 0 ? dialogue.turns[t - 1] : undefined;
        const pairs = createPairsFromMultiWozTurn(
          dialogue.dialogue_id,
          t,
          turn,
          prevTurn,
        );
        allPairs.push(...pairs);
      }
    }

    console.log(`Generated ${allPairs.length} pairs from MultiWOZ`);
    lastCount = allPairs.length;
  } catch (error) {
    console.error(`MultiWOZ error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Process SGD
  try {
    const dialogues = await downloadSgdShards();
    console.log(`Downloaded ${dialogues.length} SGD dialogues total`);

    for (const dialogue of dialogues) {
      for (let t = 0; t < dialogue.turns.length; t++) {
        const turn = dialogue.turns[t];
        if (turn.speaker !== 'USER') continue;

        const prevTurn = t > 0 ? dialogue.turns[t - 1] : undefined;
        const pairs = createPairsFromSgdTurn(
          dialogue.dialogue_id,
          t,
          turn,
          prevTurn,
        );
        allPairs.push(...pairs);
      }
    }

    console.log(`Generated ${allPairs.length - lastCount} pairs from SGD`);
    lastCount = allPairs.length;
  } catch (error) {
    console.error(`SGD error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Process DailyDialog
  try {
    const dialogs = await downloadDailyDialog();
    if (dialogs.length > 0) {
      console.log(`Downloaded ${dialogs.length} DailyDialog entries`);

      // Only process first 2000 dialogues (enough for our purposes)
      const subset = dialogs.slice(0, 2000);
      for (let d = 0; d < subset.length; d++) {
        const entry = subset[d];
        const pairs = createPairsFromDailyDialog(d, entry.dialog, entry.act);
        allPairs.push(...pairs);
      }

      console.log(`Generated ${allPairs.length - lastCount} pairs from DailyDialog`);
    }
  } catch (error) {
    console.error(`DailyDialog error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Deduplicate and balance
  const uniquePairs = deduplicateAndBalance(allPairs);

  // Write output
  const outputPath = join(CORPUS_DIR, 'generated-en.json');
  writeFileSync(outputPath, JSON.stringify(uniquePairs, null, 2) + '\n');

  // Print stats
  const sameCount = uniquePairs.filter((p) => p.expectedVerdict === 'SAME').length;
  const diffCount = uniquePairs.filter((p) => p.expectedVerdict === 'DIFFERENT').length;
  const byCat: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const p of uniquePairs) {
    byCat[p.category] = (byCat[p.category] ?? 0) + 1;
    const source = p.description.startsWith('mwoz') ? 'MultiWOZ'
      : p.description.startsWith('sgd') ? 'SGD'
      : 'DailyDialog';
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  console.log(`\nFinal corpus: ${uniquePairs.length} pairs`);
  console.log(`  SAME: ${sameCount} | DIFFERENT: ${diffCount}`);
  console.log(`  By source:`);
  for (const [src, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src}: ${count}`);
  }
  console.log(`  By category:`);
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count}`);
  }
  console.log(`\nWritten to: ${outputPath}`);
}

function deduplicateAndBalance(pairs: UtterancePair[]): UtterancePair[] {
  // Deduplicate by interim+final
  const seen = new Set<string>();
  const unique: UtterancePair[] = [];

  for (const pair of pairs) {
    const key = `${pair.interim}|||${pair.final}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Skip pairs where interim is too short (< 2 chars) or final is too long (> 200 chars)
    if (pair.interim.length < 2 || pair.final.length > 200) continue;

    // Skip pairs where interim and final are too similar in length (< 20% difference)
    if (pair.final.length > 0 && pair.interim.length / pair.final.length > 0.9) continue;

    unique.push(pair);
  }

  // Cap at 800 pairs, balanced by category
  const byCategory: Record<string, UtterancePair[]> = {};
  for (const pair of unique) {
    const cat = pair.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(pair);
  }

  const maxPerCategory = Math.ceil(800 / Object.keys(byCategory).length);
  const balanced: UtterancePair[] = [];

  for (const [_cat, catPairs] of Object.entries(byCategory)) {
    // Shuffle deterministically, but prefer source diversity
    const shuffled = catPairs.sort((a, b) => {
      // Prefer SGD pairs first (they're the new diverse ones)
      const aIsSgd = a.id.startsWith('sgd') ? 0 : 1;
      const bIsSgd = b.id.startsWith('sgd') ? 0 : 1;
      if (aIsSgd !== bIsSgd) return aIsSgd - bIsSgd;
      return a.id.localeCompare(b.id);
    });
    balanced.push(...shuffled.slice(0, maxPerCategory));
  }

  // Re-index IDs
  return balanced.map((p, i) => ({
    ...p,
    id: `gen-${String(i).padStart(4, '0')}`,
  }));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
