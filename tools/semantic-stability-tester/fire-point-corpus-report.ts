#!/usr/bin/env bun
// Fire Point Corpus Report
//
// Runs the full fire-point pipeline (fire → monitor → abort → stability)
// across the entire 847-pair corpus and generates an aggregate HTML report.
//
// For each corpus pair:
//   1. Walk the FINAL utterance word-by-word through the fire-point detector
//   2. After fire: run post-fire shift monitoring at each word
//   3. At end-of-turn: run stability check (fired partial vs final)
//   4. Compare against expectedVerdict ground truth

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { detectFirePoint } from './src/fire-point/detector';
import { classifyAssistantTurn } from './src/fire-point/turn-classifier';
import { TokenDeltaHeuristicStrategy } from './src/strategies/token-delta-heuristic';
import { REVERSAL_PHRASES, NEGATION_MARKERS, ADDITION_MARKERS, FILLER_WORDS, CLOSING_WORDS } from './src/word-lists';
import { detectLanguage } from './src/detect-language';
import { EN_CORPUS } from './src/corpus/en';
import { DE_CORPUS } from './src/corpus/de';
import type { UtterancePair, Verdict, SemanticChangeCategory } from './src/types';

const TOOL_DIR = import.meta.dir;
const RESULTS_DIR = join(TOOL_DIR, 'results');
const stabilityChecker = new TokenDeltaHeuristicStrategy();

// Speech timing estimates
const MS_PER_WORD = 462;
const VAD_SILENCE_MS = 2000;
const LLM_GENERATION_MS = 2500;

type Outcome = 'safe' | 'caught' | 'aborted' | 'no-fire';

interface CorpusPairResult {
  pair: UtterancePair;
  turnType: string;
  // Fire point
  fired: boolean;
  earlyHandoff: boolean;  // fire point before end of utterance (remaining speech > 0)
  fireWordIndex?: number;
  firedPartial?: string;
  totalWords: number;
  // Monitoring
  aborted: boolean;
  abortWordIndex?: number;
  abortReason?: string;
  // End-of-turn stability
  stabilityVerdict?: Verdict;
  stabilityReason?: string;
  // Context richness
  contextRichnessLevel?: string;
  // Outcome
  outcome: Outcome;
  // Timing estimates
  estHeadStartMs?: number;
  estLatencyWithoutMs?: number;
  estLatencyWithMs?: number;
  estLatencySavedMs?: number;
  estLatencySavedPct?: number;
  estAbortHeadStartMs?: number;
  // Ground truth comparison
  expectedVerdict: Verdict;
  pipelineCorrect: boolean;  // did the pipeline make the right call?
  pipelineFP: boolean;       // pipeline said safe but expected DIFFERENT (dangerous!)
  pipelineFN: boolean;       // pipeline said caught/aborted but expected SAME (extra latency)
}

// --- Post-fire shift detector (same as fire-point-report.ts) ---

const QUALIFICATION_MARKERS: Record<string, Set<string>> = {
  en: new Set(['but', 'except', 'however', 'although', 'unless', 'only', 'instead']),
  de: new Set(['aber', 'außer', 'jedoch', 'allerdings', 'es sei denn', 'nur', 'stattdessen']),
};

