# CAI Filler Test Rig — Current State

> Last updated: 2026-03-22

---

## What This Tool Does

Tests latency reduction strategies for conversational AI (VoIP). The core problem: users wait 2-3 seconds in silence while a reasoning LLM (Claude Haiku 4.5 with extended thinking) processes. A fast LLM (Nova 2 Lite) generates something to say immediately while the slow LLM works.

## Strategy Overview

Three filler strategies implemented, plus a baseline:

| Strategy | How it works | Coherence |
|---|---|---|
| **opening_sentence** | Fast LLM generates a 5-10 word contextual reaction sentence | **4.4/5** |
| **dynamic** | Fast LLM generates thinking sounds ("Hmm, ok...") | 3.6/5 |
| **intent_conditioned** | Classify intent, pick a template filler | 3.5/5 |
| **none** (baseline) | No filler, raw reasoning LLM latency | N/A |

**Opening sentence is the winner** — the only strategy exceeding the >=4.0 coherence target.

## Architecture (Opening Sentence Strategy)

```
User speaks
    │
    ├──► Speech Act Classifier (regex, 0ms)
    │       Outputs: [SPEECH_ACT: complaint] [DOMAIN: call_quality] [SENTIMENT: frustrated]
    │
    ├──► Taxonomy Category Selection (by fast LLM)
    │       Picks: VALIDATION | COMPETENCE | ALIGNMENT | EMPATHY | CURIOSITY
    │
    ├──► Fast LLM (Nova 2 Lite, ~800ms)
    │       Generates: "That often points to a network stability issue."
    │
    └──► Reasoning LLM (Haiku 4.5 + extended thinking, ~1100ms TTFT)
            Receives opening as prior assistant turn
            Continues naturally: "Here are the most common culprits..."
```

Key design decisions:
- Opening sentence injected as **prior assistant turn** (not prefill — prefill breaks extended thinking)
- Reasoning LLM system prompt instructs it to continue as "consecutive sentences from the same person"
- `extractFirstSentence()` grabs >=5 words across multiple sentences for coherence scoring
- Anti-parroting: fast LLM must NOT echo back user's question, must react with knowledge/context

## Enhancement Backlog Status

See [ENHANCEMENT-BACKLOG.md](./ENHANCEMENT-BACKLOG.md) for full details.

| # | Enhancement | Status | Impact |
|---|---|---|---|
| 1 | Speech Act Classification | **Done** | Foundation — tags fed to fast LLM |
| 3 | Intent-Emotion-Action Taxonomy | **Done** | Category selection: VALIDATION/COMPETENCE/ALIGNMENT/EMPATHY/CURIOSITY |
| 4 | Few-Shot Examples from Real Transcripts | Corpus research done | See [CORPUS-REFERENCES.md](./CORPUS-REFERENCES.md) |
| 6 | Latency-Adaptive Opener Length | Not started | — |
| 5 | Conversation History Priming | Partial (variety only) | — |
| 8 | Continuation Sentence Architecture | Not started | High risk/reward |
| 2 | SSML Prosodic Markers | Not started | TTS-dependent |
| 7 | Prosodic Emotion Tags | Not started | TTS-dependent |

## Known Issue: Sales Queries Score Low

The taxonomy routes billing/pricing questions to **ALIGNMENT** category, which produces generic openers like *"That's an easy one to cover"* that feel dismissive before detailed factual answers. Scores 3/5.

**Fix needed**: Route `[DOMAIN: billing] + [SPEECH_ACT: question|statement]` to **COMPETENCE** instead of ALIGNMENT. This is a small change in either:
- The prompt (add guidance: "For pricing/feature questions, use COMPETENCE not ALIGNMENT")
- Or the classifier (add a mapping hint in the tags)

This was identified but **not yet implemented** — it's the next thing to do.

## Latest Test Results (18 turns, opening_sentence only)

```
Avg Coherence:     4.4/5
Score distribution: 10x 5/5, 5x 4/5, 3x 3/5
Bridge Rate:       6% (1/18)
Filler Variety:    97% unique
Fast LLM Latency:  ~800ms avg
Reasoning TTFT:    ~1070ms avg
Perceived Latency: ~1020ms avg
```

**By system prompt:**
- technical_support: 5.0/5 avg (6/6 perfect) — COMPETENCE category excels here
- customer_support: 4.3/5 avg — ALIGNMENT works well for requests
- sales_enquiry: 3.7/5 avg — ALIGNMENT feels dismissive for info-seeking questions

## Key Files

| File | Purpose |
|---|---|
| `src/speech-act-classifier.ts` | Regex/keyword heuristic: speech act + domain + sentiment |
| `src/filler-opening-sentence.ts` | Opening sentence generator (calls classifier, calls fast LLM) |
| `src/reasoning-llm.ts` | Reasoning LLM wrapper + filler injection + first sentence extraction |
| `src/test-executor.ts` | Orchestrates turns, retry logic, strategy routing |
| `src/csv-reporter.ts` | CSV output (strips newlines from fields) |
| `prompts/filler-opening-sentence.txt` | The fast LLM prompt (taxonomy + examples + anti-parrot rules) |
| `config/test-speech-act.yaml` | Config for opening_sentence-only test runs |
| `results/test_speech_act.csv` | Latest results (33 rows: 15 from pre-taxonomy + 18 from taxonomy run) |

## Run Commands

```bash
# Run opening_sentence test (18 turns)
~/.bun/bin/bun run filler-test -- --config tools/cai-filler-test-rig/config/test-speech-act.yaml

# Run all strategies comparison (72 turns)
~/.bun/bin/bun run filler-test -- --config tools/cai-filler-test-rig/config/test-opening-sentence.yaml

# Analyze results
~/.bun/bin/bun run tools/cai-filler-test-rig/analyze-results.ts -- tools/cai-filler-test-rig/results/test_speech_act.csv
```
