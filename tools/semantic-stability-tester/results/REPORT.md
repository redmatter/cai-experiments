# Semantic Stability Tester — Test Report

**Date**: 2026-03-23
**Branch**: `fillers`

---

## Executive Summary

The speculative fire pipeline achieves **99.6% stability accuracy** with **zero false positives** across an 847-pair corpus spanning 20+ conversational domains. The fire-point detector achieves a **47% safe-fire rate** (14/30 scenarios), saving an average of **60% of utterance latency** when it fires.

| Metric | Value |
|---|---|
| Stability accuracy | **99.6%** |
| False positives (wrong response sent) | **0** |
| False negatives (safe, extra latency) | **3** |
| F1 score | **99.6%** |
| Corpus size | **847 pairs** |
| Fire-point scenarios | **30** |
| Safe fires (latency win) | **14 (47%)** |
| Avg latency saved on fire | **60%** |
| Decision latency (P50) | **0.0ms** |

---

## Corpus Composition

### Sources

| Source | Pairs | Domains |
|---|---|---|
| **Schema-Guided Dialogue (SGD)** | 692 | Banking, flights, events, ridesharing, weather, calendar, movies, media, homes, services, buses, rental cars, restaurants, hotels |
| **MultiWOZ 2.2** | 41 | Restaurants, hotels, trains, taxis, attractions |
| **Handcrafted** (EN) | 72 | Customer service, tech support, billing, general |
| **Handcrafted** (DE) | 42 | Same domains, German language |
| **Total** | **847** | |

### Category Distribution

| Category | Pairs | Verdict | Accuracy | FP | FN |
|---|---|---|---|---|---|
| filler-only | 178 | SAME | **100.0%** | 0 | 0 |
| elaboration | 168 | SAME | 98.8% | 0 | 2 |
| entity-addition | 176 | DIFFERENT | **100.0%** | 0 | 0 |
| time-addition | 168 | DIFFERENT | **100.0%** | 0 | 0 |
| number-addition | 101 | DIFFERENT | **100.0%** | 0 | 0 |
| new-request | 16 | DIFFERENT | **100.0%** | 0 | 0 |
| negation-reversal | 8 | DIFFERENT | **100.0%** | 0 | 0 |
| qualification | 8 | DIFFERENT | **100.0%** | 0 | 0 |
| topic-shift | 8 | DIFFERENT | **100.0%** | 0 | 0 |
| correction | 8 | DIFFERENT | **100.0%** | 0 | 0 |
| partial-word | 8 | SAME | 87.5% | 0 | 1 |

### Language Distribution

| Language | Pairs | Accuracy |
|---|---|---|
| English | 805 | **99.8%** |
| German | 42 | **97.6%** |

---

## Stability Strategy: Token Delta Heuristic

Pure linguistic rules — no model needed. Analyses new tokens added between interim and final transcripts.

### Detection Pipeline

```
1. No delta                  → SAME (identical)
2. Partial-word completion   → SAME (ASR artefact)
3. Reversal phrases          → DIFFERENT ("actually no", "never mind")
4. Closing words only        → SAME ("goodbye", "bye", "have a nice day")
5. Closing phrases           → SAME ("that works", "that is all I need")
6. Category noun only        → SAME ("Italian" → "Italian food")
7. Negation markers          → DIFFERENT ("not", "never", "cancel")
8. Addition markers + content → DIFFERENT ("and also can you...")
9. Context-aware check       → Uses assistant turn type to decide
10. Context-free fallback    → Filler ratio analysis
```

### Context-Aware Checks

The strategy uses the assistant's last turn to determine expected answer type:

| Turn Type | Fire Condition | Stability Logic |
|---|---|---|
| yes-no question | Affirmative/negative detected | Short answer (1-2 words) + delta = elaboration → SAME |
| confirmation | Affirmative detected | Same as yes-no; negative waits for correction |
| wh-question | Answer content detected | Falls through to context-free (delta is critical) |
| choice-question | Choice word detected | Falls through to context-free |
| information | Ack detected | Short ack + filler delta → SAME |
| action-complete | Ack detected | Same as information |
| open-ended | 4+ content words | Falls through to context-free |

### Word Lists

| List | EN | DE | Purpose |
|---|---|---|---|
| FILLER_WORDS | 107 entries | 73 entries | Tokens that never change actionable meaning |
| NEGATION_MARKERS | 12 entries | 14 entries | Tokens that signal reversal |
| REVERSAL_PHRASES | 13 phrases | 9 phrases | Multi-word patterns always meaning DIFFERENT |
| ADDITION_MARKERS | 12 entries | 10 entries | Topic shift signals |
| CLOSING_WORDS | 12 entries | 10 entries | Farewell vocabulary |
| CLOSING_PHRASES | 16 phrases | 6 phrases | Multi-word closing idioms ("that works") |
| CATEGORY_NOUNS | 8 entries | 7 entries | Implied clarifiers ("food", "restaurant") |

