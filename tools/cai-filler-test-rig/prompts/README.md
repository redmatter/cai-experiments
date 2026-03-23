# Filler Prompt Configuration

This directory contains configurable prompts for the CAI Filler Test Rig.

## Files

### `filler-dynamic.txt`
Prompt for **dynamic filler generation** (Strategy A).

The fast LLM generates custom primary + bridge phrases for each utterance.

**Variables:**
- `{{USER_UTTERANCE}}` - The user's message

**Controls:**
- Word counts (PRIMARY: 4-6, BRIDGE: 2-3)
- Tone (non-committal, neutral)
- Output format

**Example output:**
```
PRIMARY: Let me look into that.
BRIDGE: Just a moment.
```

### `intent-classification.txt`
Prompt for **intent classification** (Strategy B - step 1).

Classifies user utterance into one of 6 categories.

**Variables:**
- `{{USER_UTTERANCE}}` - The user's message

**Categories:**
- QUESTION
- REQUEST
- COMPLAINT
- CLARIFICATION
- GREETING
- OTHER

**Example output:**
```
COMPLAINT
```

### `intent-templates.yaml`
Pre-defined filler templates for each intent (Strategy B - step 2).

After classification, the appropriate template is selected.

**Format:**
```yaml
INTENT_NAME:
  primary: "4-6 word phrase"
  bridge: "2-3 words"
```

## Customization Tips

### Optimizing for Speed
- **Reduce word counts**: Change PRIMARY to 3-4 words
- **Simplify dynamic prompt**: Remove detailed instructions
- **Reduce temperature**: Lower temp = faster generation

### Improving Quality
- **Add examples**: Show desired output format in prompts
- **Add constraints**: Specify tone, style, language level
- **Add context**: Include system role or domain info

### Language/Domain Adaptation
- **German language**: Translate all prompts and templates
- **Technical domain**: Add technical terminology guidance
- **Casual tone**: Adjust template phrases for informality

## Testing Changes

After modifying prompts, run a small test:

```bash
bun run tools/cai-filler-test-rig/index.ts \
  --config tools/cai-filler-test-rig/config/test-small.yaml
```

Then compare results:

```bash
bun run tools/cai-filler-test-rig/view-conversations.ts \
  tools/cai-filler-test-rig/results/test_small.csv
```
