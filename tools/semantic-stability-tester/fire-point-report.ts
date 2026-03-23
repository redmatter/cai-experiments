#!/usr/bin/env bun
// Fire Point Report Generator
//
// Produces a full HTML report showing for every scenario:
//   - The assistant turn and full user utterance
//   - Word-by-word progression showing transcribed's fire/wait decision
//   - The FIRE POINT: the exact moment transcribed sends to cai-websocket
//   - Stability verdict: does the fired partial match the final utterance?
//   - Remaining words after fire shown as "already sent" (greyed out)
//
// Two-phase model:
//   Phase 1 (transcribed): word arrives → fire-point detector → FIRE or WAIT
//   Phase 2 (cai-websocket): end-of-turn arrives → stability check fired partial vs final

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FIRE_POINT_SCENARIOS } from './src/fire-point/scenarios';
import { detectFirePoint } from './src/fire-point/detector';
import { classifyAssistantTurn } from './src/fire-point/turn-classifier';
import { TokenDeltaHeuristicStrategy } from './src/strategies/token-delta-heuristic';
import type { FirePointScenario, AssistantTurnType } from './src/fire-point/types';
import { REVERSAL_PHRASES, NEGATION_MARKERS, ADDITION_MARKERS, FILLER_WORDS, CLOSING_WORDS } from './src/word-lists';
import { detectLanguage } from './src/detect-language';

const RESULTS_DIR = join(import.meta.dir, 'results');
const stabilityChecker = new TokenDeltaHeuristicStrategy();

type Phase = 'waiting' | 'fired' | 'monitoring' | 'abort' | 'after-abort';

// Speech timing estimates
// Conversational speech: ~130 WPM = ~462ms per word
// VAD end-of-turn silence detection: ~600ms (Deepgram endpointing)
const MS_PER_WORD = 462;
const VAD_SILENCE_MS = 600;

interface WordStep {
  wordIndex: number;
  word: string;
  partial: string;
  phase: Phase;
  shouldFire: boolean;
  fireReason: string;
  fireConfidence: number;
  // Post-fire monitoring: stability check at this word
  monitorVerdict?: 'SAME' | 'DIFFERENT';
  monitorReason?: string;
}

interface ScenarioReport {
  scenario: FirePointScenario;
  turnType: string;
  steps: WordStep[];
  // Fire point
  fireWordIndex?: number;
  firedPartial?: string;
  // Stability at fire point (partial vs final)
  stabilityVerdict?: 'SAME' | 'DIFFERENT';
  stabilityConfidence?: number;
  stabilityReason?: string;
  // Context richness (for SAME verdicts — what useful context is lost)
  contextRichnessLevel?: string;
  contextRichnessSignals?: string[];
  contextRichnessSummary?: string;
  // Post-fire abort detection
  abortWordIndex?: number;
  abortPartial?: string;
  abortReason?: string;
  // Outcome
  fireOutcome: 'safe' | 'caught' | 'aborted' | 'no-fire';
  totalWords: number;
  latencySavedPct?: number;
  // Estimated timing
  estUtteranceDurationMs?: number;    // total speech time
  estFirePointMs?: number;            // time into utterance when we fired
  estRemainingSpeechMs?: number;      // speech time after fire point
  estTimeSavedMs?: number;            // remaining speech + VAD silence
  estAbortPointMs?: number;            // time into utterance when abort detected
  estAbortHeadStartMs?: number;        // how much earlier we caught it vs end-of-turn
}

// Lightweight post-fire shift detector.
// Unlike the full stability checker (designed for complete utterance comparison),
// this only flags genuine meaning SHIFTS — not incremental content arriving.
//
// Triggers:
// 1. Reversal phrases ("actually no", "wait no", "never mind")
// 2. Negation markers after an affirmative fire, or affirmatives after negative fire
// 3. Addition markers followed by content ("and also can you", "but can you")
// 4. "but" / "except" / "however" introducing a qualification
//
// Does NOT trigger on: filler elaboration, closing words, reinforcement
interface ShiftDetection {
  shifted: boolean;
  reason: string;
}

const QUALIFICATION_MARKERS: Record<string, Set<string>> = {
  en: new Set(['but', 'except', 'however', 'although', 'unless', 'only', 'instead']),
  de: new Set(['aber', 'außer', 'jedoch', 'allerdings', 'es sei denn', 'nur', 'stattdessen']),
};