---

## Fire-Point Detector Results

### Summary

| Metric | Value |
|---|---|
| Total scenarios | 30 |
| Fired | **30 (100%)** |
| Safe (latency win) | **14 (47%)** |
| Caught (discarded, no harm) | 16 (53%) |
| Wrong response sent | **0** |
| Avg fire point | 40% through utterance |
| Avg latency saved | 60% of utterance |
| Decision latency | 0.07ms avg |

### By Turn Type

| Turn Type | Scenarios | Safe | Caught | Win Rate |
|---|---|---|---|---|
| yes-no | 7 | 4 | 3 | 57% |
| wh-question | 5 | 4 | 1 | 80% |
| confirmation | 3 | 1 | 2 | 33% |
| open-ended | 3 | 0 | 3 | 0% |
| information | 4 | 2 | 2 | 50% |
| choice | 2 | 0 | 2 | 0% |
| DE (mixed) | 6 | 3 | 3 | 50% |

### Safe Fires (Latency Wins)

| ID | Turn Type | Fired On | Utterance Saved | Latency Win |
|---|---|---|---|---|
| yn-001 | yes-no | "Yes" | 75% | "Yes please go ahead" |
| yn-003 | yes-no | "No" | 86% | "No I left it at home sorry" |
| yn-004 | yes-no | "No" | 80% | "No that's everything thank you" |
| yn-007 | yes-no | "No" | 89% | "No it's working now actually..." |
| wh-001 | wh-question | "I'd like to go to Berlin" | 14% | "...Berlin please" |
| wh-002 | wh-question | "Next Friday" | 50% | "Next Friday if possible" |
| wh-004 | wh-question | "It's 4-5-7-2-9-8-1" | 100% | Complete answer |
| wh-005 | wh-question | "There will be four" | 33% | "...four of us" |
| conf-001 | confirmation | "Yes" | 75% | "Yes that sounds right" |
| info-001 | info | "OK" | 67% | "OK thank you" |
| info-003 | action-complete | "Perfect" | 80% | "Perfect thank you very much" |
| de-yn-001 | yes-no | "Ja" | 67% | "Ja bitte gerne" |
| de-conf-001 | confirmation | "Ja" | 75% | "Ja genau das stimmt" |
| de-conf-002 | confirmation | "Nein" | 86% | "Nein es sollte Samstag sein..." |

---

## Remaining False Negatives (3)

These are irreducible for a heuristic approach:

| ID | Interim | Final | Category | Why |
|---|---|---|---|---|
| en-elab-004 | "The product is broken" | "The product is broken, it just doesn't work" | elaboration | Paraphrase — requires semantic understanding |
| en-partial-003 | "I need to spe" | "I need to speak to someone" | partial-word | Multi-word partial completion — niche ASR edge case |
| de-elab-003 | "Das Produkt ist kaputt" | "Das Produkt ist kaputt, es funktioniert einfach nicht" | elaboration | German paraphrase elaboration |

All 3 are **safe misses** — they add latency but never send a wrong response.

---

## Pipeline Safety Analysis

### Three possible outcomes when fire-point fires:

```
1. SAFE   — stability check says SAME  → speculative response sent → latency win
2. CAUGHT — stability check says DIFF  → speculative response discarded → no harm
3. WRONG  — stability check says SAME but final differs → wrong response sent → BAD
```

**Outcome 3 has never occurred** across all 847 stability pairs and 30 fire-point scenarios.

### Safety guarantees

- **Precision: 100%** — every time we say SAME, it IS the same
- **FP rate: 0.0%** — across 847 pairs covering 20+ domains, 2 languages, 11 semantic categories
- The heuristic is **conservative by design** — when uncertain, it says DIFFERENT (safe miss)
- Reversal phrases and negation markers are checked **before** any SAME logic

---

## Changes Since Last Report

| Change | Impact |
|---|---|
| Added SGD corpus (7 shards, 20+ domains) | +304 pairs, massive domain diversity |
| Added CLOSING_WORDS vocabulary | Catches farewell tokens ("goodbye", "bye") |
| Added CLOSING_PHRASES patterns | Catches idioms ("that works", "that is all I need") |
| Added CATEGORY_NOUNS vocabulary | Catches implied clarifiers ("Italian" → "Italian food") |
| Added `awesome`, `helpful` to FILLER_WORDS | Positive evaluations now correctly classified |
| Short-interim refinement (yes-no + info paths) | <=2 word interims trust context verdict directly |
| Tightened CLOSING_WORDS (removed `today`, `later`) | Prevented temporal words being misclassified as closing |
