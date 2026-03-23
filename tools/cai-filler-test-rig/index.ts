#!/usr/bin/env bun
import { join } from 'path';
import { loadConfig, printConfig, ConfigValidationError } from './src/config-loader';

interface CliArgs {
  config: string[];
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    config: [],
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--config') {
      // Collect all config files until next flag or end
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        result.config.push(args[i]);
        i++;
      }
      i--; // Back up one since the loop will increment
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (!arg.startsWith('--')) {
      // Treat as config file if no flag specified
      result.config.push(arg);
    } else {
      console.error(`Unknown flag: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  return result;
}

function printUsage() {
  console.log(`
Usage: bun run filler-test [options]

Options:
  --config <file> [<file>...]  Config file(s) to run (YAML)
  --dry-run                    Generate conversations only, no LLM reasoning calls

Examples:
  bun run filler-test --config config/example.yaml
  bun run filler-test --config config/run_001.yaml config/run_002.yaml
  bun run filler-test --config config/example.yaml --dry-run
`);
}

async function main() {
  console.log('🧪 CAI Filler Test Rig\n');

  const args = parseArgs();

  if (args.config.length === 0) {
    console.error('❌ Error: No config file specified\n');
    printUsage();
    process.exit(1);
  }

  if (args.dryRun) {
    console.log('🔍 Dry-run mode: Will generate conversations only\n');
  }

  // Process each config file
  for (const configPath of args.config) {
    try {
      console.log(`\n📋 Loading config: ${configPath}\n`);
      const config = await loadConfig(configPath);
      printConfig(config);

      // Execute test run
      const { TestExecutor } = await import('./src/test-executor');
      const executor = new TestExecutor(config);
      await executor.initialize();

      if (args.dryRun) {
        await executor.executeDryRun();
      } else {
        await executor.executeFullRun();
      }
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        console.error(`\n❌ Config validation failed: ${error.message}\n`);
        process.exit(1);
      }
      console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }

  console.log('✅ All configs processed\n');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
