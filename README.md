# AI Utils

A collection of AI testing and utility tools built with Bun.

## Setup

1. Install Bun if you haven't already:
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

### Latency Tester

Tests and compares latency between AWS Bedrock and direct Anthropic API calls.

**Features:**
- Side-by-side comparison of Bedrock vs Anthropic direct API
- Configurable test scenarios via JSON
- Measures: latency, TTFT (Time To First Token), token usage
- Prompt caching support
- CSV output for analysis

**Usage:**
```bash
# Run default test suite
bun run latency-test

# Run MobileDE test profile
bun run latency-test:mobilede
```

**Test Profiles:**
- **Default**: General AI conversation tests (`scenario.json`)
- **MobileDE**: German customer service AI for mobile.de (`scenario-mobilede.json`)

**Configuration:**
- Scenarios: `tools/latency-tester/scenarios/scenario.json` (or `scenario-mobilede.json`)
- Prompt templates: `tools/latency-tester/scenarios/prompt-template-*.json`
- Results: `tools/latency-tester/results/latency.csv`

**Environment variables:**
- `ITERATIONS`: Number of test iterations (default: 10)
- `DELAY_MS`: Delay between iterations in milliseconds (default: 30000)
- `SCENARIO_FILE`: Scenario file to use (default: `scenario.json`)
- `ANTHROPIC_TEST_API_KEY`: Your Anthropic API key
- `AWS_PROFILE`: AWS SSO profile (default: sso-qa02-admin)

**Examples:**
```bash
# Run 5 iterations with 10s delay
ITERATIONS=5 DELAY_MS=10000 bun run latency-test

# Run MobileDE profile for 2 hours (360 iterations)
ITERATIONS=360 DELAY_MS=5000 bun run latency-test:mobilede

# Use custom scenario file
SCENARIO_FILE=my-custom-scenario.json bun run latency-test
```

## Project Structure

```
ai-utils/
├── lib/                      # Shared libraries
│   ├── types.ts             # Common TypeScript types
│   ├── csv-writer.ts        # CSV output utilities
│   ├── aws-auth.ts          # AWS SSO authentication
│   ├── scenario-loader.ts   # Test scenario loader
│   ├── bedrock-client.ts    # AWS Bedrock client wrapper
│   └── anthropic-client.ts  # Anthropic API client wrapper
└── tools/                    # Individual tools
    └── latency-tester/      # Latency testing tool
        ├── index.ts         # Main entry point
        ├── scenarios/       # Test configurations
        │   ├── scenario.json
        │   └── prompt-template-*.json
        └── results/         # Test output (CSV files)
```

## Adding New Tools

1. Create a new directory under `tools/`
2. Add your tool's entry point
3. Import shared libraries from `lib/`
4. Add a script to `package.json`

## License

MIT
