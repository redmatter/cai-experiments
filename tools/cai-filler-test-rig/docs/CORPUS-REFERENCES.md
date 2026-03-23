# Conversation Corpora — Reference Guide

Resources for extracting real human opening sentence patterns to improve the fast LLM prompt (Enhancement #4 in the backlog).

---

## Tier 1: Directly Actionable

### Switchboard Dialog Act Corpus (SwDA)

The gold mine. 1,155 five-minute conversations, 221,616 utterances, tagged with SWBD-DAMSL dialogue act labels.

**Why it's perfect**: Filter for every instance where Speaker B's first utterance after Speaker A finishes is tagged as acknowledgment/agreement/appreciation, then extract the text + what follows. Gives "human opening sentence -> continuation" pairs grouped by speech act type.

**Key DAMSL tags to filter**:

| Tag | Meaning | Example |
|-----|---------|---------|
| `b` | Backchannel | "Uh-huh", "Yeah" |
| `aa` | Agree/accept | "That's exactly it", "Right" |
| `ba` | Appreciation | "I can see that" |
| `bk` | Acknowledgment (response to inform) | — |
| `sv` | Statement-opinion | Substantive follow-on after ack |
| `sd` | Statement-non-opinion | Factual follow-on |

**Target extraction**: Pairs where `b`/`aa`/`ba`/`bk` is immediately followed by `sv` or `sd` within the same speaker's turn — that's the "acknowledgment + substantive opener" pattern.

**Access**:
- Python library + CSV: `github.com/cgpotts/swda` (Christopher Potts, Stanford)
- ConvoKit: `from convokit import Corpus, download; corpus = Corpus(filename=download("switchboard-corpus"))`
- Use the **raw version** (with disfluencies), not the cleaned version

**Expected yield**: ~15,000-20,000 "acknowledgment + substance" pairs.

---

### CallCenterEN

91,706 conversations, 10,448 audio hours of real English call centre transcripts. PII redacted. CC BY-NC 4.0.

**Why it's valuable**: Directly domain-relevant (agent-customer phone calls). Per-word temporal metadata with word-level timestamps and confidence scores — can measure actual timing gap between customer end-of-turn and agent first word, then correlate with opening pattern used.

**Limitation**: Not dialogue-act tagged. Need to either tag it (using a classifier trained on SwDA) or do keyword/pattern extraction. With 91K conversations, even crude pattern matching on first 10 words of agent turns yields thousands of usable examples.

**Access**: `arxiv.org/abs/2507.02958` — paper links to dataset download.

---

## Tier 2: Supplementary Patterns

### DailyDialog

13,118 dialogues, manually labelled with communication intention and emotion. Each utterance tagged with dialogue act (inform, question, directive, commissive) and emotion label.

**Value**: Emotion x dialogue act pairing — "how do people open a response when the prior turn was emotional?"

**Limitation**: Formal language from English-learning websites. Lacks spontaneous disfluencies. Good for structurally correct transitions, not natural spoken patterns.

**Access**: `huggingface.co/datasets/li2017dailydialog/daily_dialog`

### MultiWOZ

10K+ dialogues across task-oriented domains (hotel, restaurant, train booking). Useful for seeing how human agents open responses after information-gathering turns.

**Access**: `huggingface.co/datasets/pfb30/multi_woz_v22`

### MRDA (Meeting Recorder Dialogue Act)

75 hours of speech from 75 meetings, 53 speakers. Modified SWBD-DAMSL tagset. Multi-party acknowledgment patterns (more explicit signalling than dyadic conversations).

---

## Tier 2b: Natterbox Own Call Data

Potentially the most valuable source. Targeted extraction of:

- First 1-3 seconds of every agent response (after customer finishes speaking)
- Filtered to best-performing agents (by CSAT, resolution rate)
- Transcribed and manually categorised by opening pattern type

Even 500-1000 examples from own domain > 10,000 from a general corpus (right vocabulary, register, cultural expectations).

---

## Tier 3: Specialised

| Corpus | Size | Notes |
|--------|------|-------|
| **TeleSalesCorpus** | — | Sub-dialogue analysis (opening, pitch, objection, closing). Relevant for outbound/sales. |
| **AxonData English Contact Centre** | 1,000+ hours | Real call centre audio + transcripts on HuggingFace. Could do prosodic analysis. |
| **Fisher Corpus** (LDC) | ~2,000 hours | Telephone speech, larger than Switchboard. Requires LDC membership. |
| **Santa Barbara Corpus** | Smaller | Face-to-face natural conversation with prosodic/intonation annotation. |

---

## Recommended Pipeline

### Step 1 — SwDA Extraction
Download via `cgpotts/swda` GitHub repo. Extract every speaker-B turn where first utterance is tagged `b`, `aa`, `ba`, or `bk` and second utterance (same speaker) is tagged `sd` or `sv`. Cluster by pattern (empathy opener, agreement opener, competence opener, etc.).

### Step 2 — CallCenterEN Extraction
Extract first 15 words of every agent turn following a customer turn. Tag with opening sentence categories (validation, competence, alignment, empathy, curiosity) using lightweight classifier or LLM batch job.

### Step 3 — Natterbox Transcripts
Mine own call transcripts with same extraction logic. Manually tag 200-500 examples. These become the few-shot examples in the fast LLM prompt.

### Step 4 — Prompt Integration
Use categorised examples from all three sources to build structured prompt with 5-10 examples per category, grounded in real human speech patterns.
