# AI Utils - Claude Assistant Guide

## Repository Overview

This is a Bun-based monorepo containing multiple AI testing and utility tools. Each tool is self-contained under `tools/` and shares common libraries from `lib/`.

## Branch Strategy

- **Main branch**: `main` (this is a personal utilities repo, not a Red Matter repo)
- Current branch: `latency-tester`

## Key Technologies

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript
- **Testing**: AWS Bedrock + Anthropic API
- **Auth**: AWS SSO (profile: `sso-qa02-admin`)

## Common Libraries (`lib/`)

Shared code that can be reused across all tools:

- `types.ts` - Common TypeScript interfaces (TestScenario, Metrics, etc.)
- `csv-writer.ts` - CSV output utilities with automatic headers
- `aws-auth.ts` - AWS SSO authentication helper
- `scenario-loader.ts` - JSON scenario and template loader
- `bedrock-client.ts` - AWS Bedrock streaming client wrapper
- `anthropic-client.ts` - Direct Anthropic API client wrapper

## Tools

### Latency Tester (`tools/latency-tester/`)

Compares latency between AWS Bedrock and direct Anthropic API calls.

**Key features**:
- Tests multiple models in parallel (Bedrock + Anthropic)
- Measures TTFT, latency, token usage, cache performance
- Configurable via JSON scenarios
- Outputs to CSV for analysis

**Run command**: `~/.bun/bin/bun run latency-test`

**Configuration**:
- Scenarios: `tools/latency-tester/scenarios/scenario.json`
- Templates: `tools/latency-tester/scenarios/prompt-template-*.json`
- Results: `tools/latency-tester/results/latency.csv`

## Environment Setup

1. AWS SSO must be configured: `aws sso login --sso-session sso-main`
2. `.env` file must have `ANTHROPIC_TEST_API_KEY` set
3. Bun is installed at `~/.bun/bin/bun`

## Development Workflow

When adding new tools:
1. Create tool directory under `tools/`
2. Import shared libs from `lib/` using `import { ... } from '../../lib/...'`
3. Add npm script to `package.json`
4. Document in README.md

## Important Notes

- Use Bun, not Node.js (different module resolution)
- AWS credentials via SSO profiles (no hardcoded keys)
- All CSV output goes to `tools/<tool-name>/results/`
- Scenario configs are JSON (not TypeScript)
- Temperature, maxTokens, and cache settings are per-scenario