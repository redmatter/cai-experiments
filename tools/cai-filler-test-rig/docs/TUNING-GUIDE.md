# Filler Strategy Tuning Guide

## Key Learnings from Testing

### 1. Natural Human Fillers Work Best

**Problem**: Traditional phrases like "Let me help you with that" set up expectations that the reasoning LLM might not fulfill, causing coherence mismatches.

**Solution**: Use minimal, natural thinking sounds humans actually make when processing:
- Pure thinking: "Hmm...", "Uh...", "Ah..."
- Acknowledgments: "Ok...", "Right...", "Alright..."
- Transitions: "So...", "Well..."

**Results**:
- Coherence scores: 4-5/5 (vs 3-4/5 with action phrases)
- Bridge trigger rate: 0% (vs 58% with longer phrases)
- Perceived latency: ~1000ms (vs 900-1100ms before)

### 2. Shorter is Better

**Optimal Length**:
- Primary: 2-4 words (not 4-6)
- Bridge: 1-2 words (not 2-3) - pure sounds only

**Why**:
- Shorter TTS duration = reasoning LLM catches up faster
- Less chance of needing bridge filler
- More natural (humans don't think in 6-word phrases)
- Lower perceived latency

### 2a. Bridge Phrases Must Be Even More Minimal

**Critical Issue**: Bridge phrases can create awkward repetition or conflict with the actual response.

**Example of the problem**:
```
Primary: "Hmm, alright..."
Bridge:  "Let me check..." [TRIGGERED]
Response: "let me check a few quick things with you."
Result:  "Hmm, alright... Let me check... let me check..." [AWKWARD REPETITION]
```

**Solution**: Bridge phrases must be ONLY pure thinking sounds:
- ✅ "Hmm..." (pure stalling)
- ✅ "Uh..." (raw thinking sound)
- ✅ "Mm..." (minimal continuation)
- ❌ "Let me see..." (implies action - could repeat)
- ❌ "Ok..." (could conflict with response starting with "Ok")
- ❌ "One moment..." (too wordy, sets up expectation)

Bridge phrases are just buying 300-500ms more time - they should be the absolute minimum sound a human would make while thinking.

### 3. Avoid Action-Implying Words

**Problematic Patterns** (create expectation mismatches):
- ❌ "Let me check..." → implies investigation
- ❌ "I'll help..." → implies assistance
- ❌ "Let's look..." → implies looking together
- ❌ "I can..." → implies capability statement

**Why They Fail**:
Reasoning LLM might immediately ask a question, provide info, or refuse - not matching the filler's implied action.

**Better Alternatives**:
- ✅ "Hmm, ok..." → pure thinking, no direction
- ✅ "Right, so..." → pure transition, open-ended
- ✅ "Ah..." → pure acknowledgment, neutral

### 4. Use Punctuation Strategically

**Commas create natural pauses**:
- "Hmm, ok..." (slight pause after thinking)
- "Right, so..." (pause before transition)

**Ellipses extend duration**:
- "Hmm..." (trailing off, thinking)
- "Let me see..." (pause to consider)

**TTS Impact**:
- Each comma adds ~100-150ms pause
- Ellipsis adds ~200-300ms trailing pause
- Use to fine-tune audio duration without adding words

### 5. Intent-Based Templates Need Variety

**Current Issue**: Single template per intent leads to:
- Repetitive fillers across similar conversations
- Predictable patterns that feel robotic

**Solution**: Multiple templates per intent with rotation:
```yaml
QUESTION:
  - "Hmm, ok..."
  - "Right, so..."
  - "Ah, well..."
```

### 6. Coherence Scoring Insights

**Score 5/5**: "Perfectly natural, sounds like one continuous sentence"
- Achieved with: "Hmm..." → "let me help you troubleshoot"
- Pure thinking → any response direction

**Score 4/5**: "Natural, minor awkwardness"
- Achieved with: "Ok, so..." → "here's what to check"
- Transition word → still works but slight seam

**Score 3/5**: "Acceptable but noticeable seam"
- Caused by: "Let me check..." → "the most common culprits are"
- Action implication conflicts with immediate explanation

**Score 1-2/5**: "Awkward or contradictory"
- Caused by: "I'll help you with that" → "unfortunately, that's not possible"
- Direct contradiction of stated intent

## Bridge Phrase Examples

**BAD - Creates repetition or awkwardness**:
```
User: "Can you help me?"
Primary: "Hmm, alright..."
Bridge: "Let me see..." [TRIGGERED]
Response: "let me walk you through it."
Full: "Hmm, alright... Let me see... let me walk you through it."
         ❌ Repetitive "let me"

Primary: "Ok, so..."
Bridge: "Right..." [TRIGGERED]
Response: "right, here's what to do."
Full: "Ok, so... Right... right, here's what to do."
         ❌ Repetitive "right"
```

**GOOD - Pure thinking sounds**:
```
User: "Can you help me?"
Primary: "Hmm, alright..."
Bridge: "Uh..." [TRIGGERED]
Response: "let me walk you through it."
Full: "Hmm, alright... Uh... let me walk you through it."
         ✅ Natural thinking → response

Primary: "Ok, so..."
Bridge: "Mm..." [TRIGGERED]
Response: "here's what you need to do."
Full: "Ok, so... Mm... here's what you need to do."
         ✅ Smooth transition
```

## Recommended Prompt Updates

### Dynamic Strategy
```
PRIMARY (2-4 words): Pure thinking sounds
- "Hmm, ok..."
- "Right, so..."
- "Ah, well..."

BRIDGE (1-2 words): Minimal continuation
- "So..."
- "Well..."
- "Uh..."

FORBIDDEN WORDS: let, help, check, look, can, will, I'll
```

### Intent-Conditioned Strategy
```yaml
QUESTION:
  primary: ["Hmm, ok...", "Right, so...", "Ah..."]
  bridge: ["So...", "Well..."]

COMPLAINT:
  primary: ["Right, hmm...", "Ok...", "Ah..."]
  bridge: ["Well...", "So..."]
```

## Testing Checklist

When evaluating new filler phrases:

**Primary Phrase**:
- [ ] Contains NO action words (let, help, check, look, can, will)
- [ ] 2-4 words maximum
- [ ] Works before ANY response type (yes/no/question/refusal)
- [ ] Sounds like natural human thinking/acknowledgment
- [ ] Uses commas/ellipses for natural pauses
- [ ] Doesn't set up expectations about response content
- [ ] Would work in real conversation without sounding robotic

**Bridge Phrase**:
- [ ] ONLY pure thinking sounds (Hmm, Uh, Mm, Ah)
- [ ] NO words that could appear in response (no "let me", "ok", "right")
- [ ] 1-2 words maximum (prefer 1)
- [ ] Test by saying: PRIMARY + BRIDGE + typical response - does it sound repetitive or awkward?
- [ ] Should be barely noticeable - just a continuation of thinking

## Metrics to Track

1. **Coherence Score**: Target ≥4.0/5 average
2. **Bridge Trigger Rate**: Target ≤5%
3. **Perceived Latency**: Target ≤400ms
4. **Filler Variety**: Target 80%+ unique phrases per conversation
5. **Audio Duration**: Primary 800-1200ms, Bridge 300-500ms

## Future Improvements

1. **Adaptive Duration**: Adjust filler length based on historical reasoning LLM TTFT
2. **Context-Aware**: Use conversation history to predict likely response type
3. **Prosody Markers**: Add SSML for natural speech cadence
4. **Multi-Language**: Equivalent natural fillers in other languages
5. **Personality Variation**: Different filler styles for different assistant personas