function detectPostFireShift(
  firedPartial: string,
  currentPartial: string,
  turnType: string,
  lang: string,
): { shifted: boolean; reason: string } {
  const firedLower = firedPartial.toLowerCase().trim();
  const currentLower = currentPartial.toLowerCase().trim();

  if (currentLower === firedLower || currentLower.length <= firedLower.length) {
    return { shifted: false, reason: 'no new content' };
  }

  const delta = currentLower.startsWith(firedLower)
    ? currentLower.slice(firedLower.length).trim()
    : '';
  if (!delta) return { shifted: false, reason: 'no delta' };

  const deltaWords = delta.split(/\s+/).filter((w) => w.length > 0);
  if (deltaWords.length === 0) return { shifted: false, reason: 'empty delta' };

  const fillers = FILLER_WORDS[lang] ?? FILLER_WORDS['en'];
  const closers = CLOSING_WORDS[lang] ?? CLOSING_WORDS['en'];

  // 1. Reversal phrases
  const reversals = REVERSAL_PHRASES[lang] ?? REVERSAL_PHRASES['en'];
  for (const phrase of reversals) {
    if (currentLower.includes(phrase)) {
      return { shifted: true, reason: `reversal phrase: "${phrase}"` };
    }
  }

  // 2. Qualification markers + content
  const qualifiers = QUALIFICATION_MARKERS[lang] ?? QUALIFICATION_MARKERS['en'];
  for (let i = 0; i < deltaWords.length; i++) {
    const cleaned = deltaWords[i].replace(/[.,!?;:'"…\-()]/g, '');
    if (qualifiers.has(cleaned)) {
      const afterQualifier = deltaWords.slice(i + 1);
      const hasContent = afterQualifier.some((w) => {
        const c = w.replace(/[.,!?;:'"…\-()]/g, '');
        return c.length > 0 && !fillers.has(c) && !closers.has(c);
      });
      if (hasContent) {
        return { shifted: true, reason: `qualification: "${cleaned}" + content` };
      }
    }
  }

  // 3. Addition markers + 2+ content words
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
        return { shifted: true, reason: `addition: "${cleaned}" + ${contentAfter.length} content words` };
      }
    }
  }

  // 4. Negation markers + following content (with idiom exclusion)
  const negMarkers = NEGATION_MARKERS[lang] ?? NEGATION_MARKERS['en'];
  if (['yes-no-question', 'confirmation', 'information', 'action-complete'].includes(turnType)) {
    const harmlessNegIdioms = lang === 'de'
      ? ['kein problem', 'nicht schlimm', 'macht nichts']
      : ['why not', 'no worries', 'no problem', 'not bad', 'not a problem', "don't worry"];

    const isHarmlessIdiom = harmlessNegIdioms.some((idiom) => delta.includes(idiom));
    if (!isHarmlessIdiom) {
      for (let i = 0; i < deltaWords.length; i++) {
        const cleaned = deltaWords[i].replace(/[.,!?;:'"…\-()]/g, '');
        if (negMarkers.has(cleaned)) {
          const wordsAfter = deltaWords.slice(i + 1);
          const contentAfter = wordsAfter.filter((w) => {
            const c = w.replace(/[.,!?;:'"…\-()]/g, '');
            return c.length > 0 && !fillers.has(c) && !closers.has(c);
          });
          if (contentAfter.length > 0) {
            return { shifted: true, reason: `negation: "${cleaned}" + content` };
          }
        }
      }
    }
  }

  return { shifted: false, reason: 'delta is elaboration/filler' };
}

// --- Analysis ---

async function analysePair(pair: UtterancePair): Promise<CorpusPairResult> {
  const assistantTurn = pair.context?.turns?.find((t) => t.role === 'assistant')?.content ?? '';
  const words = pair.final.split(/\s+/).filter((w) => w.length > 0);
  const turnType = assistantTurn ? classifyAssistantTurn(assistantTurn) : 'unknown';
  const context = assistantTurn
    ? { turns: [{ role: 'assistant' as const, content: assistantTurn }] }
    : undefined;

  // Use the corpus INTERIM as the fire point.
  // This aligns the pipeline's comparison with the corpus ground truth:
  //   corpus tests: interim vs final → expectedVerdict
  //   pipeline tests: firedPartial (=interim) → monitor → stability vs final
  const firedPartial = pair.interim;
  const interimWords = pair.interim.split(/\s+/).filter((w) => w.length > 0);
  const fireWordIndex = interimWords.length;

  let abortWordIndex: number | undefined;
  let abortReason: string | undefined;

  // Walk remaining words (after fire point) through monitoring
  for (let i = fireWordIndex + 1; i <= words.length; i++) {
    const partial = words.slice(0, i).join(' ');

    if (abortWordIndex === undefined) {
      const lang = detectLanguage(partial || assistantTurn);
      const shift = detectPostFireShift(firedPartial, partial, turnType, lang);
      if (shift.shifted) {
        abortWordIndex = i;
        abortReason = shift.reason;
        break;
      }
    }
  }

  // End-of-turn stability check
  let stabilityVerdict: Verdict | undefined;
  let stabilityReason: string | undefined;
  let contextRichnessLevel: string | undefined;

  if (firedPartial) {
    const result = await stabilityChecker.compare(firedPartial, pair.final, context);
    stabilityVerdict = result.verdict;
    stabilityReason = (result.details as Record<string, unknown>)?.reason as string ?? '';
    contextRichnessLevel = result.contextRichness?.level;
  }

  // Determine outcome — every corpus pair has a fire point (the interim)
  const outcome: Outcome = abortWordIndex !== undefined
    ? 'aborted'
    : stabilityVerdict === 'SAME'
      ? 'safe'
      : 'caught';

  // Timing — same latency model as scenario report
  const estUtteranceDurationMs = words.length * MS_PER_WORD;
  const estRemainingSpeechMs = fireWordIndex ? (words.length - fireWordIndex) * MS_PER_WORD : undefined;
  const estLatencyWithoutMs = VAD_SILENCE_MS + LLM_GENERATION_MS;
  const estHeadStartMs = estRemainingSpeechMs !== undefined ? estRemainingSpeechMs + VAD_SILENCE_MS : undefined;
  const estLatencyWithMs = estHeadStartMs !== undefined
    ? VAD_SILENCE_MS + Math.max(0, LLM_GENERATION_MS - estHeadStartMs)
    : undefined;
  const estLatencySavedMs = estLatencyWithMs !== undefined ? estLatencyWithoutMs - estLatencyWithMs : undefined;
  const estLatencySavedPct = estLatencySavedMs !== undefined
    ? Math.round((estLatencySavedMs / estLatencyWithoutMs) * 100)
    : undefined;
  const estAbortPointMs = abortWordIndex ? abortWordIndex * MS_PER_WORD : undefined;
  const estAbortHeadStartMs = (estAbortPointMs !== undefined)
    ? (estUtteranceDurationMs + VAD_SILENCE_MS) - estAbortPointMs
    : undefined;

  // Pipeline correctness
  // safe = pipeline says SAME → check against expectedVerdict
  // aborted/caught = pipeline says DIFFERENT → check against expectedVerdict
  const pipelineVerdict: Verdict = outcome === 'safe' ? 'SAME' : 'DIFFERENT';
  const pipelineCorrect = pipelineVerdict === pair.expectedVerdict;
  const pipelineFP = outcome === 'safe' && pair.expectedVerdict === 'DIFFERENT';
  const pipelineFN = (outcome === 'caught' || outcome === 'aborted') && pair.expectedVerdict === 'SAME';

  return {
    pair,
    turnType,
    fired: true,
    earlyHandoff: fireWordIndex < words.length,
    fireWordIndex,
    firedPartial,
    totalWords: words.length,
    aborted: !!abortWordIndex,
    abortWordIndex,
    abortReason,
    stabilityVerdict,
    stabilityReason,
    contextRichnessLevel,
    outcome,
    estHeadStartMs,
    estLatencyWithoutMs,
    estLatencyWithMs,
    estLatencySavedMs,
    estLatencySavedPct,
    estAbortHeadStartMs,
    expectedVerdict: pair.expectedVerdict,
    pipelineCorrect,
    pipelineFP,
    pipelineFN,
  };
}

// --- HTML Report ---

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateHtml(results: CorpusPairResult[]): string {
  const total = results.length;
  const fired = results.filter((r) => r.fired);
  const earlyHandoffs = results.filter((r) => r.earlyHandoff);
  const safe = results.filter((r) => r.outcome === 'safe');
  const caught = results.filter((r) => r.outcome === 'caught');
  const aborted = results.filter((r) => r.outcome === 'aborted');
  const noFire = results.filter((r) => r.outcome === 'no-fire');
  const fps = results.filter((r) => r.pipelineFP);
  const fns = results.filter((r) => r.pipelineFN);
  const correct = results.filter((r) => r.pipelineCorrect);

  const baselineLatency = VAD_SILENCE_MS + LLM_GENERATION_MS;
  const avgLatencySavedSafe = safe.length > 0
    ? safe.reduce((s, r) => s + (r.estLatencySavedMs ?? 0), 0) / safe.length
    : 0;
  const avgLatencyWithSafe = safe.length > 0
    ? safe.reduce((s, r) => s + (r.estLatencyWithMs ?? 0), 0) / safe.length
    : 0;
  const avgLatencySavedPctSafe = safe.length > 0
    ? Math.round(safe.reduce((s, r) => s + (r.estLatencySavedPct ?? 0), 0) / safe.length)
    : 0;
  const totalLatencySaved = safe.reduce((s, r) => s + (r.estLatencySavedMs ?? 0), 0);
  const avgAbortHead = aborted.length > 0
    ? aborted.reduce((s, r) => s + (r.estAbortHeadStartMs ?? 0), 0) / aborted.length
    : 0;

  // By category
  const categories = [...new Set(results.map((r) => r.pair.category))].sort();
  const catStats = categories.map((cat) => {
    const catResults = results.filter((r) => r.pair.category === cat);
    const catEarlyHandoffs = catResults.filter((r) => r.earlyHandoff);
    const catSafe = catResults.filter((r) => r.outcome === 'safe');
    const catAborted = catResults.filter((r) => r.outcome === 'aborted');
    const catCaught = catResults.filter((r) => r.outcome === 'caught');
    const catFP = catResults.filter((r) => r.pipelineFP);
    const catFN = catResults.filter((r) => r.pipelineFN);
    const catSameCount = catResults.filter((r) => r.expectedVerdict === 'SAME').length;
    const catDiffCount = catResults.filter((r) => r.expectedVerdict === 'DIFFERENT').length;
    return {
      cat, total: catResults.length, catSameCount, catDiffCount,
      earlyHandoffs: catEarlyHandoffs.length, safe: catSafe.length,
      aborted: catAborted.length, caught: catCaught.length,
      fp: catFP.length, fn: catFN.length,
    };
  });

  // By turn type
  const turnTypes = [...new Set(results.map((r) => r.turnType))].sort();
  const turnStats = turnTypes.map((tt) => {
    const ttResults = results.filter((r) => r.turnType === tt);
    const ttSafe = ttResults.filter((r) => r.outcome === 'safe');
    const ttAborted = ttResults.filter((r) => r.outcome === 'aborted');
    const ttCaught = ttResults.filter((r) => r.outcome === 'caught');
    return {
      tt, total: ttResults.length,
      safe: ttSafe.length, aborted: ttAborted.length, caught: ttCaught.length,
      earlyHandoffs: ttResults.filter((r) => r.earlyHandoff).length,
    };
  });

  // By language
  const langs = [...new Set(results.map((r) => r.pair.language))].sort();
  const langStats = langs.map((lang) => {
    const lr = results.filter((r) => r.pair.language === lang);
    return {
      lang, total: lr.length,
      safe: lr.filter((r) => r.outcome === 'safe').length,
      aborted: lr.filter((r) => r.outcome === 'aborted').length,
      caught: lr.filter((r) => r.outcome === 'caught').length,
      fp: lr.filter((r) => r.pipelineFP).length,
      fn: lr.filter((r) => r.pipelineFN).length,
    };
  });

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fire Point Corpus Report — ${total} pairs</title>
<style>
  :root {
    --safe: #059669; --safe-bg: #d1fae5;
    --caught: #d97706; --caught-bg: #fef3c7;
    --aborted: #7c3aed; --aborted-bg: #ede9fe;
    --nofire: #6b7280; --nofire-bg: #f3f4f6;
    --fire: #dc2626; --fp: #dc2626; --fn: #2563eb;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; color: #111827; line-height: 1.6; padding: 2rem; max-width: 1600px; margin: 0 auto; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 0.75rem; color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.35rem; }
  .subtitle { color: #6b7280; margin-bottom: 2rem; font-size: 0.9rem; }

  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
  .stat-card { background: white; border-radius: 8px; padding: 0.85rem 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .stat-card .label { font-size: 0.68rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-card .value { font-size: 1.5rem; font-weight: 700; margin-top: 0.1rem; }
  .stat-card .sub { font-size: 0.72rem; color: #9ca3af; margin-top: 0.1rem; }
  .val-safe { color: var(--safe); }
  .val-caught { color: var(--caught); }
  .val-aborted { color: var(--aborted); }
  .val-nofire { color: var(--nofire); }
  .val-fp { color: var(--fp); }
  .val-fn { color: var(--fn); }

  table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  th { background: #f9fafb; font-size: 0.72rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.6rem 0.75rem; text-align: left; border-bottom: 2px solid #e5e7eb; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f3f4f6; font-size: 0.85rem; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f9fafb; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .fp-cell { color: var(--fp); font-weight: 700; }
  .fn-cell { color: var(--fn); font-weight: 600; }

  .badge { font-size: 0.65rem; font-weight: 600; padding: 0.15rem 0.45rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-safe { background: var(--safe-bg); color: var(--safe); }
  .badge-caught { background: var(--caught-bg); color: var(--caught); }
  .badge-aborted { background: var(--aborted-bg); color: var(--aborted); }
  .badge-nofire { background: var(--nofire-bg); color: var(--nofire); }
  .badge-fp { background: #fef2f2; color: var(--fp); }
  .badge-fn { background: #eff6ff; color: var(--fn); }
  .badge-same { background: var(--safe-bg); color: var(--safe); }
  .badge-diff { background: var(--caught-bg); color: var(--caught); }

  .detail-section { background: white; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .detail-section h3 { font-size: 0.95rem; margin-bottom: 0.75rem; }
  .pair-card { border-left: 3px solid #e5e7eb; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; font-size: 0.82rem; }
  .pair-card.fp { border-left-color: var(--fp); background: #fef2f2; }
  .pair-card.fn { border-left-color: var(--fn); background: #eff6ff; }
  .pair-card.aborted { border-left-color: var(--aborted); }
  .pair-card .pair-meta { color: #6b7280; font-size: 0.75rem; margin-bottom: 0.25rem; }
  .pair-card .pair-text { margin-bottom: 0.15rem; }
  .pair-card .pair-label { display: inline-block; width: 60px; font-weight: 600; color: #9ca3af; font-size: 0.72rem; text-transform: uppercase; }

  .section-desc { font-size: 0.82rem; color: #6b7280; margin: -0.25rem 0 0.75rem; line-height: 1.5; }
  .pipeline-diagram { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; margin: 1rem 0; font-family: monospace; font-size: 0.8rem; line-height: 1.8; }
  .pipeline-diagram .arrow { color: #9ca3af; }
  .pipeline-diagram .phase { font-weight: 700; }
</style>
</head>
<body>
<h1>Fire Point Corpus Report</h1>
<p class="subtitle">
  Full pipeline analysis: <strong>fire-point detection</strong> &rarr; <strong>post-fire monitoring</strong> &rarr; <strong>end-of-turn stability</strong><br>
  ${total} corpus pairs &middot; Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')}
</p>

<div class="pipeline-diagram">
  <span class="phase" style="color:var(--nofire)">WAIT</span> <span class="arrow">&rarr;</span>
  <span class="phase" style="color:var(--fire)">FIRE</span> (send partial to LLM) <span class="arrow">&rarr;</span>
  <span class="phase" style="color:var(--safe)">MONITOR</span> (check each word) <span class="arrow">&rarr;</span>
  <span class="phase" style="color:var(--aborted)">ABORT?</span> (cancel if shifted) <span class="arrow">&rarr;</span>
  <span class="phase" style="color:var(--caught)">END-OF-TURN</span> (final stability check)
</div>

<h2>Pipeline Summary</h2>
<p class="section-desc">Overall results of running the speculative handoff pipeline across all corpus pairs. An "early handoff" means the interim transcript was a prefix of the final - the speaker kept talking after the handoff point, giving the LLM a head start. Safe = latency win, Aborted = cancelled mid-utterance, Caught = discarded at end-of-turn.</p>
<div class="summary">
  <div class="stat-card"><div class="label">Corpus Pairs</div><div class="value">${total}</div></div>
  <div class="stat-card"><div class="label">Early Handoffs</div><div class="value">${Math.round(earlyHandoffs.length / total * 100)}%</div><div class="sub">${earlyHandoffs.length}/${total} pairs with remaining speech</div></div>
  <div class="stat-card"><div class="label">Safe (latency win)</div><div class="value val-safe">${safe.length}</div><div class="sub">${(safe.length / total * 100).toFixed(1)}%</div></div>
  <div class="stat-card"><div class="label">Aborted (mid-utterance)</div><div class="value val-aborted">${aborted.length}</div><div class="sub">${(aborted.length / total * 100).toFixed(1)}%</div></div>
  <div class="stat-card"><div class="label">Caught (end-of-turn)</div><div class="value val-caught">${caught.length}</div><div class="sub">${(caught.length / total * 100).toFixed(1)}%</div></div>
  <div class="stat-card"><div class="label">No Fire</div><div class="value val-nofire">${noFire.length}</div><div class="sub">${(noFire.length / total * 100).toFixed(1)}%</div></div>
  <div class="stat-card"><div class="label">Pipeline Accuracy</div><div class="value">${(correct.length / total * 100).toFixed(1)}%</div><div class="sub">${correct.length}/${total} pairs</div></div>
  <div class="stat-card"><div class="label">False Positives</div><div class="value val-fp">${fps.length}</div><div class="sub">wrong response sent</div></div>
  <div class="stat-card"><div class="label">False Negatives</div><div class="value val-fn">${fns.length}</div><div class="sub">safe, extra latency</div></div>
</div>

<div class="summary">
  <div class="stat-card"><div class="label">Baseline Latency</div><div class="value val-caught">${(baselineLatency / 1000).toFixed(1)}s</div><div class="sub">VAD ${(VAD_SILENCE_MS/1000).toFixed(1)}s + LLM ${(LLM_GENERATION_MS/1000).toFixed(1)}s</div></div>
  <div class="stat-card"><div class="label">Avg Latency (safe)</div><div class="value val-safe">${(avgLatencyWithSafe / 1000).toFixed(1)}s</div><div class="sub">down from ${(baselineLatency / 1000).toFixed(1)}s</div></div>
  <div class="stat-card"><div class="label">Avg Latency Saved</div><div class="value val-safe">${(avgLatencySavedSafe / 1000).toFixed(1)}s</div><div class="sub">${avgLatencySavedPctSafe}% reduction</div></div>
  <div class="stat-card"><div class="label">Total Latency Saved</div><div class="value val-safe">${(totalLatencySaved / 1000).toFixed(0)}s</div><div class="sub">across ${safe.length} safe handoffs</div></div>
  <div class="stat-card"><div class="label">Avg Abort Head Start</div><div class="value val-aborted">${(avgAbortHead / 1000).toFixed(1)}s</div><div class="sub">earlier than end-of-turn</div></div>
</div>

<div class="summary">
  <div class="stat-card" style="grid-column: span 3;"><div class="label">Assumptions</div><div class="sub" style="margin-top:0.3rem">Speech: ${MS_PER_WORD}ms/word (~130 WPM) | VAD endpointing: ${(VAD_SILENCE_MS/1000).toFixed(1)}s (no turn-detect for short responses) | LLM generation: ${(LLM_GENERATION_MS/1000).toFixed(1)}s | Latency = time from user finishes speaking to response ready</div></div>
</div>

<h2>By Category</h2>
<p class="section-desc">Breakdown by semantic change category. Expected shows the ground-truth label distribution (SAME = meaning unchanged, DIFF = meaning changed). Early Handoff shows how many pairs had remaining speech after the handoff point. FP must always be 0 - a false positive means the wrong response would be sent to the caller.</p>
<table>
  <thead>
    <tr><th>Category</th><th>Expected</th><th class="num">Pairs</th><th class="num">Early Handoff</th><th class="num">Safe</th><th class="num">Aborted</th><th class="num">Caught</th><th class="num">FP</th><th class="num">FN</th></tr>
  </thead>
  <tbody>
${catStats.map((c) => `    <tr>
      <td>${esc(c.cat)}</td>
      <td>${c.catSameCount > 0 ? `<span class="badge badge-same">${c.catSameCount} SAME</span> ` : ''}${c.catDiffCount > 0 ? `<span class="badge badge-diff">${c.catDiffCount} DIFF</span>` : ''}</td>
      <td class="num">${c.total}</td>
      <td class="num">${c.earlyHandoffs}</td>
      <td class="num" style="color:var(--safe);font-weight:${c.safe > 0 ? '600' : '400'}">${c.safe}</td>
      <td class="num" style="color:var(--aborted);font-weight:${c.aborted > 0 ? '600' : '400'}">${c.aborted}</td>
      <td class="num" style="color:var(--caught)">${c.caught}</td>
      <td class="num ${c.fp > 0 ? 'fp-cell' : ''}">${c.fp}</td>
      <td class="num ${c.fn > 0 ? 'fn-cell' : ''}">${c.fn}</td>
    </tr>`).join('\n')}
  </tbody>
</table>

<h2>By Assistant Turn Type</h2>
<p class="section-desc">How outcomes vary by the type of assistant turn that preceded the user's response. The turn type affects what kind of user response is expected (e.g. a yes-no-question expects a short answer, an information turn expects elaboration) and how aggressively the pipeline can speculate.</p>
<table>
  <thead>
    <tr><th>Turn Type</th><th class="num">Pairs</th><th class="num">Early Handoff</th><th class="num">Safe</th><th class="num">Aborted</th><th class="num">Caught</th></tr>
  </thead>
  <tbody>
${turnStats.map((t) => `    <tr>
      <td>${esc(t.tt)}</td>
      <td class="num">${t.total}</td>
      <td class="num">${t.earlyHandoffs}/${t.total}</td>
      <td class="num" style="color:var(--safe);font-weight:${t.safe > 0 ? '600' : '400'}">${t.safe}</td>
      <td class="num" style="color:var(--aborted)">${t.aborted}</td>
      <td class="num" style="color:var(--caught)">${t.caught}</td>
    </tr>`).join('\n')}
  </tbody>
</table>

<h2>By Language</h2>
<p class="section-desc">Pipeline performance by language. The heuristic word lists (fillers, negation markers, qualifiers) are language-specific, so accuracy may vary across languages.</p>
<table>
  <thead>
    <tr><th>Language</th><th class="num">Pairs</th><th class="num">Safe</th><th class="num">Aborted</th><th class="num">Caught</th><th class="num">FP</th><th class="num">FN</th></tr>
  </thead>
  <tbody>
${langStats.map((l) => `    <tr>
      <td>${esc(l.lang.toUpperCase())}</td>
      <td class="num">${l.total}</td>
      <td class="num" style="color:var(--safe);font-weight:600">${l.safe}</td>
      <td class="num" style="color:var(--aborted)">${l.aborted}</td>
      <td class="num" style="color:var(--caught)">${l.caught}</td>
      <td class="num ${l.fp > 0 ? 'fp-cell' : ''}">${l.fp}</td>
      <td class="num ${l.fn > 0 ? 'fn-cell' : ''}">${l.fn}</td>
    </tr>`).join('\n')}
  </tbody>
</table>`;

  // False Positives detail (critical)
  if (fps.length > 0) {
    html += `
<h2 style="color:var(--fp)">&#9888; False Positives (${fps.length}) — Wrong Response Sent</h2>
<div class="detail-section">
  <h3>Pipeline said SAFE but ground truth is DIFFERENT — these would send the WRONG response</h3>
${fps.map((r) => `  <div class="pair-card fp">
    <div class="pair-meta">${esc(r.pair.id)} &middot; ${esc(r.pair.category)} &middot; ${esc(r.turnType)} &middot; fire at word ${r.fireWordIndex}/${r.totalWords}</div>
    <div class="pair-text"><span class="pair-label">Fired</span> "${esc(r.firedPartial ?? '')}"</div>
    <div class="pair-text"><span class="pair-label">Final</span> "${esc(r.pair.final)}"</div>
    <div class="pair-text"><span class="pair-label">Stability</span> ${r.stabilityReason ?? ''}</div>
    ${r.pair.context?.turns?.[0] ? `<div class="pair-text"><span class="pair-label">Asst</span> "${esc(r.pair.context.turns[0].content)}"</div>` : ''}
  </div>`).join('\n')}
</div>`;
  }

  // False Negatives detail (informational)
  if (fns.length > 0) {
    html += `
<h2 style="color:var(--fn)">False Negatives (${fns.length}) — Extra Latency, No Harm</h2>
<div class="detail-section">
  <h3>Pipeline said DIFFERENT but ground truth is SAME — missed latency savings</h3>
${fns.slice(0, 50).map((r) => `  <div class="pair-card fn">
    <div class="pair-meta">
      ${esc(r.pair.id)} &middot; ${esc(r.pair.category)} &middot; ${esc(r.turnType)}
      &middot; <span class="badge badge-${r.outcome === 'aborted' ? 'aborted' : 'caught'}">${r.outcome.toUpperCase()}</span>
      ${r.abortReason ? `&middot; abort: ${esc(r.abortReason)}` : `&middot; stability: ${esc(r.stabilityReason ?? '')}`}
    </div>
    <div class="pair-text"><span class="pair-label">Fired</span> "${esc(r.firedPartial ?? '')}"</div>
    <div class="pair-text"><span class="pair-label">Final</span> "${esc(r.pair.final)}"</div>
    ${r.pair.context?.turns?.[0] ? `<div class="pair-text"><span class="pair-label">Asst</span> "${esc(r.pair.context.turns[0].content)}"</div>` : ''}
  </div>`).join('\n')}
${fns.length > 50 ? `<p style="color:#6b7280;font-size:0.82rem">... and ${fns.length - 50} more</p>` : ''}
</div>`;
  }

  // Aborted examples (interesting)
  const abortedExamples = aborted.filter((r) => r.pipelineCorrect).slice(0, 20);
  if (abortedExamples.length > 0) {
    html += `
<h2 style="color:var(--aborted)">Early Abort Examples (${aborted.filter((r) => r.pipelineCorrect).length} correct aborts)</h2>
<div class="detail-section">
  <h3>Monitoring detected meaning shift mid-utterance — cancelled speculative generation early</h3>
${abortedExamples.map((r) => `  <div class="pair-card aborted">
    <div class="pair-meta">
      ${esc(r.pair.id)} &middot; ${esc(r.pair.category)} &middot; ${esc(r.turnType)}
      &middot; abort at word ${r.abortWordIndex}/${r.totalWords}
      &middot; ~${((r.estAbortHeadStartMs ?? 0) / 1000).toFixed(1)}s earlier than end-of-turn
    </div>
    <div class="pair-text"><span class="pair-label">Fired</span> "${esc(r.firedPartial ?? '')}"</div>
    <div class="pair-text"><span class="pair-label">Abort</span> "${esc(r.pair.final.split(/\s+/).slice(0, r.abortWordIndex).join(' '))}"</div>
    <div class="pair-text"><span class="pair-label">Final</span> "${esc(r.pair.final)}"</div>
    <div class="pair-text"><span class="pair-label">Reason</span> ${esc(r.abortReason ?? '')}</div>
  </div>`).join('\n')}
${aborted.filter((r) => r.pipelineCorrect).length > 20 ? `<p style="color:#6b7280;font-size:0.82rem">... showing first 20 of ${aborted.filter((r) => r.pipelineCorrect).length}</p>` : ''}
</div>`;
  }

  // Safe examples (sample)
  const safeCorrect = safe.filter((r) => r.pipelineCorrect).slice(0, 15);
  if (safeCorrect.length > 0) {
    html += `
<h2 style="color:var(--safe)">Safe Fire Examples (${safe.filter((r) => r.pipelineCorrect).length} correct saves)</h2>
<div class="detail-section">
  <h3>Fired early, monitoring stayed SAME, end-of-turn confirmed — latency saved</h3>
${safeCorrect.map((r) => `  <div class="pair-card" style="border-left-color:var(--safe)">
    <div class="pair-meta">
      ${esc(r.pair.id)} &middot; ${esc(r.pair.category)} &middot; ${esc(r.turnType)}
      &middot; fire word ${r.fireWordIndex}/${r.totalWords}
      &middot; ${((r.estLatencyWithMs ?? 0) / 1000).toFixed(1)}s vs ${((r.estLatencyWithoutMs ?? 0) / 1000).toFixed(1)}s (-${((r.estLatencySavedMs ?? 0) / 1000).toFixed(1)}s)
    </div>
    <div class="pair-text"><span class="pair-label">Fired</span> "${esc(r.firedPartial ?? '')}"</div>
    <div class="pair-text"><span class="pair-label">Final</span> "${esc(r.pair.final)}"</div>
  </div>`).join('\n')}
${safe.filter((r) => r.pipelineCorrect).length > 15 ? `<p style="color:#6b7280;font-size:0.82rem">... showing first 15 of ${safe.filter((r) => r.pipelineCorrect).length}</p>` : ''}
</div>`;
  }

  html += `
<div class="detail-section" style="margin-top: 2rem;">
  <h3>How to read this report</h3>
  <p style="font-size:0.85rem;color:#6b7280;line-height:1.8">
    <strong>Safe</strong> = fired partial to LLM, monitoring confirmed stable, end-of-turn confirmed → speculative response sent (latency win).<br>
    <strong>Aborted</strong> = fired partial, but monitoring detected a meaning shift mid-utterance → speculative cancelled early (less wasted compute than caught).<br>
    <strong>Caught</strong> = fired partial, monitoring stayed stable, but end-of-turn stability check found a difference → speculative discarded (no harm).<br>
    <strong>No Fire</strong> = fire-point detector never triggered (insufficient content for the turn type).<br>
    <strong>FP (false positive)</strong> = pipeline says safe but ground truth is DIFFERENT → wrong response would be sent. <strong>This must be 0.</strong><br>
    <strong>FN (false negative)</strong> = pipeline says caught/aborted but ground truth is SAME → missed latency saving, but no harm.
  </p>
</div>
</body>
</html>`;

  return html;
}

// --- Main ---

async function main(): Promise<void> {
  console.log('Fire Point Corpus Report\n');
  await stabilityChecker.init();

  // Load all corpus pairs
  const corpus: UtterancePair[] = [];
  corpus.push(...EN_CORPUS);
  corpus.push(...DE_CORPUS);

  const generatedPath = join(TOOL_DIR, 'corpus', 'generated-en.json');
  if (existsSync(generatedPath)) {
    const generated: UtterancePair[] = JSON.parse(readFileSync(generatedPath, 'utf-8'));
    corpus.push(...generated);
  }

  console.log(`Corpus loaded: ${corpus.length} pairs`);
  console.log(`  EN handcrafted: ${EN_CORPUS.length}`);
  console.log(`  DE handcrafted: ${DE_CORPUS.length}`);
  console.log(`  Generated: ${corpus.length - EN_CORPUS.length - DE_CORPUS.length}\n`);

  // Analyse all pairs
  const results: CorpusPairResult[] = [];
  let count = 0;
  for (const pair of corpus) {
    const result = await analysePair(pair);
    results.push(result);
    count++;
    if (count % 100 === 0) {
      process.stdout.write(`  ${count}/${corpus.length}...\r`);
    }
  }
  console.log(`  Analysed ${results.length} pairs`);

  // Quick summary
  const safe = results.filter((r) => r.outcome === 'safe').length;
  const aborted = results.filter((r) => r.outcome === 'aborted').length;
  const caught = results.filter((r) => r.outcome === 'caught').length;
  const noFire = results.filter((r) => r.outcome === 'no-fire').length;
  const fps = results.filter((r) => r.pipelineFP).length;
  const fns = results.filter((r) => r.pipelineFN).length;

  const earlyHandoffCount = results.filter((r) => r.earlyHandoff).length;

  console.log(`\nResults:`);
  console.log(`  Early handoffs: ${earlyHandoffCount}/${results.length} (${(earlyHandoffCount / results.length * 100).toFixed(1)}%)`);
  console.log(`  Safe:    ${safe} (${(safe / results.length * 100).toFixed(1)}%)`);
  console.log(`  Aborted: ${aborted} (${(aborted / results.length * 100).toFixed(1)}%)`);
  console.log(`  Caught:  ${caught} (${(caught / results.length * 100).toFixed(1)}%)`);
  console.log(`  No fire: ${noFire} (${(noFire / results.length * 100).toFixed(1)}%)`);
  console.log(`  FP:      ${fps}`);
  console.log(`  FN:      ${fns}`);

  // Write report
  mkdirSync(RESULTS_DIR, { recursive: true });
  const htmlPath = join(RESULTS_DIR, 'fire-point-corpus-report.html');
  writeFileSync(htmlPath, generateHtml(results));
  console.log(`\nReport: ${htmlPath}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