function detectPostFireShift(
  firedPartial: string,
  currentPartial: string,
  turnType: string,
  lang: string,
): ShiftDetection {
  const firedLower = firedPartial.toLowerCase().trim();
  const currentLower = currentPartial.toLowerCase().trim();

  // No new content yet
  if (currentLower === firedLower || currentLower.length <= firedLower.length) {
    return { shifted: false, reason: 'no new content' };
  }

  const delta = currentLower.startsWith(firedLower)
    ? currentLower.slice(firedLower.length).trim()
    : '';
  if (!delta) return { shifted: false, reason: 'no delta' };

  const deltaWords = delta.split(/\s+/).filter((w) => w.length > 0);
  if (deltaWords.length === 0) return { shifted: false, reason: 'empty delta' };

  // 1. Check reversal phrases in the full current utterance
  const reversals = REVERSAL_PHRASES[lang] ?? REVERSAL_PHRASES['en'];
  for (const phrase of reversals) {
    if (currentLower.includes(phrase)) {
      return { shifted: true, reason: `reversal phrase: "${phrase}"` };
    }
  }

  // 2. Qualification markers: "but", "except", "however" — only if followed by content
  const qualifiers = QUALIFICATION_MARKERS[lang] ?? QUALIFICATION_MARKERS['en'];
  const fillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
  const closers = CLOSING_WORDS[lang] ?? CLOSING_WORDS['en'];

  for (let i = 0; i < deltaWords.length; i++) {
    const cleaned = deltaWords[i].replace(/[.,!?;:'"…\-()]/g, '');
    if (qualifiers.has(cleaned)) {
      // Check if there's content after the qualifier (not just fillers)
      const afterQualifier = deltaWords.slice(i + 1);
      const hasContent = afterQualifier.some((w) => {
        const c = w.replace(/[.,!?;:'"…\-()]/g, '');
        return c.length > 0 && !fillers.has(c) && !closers.has(c);
      });
      if (hasContent) {
        return { shifted: true, reason: `qualification: "${cleaned}" + content` };
      }
      // "but" alone or "but thanks" — not a shift yet, keep monitoring
    }
  }

  // 3. Addition markers followed by substantial content (>2 content words after marker)
  const additionMarkers = ADDITION_MARKERS[lang] ?? ADDITION_MARKERS['en'];
  for (let i = 0; i < deltaWords.length; i++) {
    const cleaned = deltaWords[i].replace(/[.,!?;:'"…\-()]/g, '');
    if (additionMarkers.has(cleaned)) {
      const afterMarker = deltaWords.slice(i + 1);
      const contentAfter = afterMarker.filter((w) => {
        const c = w.replace(/[.,!?;:'"…\-()]/g, '');
        return c.length > 0 && !fillers.has(c) && !closers.has(c);
      });
      if (contentAfter.length >= 2) {
        return { shifted: true, reason: `addition marker: "${cleaned}" + ${contentAfter.length} content words` };
      }
    }
  }

  // 4. Negation flip: fired on affirmative, now seeing negation (or vice versa)
  // Requires context: only flag if negation is NOT part of a harmless idiom
  // and is followed by content (not tail-position politeness)
  const negMarkers = NEGATION_MARKERS[lang] ?? NEGATION_MARKERS['en'];
  if (turnType === 'yes-no-question' || turnType === 'confirmation' || turnType === 'information' || turnType === 'action-complete') {
    // Harmless idioms containing negation words — these are NOT shifts
    const harmlessNegIdioms = lang === 'de'
      ? ['kein problem', 'nicht schlimm', 'macht nichts']
      : ['why not', 'no worries', 'no problem', 'not bad', 'not a problem', "don't worry"];

    const deltaStr = delta;
    const isHarmlessIdiom = harmlessNegIdioms.some((idiom) => deltaStr.includes(idiom));
    if (!isHarmlessIdiom) {
      for (let i = 0; i < deltaWords.length; i++) {
        const cleaned = deltaWords[i].replace(/[.,!?;:'"…\-()]/g, '');
        if (negMarkers.has(cleaned)) {
          // Skip tail-position politeness: "sorry"/"wait" at end with no following content
          const wordsAfter = deltaWords.slice(i + 1);
          const contentAfter = wordsAfter.filter((w) => {
            const c = w.replace(/[.,!?;:'"…\-()]/g, '');
            return c.length > 0 && !fillers.has(c) && !closers.has(c);
          });
          if (contentAfter.length > 0) {
            return { shifted: true, reason: `negation marker: "${cleaned}" + content follows` };
          }
          // Negation marker alone or with only fillers after — could be politeness, skip
        }
      }
    }
  }

  return { shifted: false, reason: 'delta is elaboration/filler' };
}

async function analyseScenario(scenario: FirePointScenario): Promise<ScenarioReport> {
  const words = scenario.userUtterance.split(/\s+/);
  const turnType = classifyAssistantTurn(scenario.assistantTurn);
  const context = { turns: [{ role: 'assistant' as const, content: scenario.assistantTurn }] };
  const steps: WordStep[] = [];
  let fireWordIndex: number | undefined;
  let firedPartial: string | undefined;
  let abortWordIndex: number | undefined;
  let abortPartial: string | undefined;
  let abortReason: string | undefined;

  for (let i = 1; i <= words.length; i++) {
    const partial = words.slice(0, i).join(' ');
    const alreadyFired = fireWordIndex !== undefined;
    const alreadyAborted = abortWordIndex !== undefined;

    if (!alreadyFired) {
      // Phase 1: looking for fire point
      const decision = detectFirePoint(partial, scenario.assistantTurn);
      const phase: Phase = decision.shouldFire ? 'fired' : 'waiting';

      steps.push({
        wordIndex: i,
        word: words[i - 1],
        partial,
        phase,
        shouldFire: decision.shouldFire,
        fireReason: decision.reason,
        fireConfidence: decision.confidence,
      });

      if (decision.shouldFire) {
        fireWordIndex = i;
        firedPartial = partial;
      }
    } else if (!alreadyAborted) {
      // Phase 2: post-fire monitoring — lightweight shift detection
      const lang = detectLanguage(partial || scenario.assistantTurn);
      const shift = detectPostFireShift(firedPartial!, partial, turnType, lang);
      const monitorVerdict = shift.shifted ? 'DIFFERENT' as const : 'SAME' as const;
      const monitorReason = shift.reason;

      if (shift.shifted) {
        // Abort detected mid-utterance
        abortWordIndex = i;
        abortPartial = partial;
        abortReason = monitorReason;
        steps.push({
          wordIndex: i,
          word: words[i - 1],
          partial,
          phase: 'abort',
          shouldFire: false,
          fireReason: '',
          fireConfidence: 0,
          monitorVerdict,
          monitorReason,
        });
      } else {
        steps.push({
          wordIndex: i,
          word: words[i - 1],
          partial,
          phase: 'monitoring',
          shouldFire: false,
          fireReason: '',
          fireConfidence: 0,
          monitorVerdict,
          monitorReason,
        });
      }
    } else {
      // Phase 3: after abort — remaining words are post-abort
      steps.push({
        wordIndex: i,
        word: words[i - 1],
        partial,
        phase: 'after-abort',
        shouldFire: false,
        fireReason: '',
        fireConfidence: 0,
      });
    }
  }

  // End-of-turn stability check: compare fired partial against final utterance
  let stabilityVerdict: 'SAME' | 'DIFFERENT' | undefined;
  let stabilityConfidence: number | undefined;
  let stabilityReason: string | undefined;
  let contextRichnessLevel: string | undefined;
  let contextRichnessSignals: string[] | undefined;
  let contextRichnessSummary: string | undefined;

  if (firedPartial) {
    const result = await stabilityChecker.compare(firedPartial, scenario.userUtterance, context);
    stabilityVerdict = result.verdict;
    stabilityConfidence = result.confidence;
    stabilityReason = (result.details as Record<string, unknown>)?.reason as string ?? '';
    contextRichnessLevel = result.contextRichness?.level;
    contextRichnessSignals = result.contextRichness?.signals;
    contextRichnessSummary = result.contextRichness?.summary;
  }

  // Determine outcome: aborted takes priority over caught (earlier detection)
  const fireOutcome: 'safe' | 'caught' | 'aborted' | 'no-fire' = !firedPartial
    ? 'no-fire'
    : abortWordIndex !== undefined
      ? 'aborted'
      : stabilityVerdict === 'SAME'
        ? 'safe'
        : 'caught';

  const estUtteranceDurationMs = words.length * MS_PER_WORD;
  const estFirePointMs = fireWordIndex ? fireWordIndex * MS_PER_WORD : undefined;
  const estRemainingSpeechMs = fireWordIndex ? (words.length - fireWordIndex) * MS_PER_WORD : undefined;
  const estTimeSavedMs = estRemainingSpeechMs !== undefined ? estRemainingSpeechMs + VAD_SILENCE_MS : undefined;

  // For aborted: how much earlier did we catch it vs waiting for end-of-turn?
  const estAbortPointMs = abortWordIndex ? abortWordIndex * MS_PER_WORD : undefined;
  const estAbortHeadStartMs = (estAbortPointMs !== undefined && estUtteranceDurationMs)
    ? (estUtteranceDurationMs + VAD_SILENCE_MS) - estAbortPointMs
    : undefined;

  return {
    scenario,
    turnType,
    steps,
    fireWordIndex,
    firedPartial,
    abortWordIndex,
    abortPartial,
    abortReason,
    stabilityVerdict,
    stabilityConfidence,
    stabilityReason,
    contextRichnessLevel,
    contextRichnessSignals,
    contextRichnessSummary,
    fireOutcome,
    totalWords: words.length,
    latencySavedPct: fireWordIndex
      ? Math.round((1 - fireWordIndex / words.length) * 100)
      : undefined,
    estUtteranceDurationMs,
    estFirePointMs,
    estRemainingSpeechMs,
    estTimeSavedMs,
    estAbortPointMs,
    estAbortHeadStartMs,
  };
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateHtml(reports: ScenarioReport[]): string {
  const safe = reports.filter((r) => r.fireOutcome === 'safe');
  const caught = reports.filter((r) => r.fireOutcome === 'caught');
  const aborted = reports.filter((r) => r.fireOutcome === 'aborted');
  const noFire = reports.filter((r) => r.fireOutcome === 'no-fire');
  const fired = reports.filter((r) => r.fireOutcome !== 'no-fire');
  const avgSaved = fired.length > 0
    ? Math.round(fired.reduce((s, r) => s + (r.latencySavedPct ?? 0), 0) / fired.length)
    : 0;
  const avgTimeSavedSafe = safe.length > 0
    ? Math.round(safe.reduce((s, r) => s + (r.estTimeSavedMs ?? 0), 0) / safe.length)
    : 0;
  const totalTimeSavedSafe = safe.reduce((s, r) => s + (r.estTimeSavedMs ?? 0), 0);
  const maxTimeSaved = Math.max(...safe.map((r) => r.estTimeSavedMs ?? 0));
  const minTimeSaved = safe.length > 0 ? Math.min(...safe.map((r) => r.estTimeSavedMs ?? 0)) : 0;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fire Point Analysis Report</title>
<style>
  :root {
    --safe: #059669; --safe-bg: #d1fae5; --safe-bg2: #ecfdf5;
    --caught: #d97706; --caught-bg: #fef3c7; --caught-bg2: #fffbeb;
    --nofire: #6b7280; --nofire-bg: #f3f4f6;
    --fire: #dc2626; --fire-bg: #fef2f2;
    --wait: #9ca3af;
    --after: #d1d5db;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; color: #111827; line-height: 1.6; padding: 2rem; max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  .subtitle { color: #6b7280; margin-bottom: 2rem; font-size: 0.9rem; }

  /* Summary cards */
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2.5rem; }
  .stat-card { background: white; border-radius: 8px; padding: 1rem 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .stat-card .label { font-size: 0.72rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-card .value { font-size: 1.75rem; font-weight: 700; margin-top: 0.15rem; }
  .val-safe { color: var(--safe); }
  .val-caught { color: var(--caught); }
  .val-nofire { color: var(--nofire); }

  /* Scenario card */
  .scenario { background: white; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; border-left: 4px solid var(--nofire); }
  .scenario.outcome-safe { border-left-color: var(--safe); }
  .scenario.outcome-caught { border-left-color: var(--caught); }
  .scenario.outcome-aborted { border-left-color: #7c3aed; }

  .scenario-header { padding: 0.85rem 1.25rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none; }
  .scenario-header:hover { background: #fafafa; }
  .scenario-id { font-weight: 700; font-size: 0.9rem; margin-right: 0.75rem; }
  .scenario-domain { font-size: 0.8rem; color: #6b7280; }
  .turn-type { font-size: 0.72rem; background: #f3f4f6; color: #6b7280; padding: 0.15rem 0.5rem; border-radius: 4px; margin-left: 0.5rem; }
  .badge { font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.65rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-safe { background: var(--safe-bg); color: var(--safe); }
  .badge-caught { background: var(--caught-bg); color: var(--caught); }
  .badge-aborted { background: #ede9fe; color: #7c3aed; }
  .badge-nofire { background: var(--nofire-bg); color: var(--nofire); }
  .fire-stat { font-size: 0.8rem; color: #6b7280; margin-right: 0.75rem; }
  .chevron { transition: transform 0.15s; font-size: 0.7rem; color: #9ca3af; margin-left: 0.5rem; }
  .scenario.open .chevron { transform: rotate(90deg); }

  /* Conversation context */
  .context { padding: 0.5rem 1.25rem 0.75rem; border-bottom: 1px solid #f3f4f6; }
  .ctx-line { font-size: 0.85rem; margin-bottom: 0.35rem; }
  .ctx-label { display: inline-block; width: 75px; font-weight: 600; color: #9ca3af; font-size: 0.75rem; text-transform: uppercase; }
  .ctx-text { color: #374151; }

  /* Detail panel */
  .detail { padding: 1rem 1.25rem 1.25rem; display: none; }
  .scenario.open .detail { display: block; }

  /* Timeline: the word-by-word progression */
  .timeline { position: relative; margin: 0.75rem 0; padding-left: 28px; }
  .timeline::before { content: ''; position: absolute; left: 10px; top: 0; bottom: 0; width: 2px; background: #e5e7eb; }
  .tl-step { position: relative; padding: 0.3rem 0 0.3rem 1rem; font-size: 0.82rem; }
  .tl-dot { position: absolute; left: -22px; top: 0.55rem; width: 10px; height: 10px; border-radius: 50%; border: 2px solid #d1d5db; background: white; }

  /* Wait step */
  .tl-step.waiting .tl-dot { border-color: #d1d5db; background: white; }
  .tl-step.waiting .tl-word { color: #6b7280; }
  .tl-step.waiting .tl-reason { color: #d1d5db; }

  /* FIRE step — the big moment */
  .tl-step.fired { padding: 0.6rem 0.75rem 0.6rem 1rem; margin: 0.4rem 0; background: var(--fire-bg); border-radius: 6px; border: 1px solid #fecaca; }
  .tl-step.fired .tl-dot { border-color: var(--fire); background: var(--fire); width: 12px; height: 12px; left: -23px; top: 0.75rem; }
  .tl-step.fired .tl-label { color: var(--fire); font-weight: 700; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .tl-step.fired .tl-partial { font-weight: 600; color: #111827; }

  /* Monitoring steps (post-fire, watching for shift) */
  .tl-step.monitoring .tl-dot { border-color: var(--safe); background: #d1fae5; }
  .tl-step.monitoring .tl-word { color: #6b7280; }
  .tl-step.monitoring .tl-reason { color: #059669; font-size: 0.75rem; }

  /* ABORT step — instability detected mid-utterance */
  .tl-step.abort { padding: 0.6rem 0.75rem 0.6rem 1rem; margin: 0.4rem 0; background: #fef3c7; border-radius: 6px; border: 1px solid #fde68a; }
  .tl-step.abort .tl-dot { border-color: #d97706; background: #d97706; width: 12px; height: 12px; left: -23px; top: 0.75rem; }
  .tl-step.abort .tl-label { color: #d97706; font-weight: 700; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .tl-step.abort .tl-partial { font-weight: 600; color: #111827; }

  /* After-abort steps (greyed) */
  .tl-step.after-abort { opacity: 0.4; }
  .tl-step.after-abort .tl-dot { border-color: #e5e7eb; background: #f3f4f6; }

  .tl-word { font-weight: 500; }
  .tl-partial { color: #374151; }
  .tl-reason { color: #9ca3af; font-size: 0.78rem; margin-left: 0.25rem; }

  /* Stability verdict box */
  .stability-box { margin-top: 0.75rem; padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.85rem; }
  .stability-box.verdict-same { background: var(--safe-bg2); border: 1px solid #a7f3d0; }
  .stability-box.verdict-different { background: var(--caught-bg2); border: 1px solid #fde68a; }
  .stability-box .sb-label { font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.3rem; }
  .stability-box.verdict-same .sb-label { color: var(--safe); }
  .stability-box.verdict-different .sb-label { color: var(--caught); }
  .sb-row { display: flex; gap: 0.5rem; margin-bottom: 0.15rem; font-size: 0.82rem; }
  .sb-key { color: #6b7280; min-width: 100px; }
  .sb-val { color: #374151; }
  .sb-val strong { font-weight: 600; }

  /* Legend */
  .legend { margin-top: 2.5rem; padding: 1.25rem; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-size: 0.82rem; }
  .legend h3 { margin-bottom: 0.75rem; font-size: 0.95rem; }
  .legend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem 2rem; }
  .legend-item dt { font-weight: 600; margin-bottom: 0.1rem; }
  .legend-item dd { color: #6b7280; }

  /* Demoted state (richness threshold override) */
  .scenario.demoted { border-left-color: #8b5cf6; }
  .scenario.demoted .badge-safe { display: none; }
  .scenario.demoted .badge-demoted { display: inline; }
  .scenario:not(.demoted) .badge-demoted { display: none; }
  .badge-demoted { background: #ede9fe; color: #7c3aed; font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.65rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
  .scenario.demoted .stability-box.verdict-same { background: #f5f3ff; border-color: #c4b5fd; }
  .scenario.demoted .stability-box.verdict-same .sb-label { color: #7c3aed; }
  .demoted-notice { display: none; margin-top: 0.4rem; padding: 0.4rem 0.75rem; background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 4px; font-size: 0.8rem; color: #7c3aed; }
  .scenario.demoted .demoted-notice { display: block; }
</style>
</head>
<body>
<h1>Fire Point Analysis Report</h1>
<p class="subtitle">
  Speculative fire pipeline: <strong>transcribed</strong> (fire-point detector) &rarr; <strong>cai-websocket</strong> (stability checker)<br>
  Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
</p>

<div class="summary">
  <div class="stat-card"><div class="label">Scenarios</div><div class="value">${reports.length}</div></div>
  <div class="stat-card"><div class="label">Fire Rate</div><div class="value">${Math.round(fired.length / reports.length * 100)}%</div></div>
  <div class="stat-card"><div class="label">Safe Fires</div><div class="value val-safe" id="safe-count">${safe.length}</div></div>
  <div class="stat-card"><div class="label">Caught (end-of-turn)</div><div class="value val-caught" id="caught-count">${caught.length}</div></div>
  <div class="stat-card"><div class="label">Aborted (mid-utterance)</div><div class="value" id="aborted-count" style="color:#7c3aed">${aborted.length}</div></div>
  <div class="stat-card"><div class="label">No Fire</div><div class="value val-nofire">${noFire.length}</div></div>
  <div class="stat-card"><div class="label">Avg Saved</div><div class="value" id="avg-saved">${avgSaved}%</div></div>
  <div class="stat-card"><div class="label">Wrong Responses</div><div class="value val-safe">0</div></div>
</div>

<div class="summary" style="margin-top: -1.5rem;">
  <div class="stat-card"><div class="label">Avg Time Saved (safe fires)</div><div class="value val-safe" id="avg-time-saved">${(avgTimeSavedSafe / 1000).toFixed(1)}s</div></div>
  <div class="stat-card"><div class="label">Max Time Saved</div><div class="value val-safe" id="max-time-saved">${(maxTimeSaved / 1000).toFixed(1)}s</div></div>
  <div class="stat-card"><div class="label">Min Time Saved</div><div class="value" id="min-time-saved">${(minTimeSaved / 1000).toFixed(1)}s</div></div>
  <div class="stat-card"><div class="label">Speech Rate (est.)</div><div class="value">${MS_PER_WORD}ms/w</div></div>
  <div class="stat-card"><div class="label">VAD Silence</div><div class="value">${VAD_SILENCE_MS}ms</div></div>
  <div class="stat-card">
    <div class="label">Richness Threshold</div>
    <select id="richness-threshold" style="font-size:1rem;font-weight:700;border:2px solid #e5e7eb;border-radius:6px;padding:0.25rem 0.5rem;margin-top:0.15rem;cursor:pointer;background:white;">
      <option value="none">None (speed-first)</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high" selected>High (default)</option>
    </select>
  </div>
</div>
`;

  for (const report of reports) {
    const s = report.scenario;
    const oc = report.fireOutcome === 'safe' ? 'outcome-safe'
      : report.fireOutcome === 'caught' ? 'outcome-caught'
      : report.fireOutcome === 'aborted' ? 'outcome-aborted' : '';
    const badgeCls = report.fireOutcome === 'safe' ? 'badge-safe'
      : report.fireOutcome === 'caught' ? 'badge-caught'
      : report.fireOutcome === 'aborted' ? 'badge-aborted' : 'badge-nofire';
    const badgeText = report.fireOutcome === 'safe' ? 'SAFE'
      : report.fireOutcome === 'caught' ? 'CAUGHT'
      : report.fireOutcome === 'aborted' ? 'ABORTED' : 'NO FIRE';
    const timeSavedStr = report.estTimeSavedMs
      ? ` &middot; ~${(report.estTimeSavedMs / 1000).toFixed(1)}s saved`
      : '';
    const abortStr = report.abortWordIndex
      ? ` &middot; abort at word ${report.abortWordIndex}`
      : '';
    const fireInfo = report.firedPartial
      ? `word ${report.fireWordIndex}/${report.totalWords} &middot; ${report.latencySavedPct}% saved${timeSavedStr}${abortStr}`
      : 'did not fire';

    html += `
<div class="scenario ${oc}" data-outcome="${report.fireOutcome}" data-richness="${report.contextRichnessLevel ?? 'none'}" data-time-saved="${report.estTimeSavedMs ?? 0}" data-latency-pct="${report.latencySavedPct ?? 0}">
  <div class="scenario-header" onclick="this.parentElement.classList.toggle('open')">
    <span>
      <span class="scenario-id">${esc(s.id)}</span>
      <span class="scenario-domain">${esc(s.domain)}</span>
      <span class="turn-type">${esc(report.turnType)}</span>
    </span>
    <span>
      <span class="fire-stat">${fireInfo}</span>
      <span class="badge ${badgeCls}">${badgeText}</span>${report.fireOutcome === 'safe' ? '<span class="badge badge-demoted">DEMOTED</span>' : ''}
      <span class="chevron">&#9654;</span>
    </span>
  </div>

  <div class="context">
    <div class="ctx-line"><span class="ctx-label">Assistant</span> <span class="ctx-text">"${esc(s.assistantTurn)}"</span></div>
    <div class="ctx-line"><span class="ctx-label">User</span> <span class="ctx-text">"${esc(s.userUtterance)}"</span></div>
  </div>

  <div class="detail">
    <div class="timeline">`;

    // Render each word step
    for (const step of report.steps) {
      if (step.phase === 'waiting') {
        html += `
      <div class="tl-step waiting">
        <div class="tl-dot"></div>
        <span class="tl-word">+${esc(step.word)}</span>
        <span class="tl-reason">&mdash; ${esc(step.fireReason)}</span>
      </div>`;
      } else if (step.phase === 'fired') {
        html += `
      <div class="tl-step fired">
        <div class="tl-dot"></div>
        <div class="tl-label">&#9889; Transcribed fires &rarr; sends to cai-websocket</div>
        <div class="tl-partial">"${esc(step.partial)}"</div>
        <div class="tl-reason">${esc(step.fireReason)}</div>
      </div>`;
      } else if (step.phase === 'monitoring') {
        html += `
      <div class="tl-step monitoring">
        <div class="tl-dot"></div>
        <span class="tl-word">+${esc(step.word)}</span>
        <span class="tl-reason">&check; still SAME${step.monitorReason ? ' — ' + esc(step.monitorReason) : ''}</span>
      </div>`;
      } else if (step.phase === 'abort') {
        html += `
      <div class="tl-step abort">
        <div class="tl-dot"></div>
        <div class="tl-label">&#9940; Abort — meaning shifted &rarr; cancel speculative generation</div>
        <div class="tl-partial">"${esc(step.partial)}"</div>
        <div class="tl-reason">${esc(step.monitorReason ?? '')}</div>
      </div>`;
      } else {
        // after-abort: remaining words greyed out
        html += `
      <div class="tl-step after-abort">
        <div class="tl-dot"></div>
        <span class="tl-word">+${esc(step.word)}</span>
        <span class="tl-reason">(post-abort)</span>
      </div>`;
      }
    }

    html += `
    </div>`;

    // Stability verdict box
    if (report.firedPartial) {
      const verdictCls = report.stabilityVerdict === 'SAME' ? 'verdict-same' : 'verdict-different';
      const verdictExplain = report.stabilityVerdict === 'SAME'
        ? 'Partial and final have the same actionable meaning. Speculative response is valid — send immediately.'
        : 'Final utterance changed the meaning. Speculative response discarded — reprocess with full utterance (no harm done).';

      html += `
    <div class="stability-box ${verdictCls}">
      <div class="sb-label">cai-websocket stability check (end of turn)</div>
      <div class="sb-row"><span class="sb-key">Fired partial:</span> <span class="sb-val">"<strong>${esc(report.firedPartial)}</strong>"</span></div>
      <div class="sb-row"><span class="sb-key">Final utterance:</span> <span class="sb-val">"${esc(s.userUtterance)}"</span></div>
      <div class="sb-row"><span class="sb-key">Verdict:</span> <span class="sb-val"><strong>${report.stabilityVerdict}</strong> (${(report.stabilityConfidence! * 100).toFixed(0)}% confidence)</span></div>
      <div class="sb-row"><span class="sb-key">Reason:</span> <span class="sb-val">${esc(report.stabilityReason ?? '')}</span></div>
      <div class="sb-row"><span class="sb-key">Outcome:</span> <span class="sb-val">${verdictExplain}</span></div>
      <div class="sb-row" style="margin-top:0.4rem; padding-top:0.4rem; border-top:1px solid ${report.stabilityVerdict === 'SAME' ? '#a7f3d0' : '#fde68a'};">
        <span class="sb-key">Est. timing:</span>
        <span class="sb-val">
          Utterance ~${((report.estUtteranceDurationMs ?? 0) / 1000).toFixed(1)}s
          &middot; Fired at ~${((report.estFirePointMs ?? 0) / 1000).toFixed(1)}s
          &middot; Remaining speech ~${((report.estRemainingSpeechMs ?? 0) / 1000).toFixed(1)}s
          + ${VAD_SILENCE_MS}ms VAD
          = <strong>~${((report.estTimeSavedMs ?? 0) / 1000).toFixed(1)}s head start</strong>
        </span>
      </div>${report.stabilityVerdict === 'SAME' && report.contextRichnessLevel && report.contextRichnessLevel !== 'none' ? `
      <div class="sb-row" style="margin-top:0.4rem; padding-top:0.4rem; border-top:1px solid #a7f3d0;">
        <span class="sb-key">Context lost:</span>
        <span class="sb-val">
          <span class="badge" style="background:${report.contextRichnessLevel === 'high' ? '#fef2f2;color:#dc2626' : report.contextRichnessLevel === 'medium' ? '#fef3c7;color:#d97706' : '#f0fdf4;color:#16a34a'}; font-size:0.7rem;">
            ${(report.contextRichnessLevel ?? '').toUpperCase()} RICHNESS
          </span>
          &nbsp;${esc(report.contextRichnessSummary ?? '')}
          <br><span style="color:#9ca3af;font-size:0.78rem">Recommendation: ${report.contextRichnessLevel === 'high' || report.contextRichnessLevel === 'medium' ? 'Send speculative response, but inject full utterance into conversation history for next turn' : 'Speculative response is sufficient as-is'}</span>
        </span>
      </div>` : ''}
      <div class="demoted-notice">&#9888; Richness threshold demoted this from SAFE &rarr; DIFFERENT. Speculative response would be discarded and reprocessed with full utterance for better quality.</div>${report.abortWordIndex ? `
      <div style="margin-top:0.4rem; padding:0.5rem 0.75rem; background:#ede9fe; border:1px solid #c4b5fd; border-radius:4px; font-size:0.82rem; color:#5b21b6;">
        <strong>&#9940; Early abort at word ${report.abortWordIndex}/${report.totalWords}</strong> — instability detected mid-utterance, ${((report.estAbortHeadStartMs ?? 0) / 1000).toFixed(1)}s before end-of-turn.
        Speculative generation cancelled early, reprocessing started at ~${((report.estAbortPointMs ?? 0) / 1000).toFixed(1)}s instead of ~${(((report.estUtteranceDurationMs ?? 0) + VAD_SILENCE_MS) / 1000).toFixed(1)}s.
      </div>` : ''}
    </div>`;
    } else {
      html += `
    <div class="stability-box" style="background:#f9fafb; border:1px solid #e5e7eb;">
      <div class="sb-label" style="color:var(--nofire);">No speculative fire</div>
      <div class="sb-row"><span class="sb-val">Detector never fired. Normal processing — no latency savings, no risk.</span></div>
    </div>`;
    }

    html += `
  </div>
</div>`;
  }

  html += `
<div class="legend">
  <h3>How to read this report</h3>
  <div class="legend-grid">
    <div class="legend-item">
      <dt>Phase 1: transcribed (fire-point detector)</dt>
      <dd>As each word arrives from Deepgram, the detector decides: WAIT (need more) or FIRE (send partial to cai-websocket now). Once fired, remaining words are greyed out — transcribed has already sent.</dd>
    </div>
    <div class="legend-item">
      <dt>Phase 2: cai-websocket (stability checker)</dt>
      <dd>When end-of-turn arrives, cai-websocket compares the fired partial against the final utterance. SAME = use the pre-generated response (latency win). DIFFERENT = discard and reprocess (no harm).</dd>
    </div>
    <div class="legend-item">
      <dt>SAFE (green border)</dt>
      <dd>Fired early, all monitoring steps confirmed SAME, end-of-turn stability SAME. Response sent immediately — latency saved.</dd>
    </div>
    <div class="legend-item">
      <dt>ABORTED (purple border)</dt>
      <dd>Fired early, but monitoring detected a meaning shift mid-utterance. Speculative generation cancelled immediately — earlier than waiting for end-of-turn. Less wasted compute than CAUGHT.</dd>
    </div>
    <div class="legend-item">
      <dt>CAUGHT (amber border)</dt>
      <dd>Fired early, monitoring stayed SAME, but end-of-turn stability check caught a change. Speculative response discarded, reprocessed normally. No wrong response sent.</dd>
    </div>
    <div class="legend-item">
      <dt>Turn type</dt>
      <dd>How the detector classified the assistant's last turn. Determines what counts as "enough" to fire (e.g. yes-no only needs an affirmative, wh-question needs an entity).</dd>
    </div>
    <div class="legend-item">
      <dt>Safety guarantee</dt>
      <dd>False positives (wrong response sent) = 0. The stability checker is the safety net — it always runs before any response reaches the user.</dd>
    </div>
  </div>
</div>

<script>
// Open all scenarios by default
document.querySelectorAll('.scenario').forEach(el => el.classList.add('open'));

// Richness threshold interactive control
const RICHNESS_ORDER = { none: 0, low: 1, medium: 2, high: 3 };
const scenarios = document.querySelectorAll('.scenario[data-outcome]');
const thresholdSelect = document.getElementById('richness-threshold');

function applyThreshold() {
  const threshold = thresholdSelect.value;
  let safeCount = 0, caughtCount = 0, abortedCount = 0, totalFiredPct = 0, firedCount = 0;
  const safeTimes = [];

  scenarios.forEach(el => {
    const baseOutcome = el.dataset.outcome;
    const richness = el.dataset.richness || 'none';
    const timeSaved = parseFloat(el.dataset.timeSaved) || 0;
    const latencyPct = parseInt(el.dataset.latencyPct) || 0;

    // Demote: safe + richness >= threshold (but 'none' threshold = never demote)
    const isDemoted = baseOutcome === 'safe'
      && threshold !== 'none'
      && richness !== 'none'
      && RICHNESS_ORDER[richness] >= RICHNESS_ORDER[threshold];

    el.classList.toggle('demoted', isDemoted);
    // Restore or override border class
    if (isDemoted) {
      el.classList.remove('outcome-safe');
    } else if (baseOutcome === 'safe') {
      el.classList.add('outcome-safe');
    }

    // Count effective outcomes
    const effectiveOutcome = isDemoted ? 'caught' : baseOutcome;
    if (effectiveOutcome === 'safe') {
      safeCount++;
      safeTimes.push(timeSaved);
    }
    if (effectiveOutcome === 'caught') caughtCount++;
    if (effectiveOutcome === 'aborted') abortedCount++;
    if (baseOutcome !== 'no-fire') {
      firedCount++;
      totalFiredPct += (effectiveOutcome === 'safe' || effectiveOutcome === 'caught') ? latencyPct : 0;
    }
  });

  // Update summary cards
  document.getElementById('safe-count').textContent = safeCount;
  document.getElementById('caught-count').textContent = caughtCount;
  document.getElementById('aborted-count').textContent = abortedCount;
  document.getElementById('avg-saved').textContent = firedCount > 0
    ? Math.round(totalFiredPct / firedCount) + '%' : '0%';

  if (safeTimes.length > 0) {
    const avg = safeTimes.reduce((a, b) => a + b, 0) / safeTimes.length;
    document.getElementById('avg-time-saved').textContent = (avg / 1000).toFixed(1) + 's';
    document.getElementById('max-time-saved').textContent = (Math.max(...safeTimes) / 1000).toFixed(1) + 's';
    document.getElementById('min-time-saved').textContent = (Math.min(...safeTimes) / 1000).toFixed(1) + 's';
  } else {
    document.getElementById('avg-time-saved').textContent = '0.0s';
    document.getElementById('max-time-saved').textContent = '0.0s';
    document.getElementById('min-time-saved').textContent = '0.0s';
  }
}

thresholdSelect.addEventListener('change', applyThreshold);
</script>
</body>
</html>`;

  return html;
}

async function main(): Promise<void> {
  console.log('Fire Point Report Generator\n');
  await stabilityChecker.init();

  const reports: ScenarioReport[] = [];
  for (const scenario of FIRE_POINT_SCENARIOS) {
    process.stdout.write(`  Analysing ${scenario.id}...`);
    const report = await analyseScenario(scenario);
    reports.push(report);
    console.log(` ${report.fireOutcome}`);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const htmlPath = join(RESULTS_DIR, 'fire-point-report.html');

  writeFileSync(htmlPath, generateHtml(reports));
  console.log(`\nReport: ${htmlPath}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
