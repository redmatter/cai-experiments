#!/usr/bin/env bun
/**
 * View conversations from test results CSV
 */

interface TurnData {
  turn_number: number;
  filler_strategy: string;
  user_utterance: string;
  detected_intent: string;
  filler_phrase: string;
  bridge_filler_phrase: string;
  fast_llm_latency_ms: number;
  reasoning_llm_ttft_ms: number;
  bridge_filler_triggered: boolean;
  coherence_score: number;
  response_text: string;
  total_perceived_latency_ms: number;
}

interface ConversationGroup {
  conversation_id: string;
  turns: Map<number, TurnData[]>; // turn_number -> strategies
}

async function viewConversations(csvPath: string) {
  const file = Bun.file(csvPath);
  const content = await file.text();
  const lines = content.split('\n').filter(l => l.trim().length > 0);

  if (lines.length < 2) {
    console.log('❌ No data in CSV');
    return;
  }

  // Parse header
  const headers = lines[0].split(',');

  // Group by conversation
  const conversations = new Map<string, ConversationGroup>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = parseCSVLine(line);

    if (values.length < headers.length) continue;

    const row: any = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx];
    });

    const convId = row.conversation_id;
    const turnNum = parseInt(row.turn_number);

    if (!conversations.has(convId)) {
      conversations.set(convId, {
        conversation_id: convId,
        turns: new Map(),
      });
    }

    const conv = conversations.get(convId)!;
    if (!conv.turns.has(turnNum)) {
      conv.turns.set(turnNum, []);
    }

    conv.turns.get(turnNum)!.push({
      turn_number: turnNum,
      filler_strategy: row.filler_strategy,
      user_utterance: row.user_utterance?.replace(/^"|"$/g, ''),
      detected_intent: row.detected_intent,
      filler_phrase: row.filler_phrase,
      bridge_filler_phrase: row.bridge_filler_phrase,
      fast_llm_latency_ms: parseFloat(row.fast_llm_latency_ms) || 0,
      reasoning_llm_ttft_ms: parseFloat(row.reasoning_llm_ttft_ms) || 0,
      bridge_filler_triggered: row.bridge_filler_triggered === 'true',
      coherence_score: parseInt(row.coherence_score) || -1,
      response_text: row.response_text?.replace(/^"|"$/g, ''),
      total_perceived_latency_ms: parseFloat(row.total_perceived_latency_ms) || 0,
    });
  }

  // Print conversations
  console.log('\n' + '═'.repeat(100));
  console.log('                            CONVERSATION FLOWS');
  console.log('═'.repeat(100) + '\n');

  for (const [convId, conv] of conversations) {
    console.log(`\n┌─ Conversation: ${convId} ${'─'.repeat(Math.max(0, 75 - convId.length))}`);

    const sortedTurns = Array.from(conv.turns.entries()).sort((a, b) => a[0] - b[0]);

    for (const [turnNum, strategies] of sortedTurns) {
      const firstStrategy = strategies[0];

      console.log(`│`);
      console.log(`│ 👤 Turn ${turnNum}: "${truncate(firstStrategy.user_utterance, 80)}"`);
      console.log(`│`);

      for (const strat of strategies) {
        const stratLabel = strat.filler_strategy === 'none' ? 'BASELINE (no filler)' : strat.filler_strategy.toUpperCase();
        console.log(`│   ┌─ ${stratLabel} ${'─'.repeat(Math.max(0, 70 - stratLabel.length))}`);

        if (strat.filler_strategy !== 'none') {
          // Show filler generation
          console.log(`│   │ 🤖 Filler: "${strat.filler_phrase}" ${strat.bridge_filler_triggered ? `+ "${strat.bridge_filler_phrase}"` : ''}`);
          if (strat.detected_intent) {
            console.log(`│   │ 🏷️  Intent: ${strat.detected_intent}`);
          }
          console.log(`│   │ ⚡ Fast LLM: ${strat.fast_llm_latency_ms}ms`);
          console.log(`│   │`);
        }

        // Show response
        console.log(`│   │ 💬 Response: "${truncate(strat.response_text, 75)}"`);
        console.log(`│   │`);

        // Show metrics
        console.log(`│   │ 📊 Metrics:`);
        console.log(`│   │    ⏱️  Perceived Latency: ${strat.total_perceived_latency_ms}ms`);
        console.log(`│   │    🎯 Reasoning TTFT: ${strat.reasoning_llm_ttft_ms}ms`);
        if (strat.coherence_score >= 0) {
          console.log(`│   │    💯 Coherence: ${strat.coherence_score}/5`);
        }
        if (strat.bridge_filler_triggered) {
          console.log(`│   │    🌉 Bridge Filler: YES`);
        }
        console.log(`│   └${'─'.repeat(78)}`);
      }
    }

    console.log(`└${'─'.repeat(90)}`);
  }

  console.log('\n' + '═'.repeat(100));

  // Summary statistics
  const allData = Array.from(conversations.values())
    .flatMap(c => Array.from(c.turns.values()))
    .flat();

  const dynamicData = allData.filter(d => d.filler_strategy === 'dynamic');
  const intentData = allData.filter(d => d.filler_strategy === 'intent_conditioned');
  const baselineData = allData.filter(d => d.filler_strategy === 'none');

  console.log('\n📈 SUMMARY STATISTICS\n');

  if (dynamicData.length > 0) {
    printStrategyStats('Dynamic Filler', dynamicData);
  }
  if (intentData.length > 0) {
    printStrategyStats('Intent-Conditioned', intentData);
  }
  if (baselineData.length > 0) {
    printStrategyStats('Baseline (No Filler)', baselineData);
  }

  console.log('═'.repeat(100) + '\n');
}

function printStrategyStats(label: string, data: TurnData[]) {
  const avgPerceived = avg(data.map(d => d.total_perceived_latency_ms));
  const avgTTFT = avg(data.map(d => d.reasoning_llm_ttft_ms));
  const avgFastLLM = avg(data.filter(d => d.fast_llm_latency_ms > 0).map(d => d.fast_llm_latency_ms));
  const avgCoherence = avg(data.filter(d => d.coherence_score > 0).map(d => d.coherence_score));
  const bridgeRate = data.filter(d => d.bridge_filler_triggered).length / data.length * 100;

  console.log(`  ${label}:`);
  console.log(`    Turns: ${data.length}`);
  console.log(`    Avg Perceived Latency: ${avgPerceived.toFixed(0)}ms`);
  console.log(`    Avg Reasoning TTFT: ${avgTTFT.toFixed(0)}ms`);
  if (avgFastLLM > 0) {
    console.log(`    Avg Fast LLM: ${avgFastLLM.toFixed(0)}ms`);
  }
  if (avgCoherence > 0) {
    console.log(`    Avg Coherence: ${avgCoherence.toFixed(1)}/5`);
  }
  if (bridgeRate > 0) {
    console.log(`    Bridge Filler Rate: ${bridgeRate.toFixed(1)}%`);
  }
  console.log('');
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function truncate(text: string, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

// Main
const csvPath = process.argv[2];

if (!csvPath) {
  console.log(`
Usage: bun run view-conversations.ts <csv-file>

Examples:
  bun run view-conversations.ts tools/cai-filler-test-rig/results/test_small.csv
  bun run view-conversations.ts tools/cai-filler-test-rig/results/test_complex.csv
`);
  process.exit(1);
}

viewConversations(csvPath).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
