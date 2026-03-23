# AI Utils

A collection of AI testing and utility tools for conversational AI research, built with Bun and TypeScript. Focused on latency reduction, filler generation, and semantic stability for voice-based AI agents.

## Setup

1. Install [Bun](https://bun.sh):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. Install dependencies:
```bash
bun install
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_TEST_API_KEY
```

4. For AWS Bedrock testing, ensure you're logged into AWS SSO:
```bash
aws sso login --sso-session sso-main
```

## Tools

### Latency Tester (`tools/latency-tester/`)

Compares latency between AWS Bedrock and direct Anthropic API calls.

- Side-by-side Bedrock vs Anthropic direct API comparison
- Measures latency, TTFT (Time To First Token), token usage, cache performance
- Configurable test scenarios via JSON
- CSV output for analysis

```bash
bun run latency-test                # Default test suite
bun run latency-test:mobilede       # MobileDE (German customer service) profile
```

| Variable | Default | Description |
|---|---|---|
| `ITERATIONS` | 10 | Number of test iterations |
| `DELAY_MS` | 30000 | Delay between iterations (ms) |
| `SCENARIO_FILE` | `scenario.json` | Scenario file to use |
| `ANTHROPIC_TEST_API_KEY` | - | Anthropic API key |
| `AWS_PROFILE` | `sso-qa02-admin` | AWS SSO profile |

---

### CAI Filler Test Rig (`tools/cai-filler-test-rig/`)

Tests latency reduction strategies for conversational AI voice agents by generating contextual filler responses while the reasoning LLM processes.

- Multiple filler strategies: template, dynamic, intent-based, opening sentence
- Speech act classification for context-aware filler selection
- Coherence scoring against reasoning LLM output
- YAML-based test configuration

```bash
bun run filler-test                 # Run with default config
bun run filler-test:example         # Run example config
bun run filler-test -- --config tools/cai-filler-test-rig/config/test-speech-act.yaml
```

Key docs: [`docs/CURRENT-STATE.md`](tools/cai-filler-test-rig/docs/CURRENT-STATE.md), [`docs/TUNING-GUIDE.md`](tools/cai-filler-test-rig/docs/TUNING-GUIDE.md)

---

### Semantic Stability Tester (`tools/semantic-stability-tester/`)

Evaluates strategies for detecting whether an extended utterance has changed meaning compared to an earlier interim version. Powers the **speculative handoff pipeline** - starting LLM generation before the user finishes speaking, then verifying the meaning hasn't shifted.

Three-phase pipeline:
1. **Handoff-Point Detection** - identify when enough semantic content exists to start LLM generation
2. **Post-Handoff Monitoring** - watch for meaning shifts as the user continues speaking
3. **End-of-Turn Stability Check** - final verification before sending the response

```bash
bun run stability-test              # Run all strategies on full corpus
bun run stability-test:heuristic    # Heuristic only (fast, no model downloads)
bun run fire-point-test             # Run fire-point detection scenarios
bun run fire-point-report           # Generate HTML scenario report
bun run tools/semantic-stability-tester/fire-point-corpus-report.ts  # Full corpus HTML report
```

Key docs: [`docs/ARCHITECTURE.md`](tools/semantic-stability-tester/docs/ARCHITECTURE.md), [`results/REPORT.md`](tools/semantic-stability-tester/results/REPORT.md)

## Project Structure

```
ai-utils/
├── lib/                              # Shared libraries
│   ├── types.ts                     # Common TypeScript interfaces
│   ├── csv-writer.ts                # CSV output utilities
│   ├── aws-auth.ts                  # AWS SSO authentication
│   ├── scenario-loader.ts           # JSON scenario/template loader
│   ├── bedrock-client.ts            # AWS Bedrock streaming client
│   ├── reasoning-bedrock-client.ts  # Bedrock client for reasoning models
│   ├── nova-client.ts               # AWS Nova client
│   └── anthropic-client.ts          # Anthropic API client
└── tools/
    ├── latency-tester/              # API latency comparison
    ├── cai-filler-test-rig/         # Filler strategy testing
    └── semantic-stability-tester/   # Speculative handoff pipeline
```

## Adding New Tools

1. Create a new directory under `tools/`
2. Import shared libraries from `lib/` using relative imports
3. Add npm scripts to `package.json`
4. Put results in `tools/<tool-name>/results/` (gitignored)

## License

MIT
