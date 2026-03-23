# Opening Sentence Strategy — Enhancement Backlog

Enhancements to push coherence beyond 4.2/5 toward 4.6-4.8/5. Work through one at a time.

---

## 1. Speech Act Classification as Input to the Fast LLM

**Status**: Implemented

Pass a structured hint to the fast LLM before it generates the opening sentence. A lightweight classifier (or regex/keyword heuristic) detects the speech act type from the user's utterance — categories like acknowledgement, question, directive, commitment, emotional expression.

The fast LLM prompt receives something like `[SPEECH_ACT: complaint] [DOMAIN: sip_configuration] [SENTIMENT: frustrated]` alongside the transcript, producing more precisely calibrated openers. A complaint needs empathy-forward language, a factual question needs domain-confidence signalling, a confused ramble needs gentle steering.

Classification can run in parallel with STT since only a partial transcript is needed for sentiment and speech act detection.

---

## 2. Prosodic Continuation Markers (SSML Injection)

**Status**: Not started

Filler words alone aren't enough — timing makes them feel real. When humans say "um," they pause briefly, then restart with a connector like "so." Agents often miss this by saying "um" then going full speed, which lands as fake.

If the TTS engine supports SSML tags, the fast LLM can output SSML-annotated text that controls the prosodic bridge into the reasoning LLM's response:

```xml
"That's a common hiccup with Natterbox setups<break time="400ms"/>"
```

The trailing break gives the reasoning LLM's first tokens time to arrive at TTS while maintaining a natural "thinking pause." Break duration should be calibrated to actual reasoning LLM TTFT (if reasoner takes ~1.5s and opener takes ~1s to speak, need ~500ms of managed silence).

Can go further with pitch contour:

```xml
<prosody pitch="+5%" rate="95%">That's actually a really common SIP issue</prosody><break time="350ms"/>
```

A slight pitch rise at the end signals "I'm not done" — prosodic cue that tells the listener more is coming, bridging the gap to the reasoner's output.

---

## 3. Intent-Emotion-Action Taxonomy for Opening Sentence Templates

**Status**: Implemented

Build a taxonomy of opening sentence *types* keyed to the Intent → Emotion → Action loop. Not hardcoded templates — categories that the fast LLM selects from:

| Category | When to use | Examples |
|---|---|---|
| **Validation** | Frustrated/confused users | "Yeah, that's definitely not right" / "I can see why that's confusing" |
| **Competence** | Technical questions | "SIP traces will tell us exactly what's happening" / "That's a routing config issue I've seen before" |
| **Alignment** | Requests/tasks | "Absolutely, let me pull that up" / "Good call, that's worth checking" |
| **Empathy** | Complaints/escalations | "I hear you, that shouldn't be happening" / "That's frustrating, especially mid-call" |
| **Curiosity** | Ambiguous queries | "Interesting — there are a couple of things that could cause that" |

The fast LLM prompt includes category selection as part of its task, with few-shot examples per category. Gives structural variety while ensuring tonal appropriateness.

---

## 4. Few-Shot Examples from Real Call Transcripts

**Status**: Not started
**Impact**: Likely the single highest-leverage enhancement.

Mine existing Natterbox call transcripts for the first 5-10 words that the best human agents say after a customer finishes speaking. Look for patterns like:

- Customer describes SIP issue → Agent: *"OK so that's typically a registration timeout..."*
- Customer is frustrated → Agent: *"Right, yeah, I completely understand..."*
- Customer asks how-to → Agent: *"Sure, so the way you'd do that is..."*

Extract 50-100 real human openers, categorised by speech act type and domain, and use them as few-shot examples in the fast LLM prompt. Real agent speech patterns have the natural cadence, domain vocabulary, and register that synthetic examples miss.

---

## 5. Conversation History Priming

**Status**: Partially implemented (conversation history passed for variety only)

The fast LLM should receive more context than just the current utterance:

- **Last 2-3 turns** of conversation (so it can reference what was just discussed)
- **Customer profile signals** (new vs returning, technical vs non-technical, sentiment trajectory)
- **Current topic/entity** (if tracked — "we're currently discussing SIP registration for account X")

Enables openers like *"Right, so going back to that registration issue..."* or *"OK, and this is on the same trunk we were looking at?"* — sentences that demonstrate conversational continuity, which is far more powerful than generic domain acknowledgment.

---

## 6. Latency-Adaptive Opener Length

**Status**: Not started

Not all situations need the same opener length. Users expect instant responses to yes/no but tolerate delays for complex questions.

Build a heuristic: if the user asked a short, simple question ("Can you transfer me?"), the opener should be ultra-short ("Sure thing" — 2 words, ~400ms of speech) because the reasoner will be fast too. If the user described a complex multi-part problem, a 7-10 word contextual opener is both natural and buys more time.

The fast LLM receives a `[COMPLEXITY: low|medium|high]` signal based on user utterance length, question word count, or topic classification, and adjusts opener length accordingly.

---

## 7. Prosodic Emotion Tags (TTS Engine Dependent)

**Status**: Not started
**Dependency**: Requires TTS engine that supports emotion/style tags (ElevenLabs, Cartesia, or similar)

Annotate the opening sentence with an emotion directive:

```xml
<emotion value="empathetic">I completely understand, that's really frustrating</emotion>
```

Key insight: keep the emotional baseline calm/warm and only deviate for specific triggers. If the agent cycles through excited → amused → sad → angry in one turn, it sounds unstable. Set the baseline, then give specific scenarios where stronger emotions make sense.

---

## 8. Continuation Sentence Architecture

**Status**: Not started
**Impact**: Most architecturally significant enhancement. Also highest coherence risk.

Instead of the fast LLM generating just an opening sentence, have it generate a **continuation hint** — a partial sentence that the reasoner is structurally compelled to complete:

Instead of:
> Fast LLM: *"That's a common SIP registration issue."*
> Reasoner: *"The most likely cause is..."*

Try:
> Fast LLM: *"That's a common SIP registration issue, and the most likely cause is"*
> Reasoner continues: *"...a timeout on the REGISTER transaction between..."*

The trailing conjunction or clause-opener creates a syntactic dependency that forces seamless continuation. Blurs the line between acknowledgment and answer, making the entire response feel like one coherent thought.

**Risk**: Coherence failure if the reasoner goes in a different direction than the continuation implies. Mitigate with conservative continuation hints — connectors like *"and what you'll want to check is"*, *"so the way to handle that is"*, *"and from what you're describing"* — flexible enough for multiple completion directions.

---

## Suggested Implementation Order

Based on impact vs effort:

1. **#4 Few-Shot Examples** — highest leverage, prompt-only change
2. **#1 Speech Act Classification** — structured input improves all downstream quality
3. **#3 Intent-Emotion-Action Taxonomy** — builds on #1, prompt-level change
4. **#6 Latency-Adaptive Length** — simple heuristic, measurable impact
5. **#5 Conversation History Priming** — extend existing partial implementation
6. **#8 Continuation Sentence** — high reward but needs careful coherence testing
7. **#2 SSML Injection** — depends on TTS engine capabilities in production
8. **#7 Emotion Tags** — depends on TTS engine capabilities in production
