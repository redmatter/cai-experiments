#!/usr/bin/env bun
import { join } from 'path';
import { BedrockClient } from '../../lib/bedrock-client';
import { AnthropicClient } from '../../lib/anthropic-client';
import { loadScenarios } from '../../lib/scenario-loader';
import { writeJsonToCsv, createTimestampedFileName } from '../../lib/csv-writer';

const SCENARIOS_DIR = join(import.meta.dir, 'scenarios');
const RESULTS_DIR = join(import.meta.dir, 'results');
const CONFIG_FILE = join(SCENARIOS_DIR, process.env.SCENARIO_FILE || 'scenario.json');

// Ensure results directory exists
await Bun.write(join(RESULTS_DIR, '.gitkeep'), '');

interface ClientInstance {
  type: 'bedrock' | 'anthropic';
  client: BedrockClient | AnthropicClient;
}

async function main() {
  console.log('🚀 Starting AI Latency Tester\n');

  // Load scenarios
  const scenarios = await loadScenarios(CONFIG_FILE, SCENARIOS_DIR);
  console.log(`\n✅ Loaded ${scenarios.length} test scenarios\n`);

  // Initialize clients for each unique provider/model/region combo
  const clientMap = new Map<string, ClientInstance>();

  for (const scenario of scenarios) {
    const key = `${scenario.provider}|${scenario.model}|${scenario.region || 'n/a'}`;

    if (!clientMap.has(key)) {
      console.log(`🔧 Initializing ${scenario.provider} client: ${scenario.model}`);

      if (scenario.provider === 'bedrock') {
        const client = new BedrockClient(scenario.model, scenario.region);
        await client.initialize();
        clientMap.set(key, { type: 'bedrock', client });
      } else if (scenario.provider === 'anthropic') {
        const client = new AnthropicClient(scenario.model);
        await client.initialize();
        clientMap.set(key, { type: 'anthropic', client });
      }
    }
  }

  console.log(`\n✅ Initialized ${clientMap.size} client(s)\n`);

  // Create output file
  const outputFile = join(RESULTS_DIR, 'latency.csv');
  console.log(`📝 Results will be written to: ${outputFile}\n`);

  // Run tests
  const iterations = parseInt(process.env.ITERATIONS || '10');
  const delayMs = parseInt(process.env.DELAY_MS || '30000');

  console.log(`🔄 Running ${iterations} iteration(s) with ${delayMs}ms delay between runs\n`);
  console.log('=' .repeat(80));

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n📊 Iteration ${i}/${iterations}`);
    console.log('-'.repeat(80));

    for (const scenario of scenarios) {
      const key = `${scenario.provider}|${scenario.model}|${scenario.region || 'n/a'}`;
      const clientInstance = clientMap.get(key);

      if (!clientInstance) {
        console.error(`❌ No client found for: ${key}`);
        continue;
      }

      console.log(`\n🧪 Testing: ${scenario.name}`);

      try {
        const response = await clientInstance.client.sendMessage(
          scenario.systemPrompt,
          scenario.messages,
          {
            temperature: scenario.temperature,
            maxTokens: scenario.maxTokens,
            optimisedLatency: scenario.optimisedLatency,
            withCache: scenario.withCache,
            testName: scenario.name,
          }
        );

        const { metrics } = response;

        console.log(`   ⏱️  Latency: ${metrics.latency}ms`);
        if (metrics.serverSideLatency) {
          console.log(`   🖥️  Server-side: ${metrics.serverSideLatency}ms`);
        }
        if (metrics.networkOverhead) {
          console.log(`   🌐 Network overhead: ${metrics.networkOverhead}ms`);
        }
        console.log(`   🎯 TTFT: ${metrics.timeToFirstToken}ms${metrics.adjustedTTFT ? ` (adjusted: ${metrics.adjustedTTFT}ms)` : ''}`);
        console.log(`   📝 TTFS: ${metrics.timeToFirstSentence}ms${metrics.adjustedTTFS ? ` (adjusted: ${metrics.adjustedTTFS}ms)` : ''}${metrics.hasThinkingTag ? ' (after thinking)' : ''}`);
        if (metrics.hasThinkingTag && metrics.thinkingTagDelay) {
          console.log(`   🧠 Thinking: ${metrics.thinkingTagDelay}ms`);
        }
        console.log(`   🔢 Tokens: ${metrics.inputTokens} in / ${metrics.outputTokens} out`);

        if (metrics.cacheReadInputTokens && metrics.cacheReadInputTokens > 0) {
          console.log(`   💾 Cache: Read ${metrics.cacheReadInputTokens} tokens`);
        }

        // Write to CSV
        await writeJsonToCsv(metrics, outputFile);
      } catch (error) {
        console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Sleep between iterations (except on the last one)
    if (i < iterations) {
      console.log(`\n⏳ Waiting ${delayMs}ms before next iteration...`);
      await Bun.sleep(delayMs);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Latency testing complete!');
  console.log(`📄 Results saved to: ${outputFile}`);
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});