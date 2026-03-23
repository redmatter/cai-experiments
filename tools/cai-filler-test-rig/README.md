# CAI Filler Test Rig

Evaluates latency reduction strategies for conversational AI using **fast LLM filler patterns**.

## Problem

VoIP conversational AI has high perceived latency (~2000ms) while reasoning LLM processes responses. Users hear silence.

## Solution

Generate neutral filler phrases via fast LLM while reasoning LLM processes in parallel. User hears something immediately (~900ms) instead of waiting for full response.

## Strategies

### Dynamic (`strategy: dynamic`)
- LLM generates custom filler pair for each user utterance
- Uses conversation history to avoid repetition
- Adapts to context naturally
- Model: Amazon Nova 2 Lite

### Intent-Conditioned (`strategy: intent_conditioned`)
- Classifies user intent (QUESTION, REQUEST, COMPLAINT, etc.)
- Selects pre-defined template from bank
- Consistent, predictable phrases
- Model: Amazon Nova 2 Lite (for classification)

### Baseline (`strategy: none`)
- No filler — direct reasoning LLM response
- Control group for measuring improvement

## Architecture

```
User utterance
    ├─→ Fast LLM (generates filler)    [~700-850ms]
    │   ├─→ Primary phrase (4-6 words)
    │   └─→ Bridge phrase (2-3 words)  [triggered if reasoning not ready]
    │
    └─→ Reasoning LLM (processes response) [~2000ms TTFT]
        └─→ Extended thinking enabled
            Model: Claude Haiku 4.5
```

**Perceived latency** = Fast LLM latency + TTS synthesis (~200ms) = ~900-1050ms vs 2000ms baseline

## Configuration

Tests defined in YAML:
```yaml
# config/test-small.yaml
reasoning_model: us.anthropic.claude-haiku-4-5-20251001-v1:0
fast_model: global.amazon.nova-2-lite-v1:0
filler_strategy: both  # tests all three strategies
turns_per_conversation: 4
bridge_filler_threshold_ms: 2200
```

Prompts are external and easily modified:
- `prompts/filler-dynamic.txt` - Dynamic generation prompt with history
- `prompts/intent-templates.yaml` - Pre-defined templates by intent
- `prompts/intent-classify.txt` - Intent classification prompt

## Usage

### Run test
```bash
bun run filler-test --config config/test-small.yaml
```

### Analyze results
```bash
# Comprehensive analysis with metrics
bun run tools/cai-filler-test-rig/analyze-results.ts results/test_small.csv

# View actual conversation flow
bun run tools/cai-filler-test-rig/show-conversation.ts results/test_small.csv

# Check filler variety (repetition detection)
bun run tools/cai-filler-test-rig/show-filler-variety.ts results/test_small.csv
```

## Metrics

- **Perceived Latency**: Time to first audio byte (target: ≤400ms)
- **Bridge Trigger Rate**: How often secondary phrase needed (target: ≤5%)
- **Coherence Score**: LLM-as-judge rates filler→response flow (1-5, target: ≥4)
- **Filler Variety**: Uniqueness across conversation turns (avoid repetition)

## Results Summary

From latest test run:
- **Intent-Conditioned**: 234ms perceived latency (93% improvement vs baseline)
- **Dynamic**: 489ms perceived latency (85% improvement vs baseline)
- Both strategies achieved 100% unique primary fillers (no repetition)
