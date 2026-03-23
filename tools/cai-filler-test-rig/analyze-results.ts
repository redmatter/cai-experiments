#!/usr/bin/env bun
/**
 * Comprehensive analysis of CAI Filler Test results
 */

const csvPath = process.argv[2] || 'tools/cai-filler-test-rig/results/test_small.csv';

interface TurnData {
  turn: number;
  userMessage: string;
  strategy: string;
  intent: string;
  fillerPrimary: string;
  fillerBridge: string;
  assistantResponse: string;
  fastLLMLatency: number;
  reasoningLLMTTFT: number;
  perceivedLatency: number;
  fillerAudioDuration: number;
  bridgeAudioDuration: number;
  bufferGap: number;
  bridgeTriggered: boolean;
  coherenceScore: number;
  coherenceExplanation: string;
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

async function analyzeResults() {
  const content = await Bun.file(csvPath).text();
  const lines = content.split('\n').filter(l => l.trim());

  const data: TurnData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 20) continue;

    data.push({
      turn: parseInt(cols[2]) || 0,
      userMessage: (cols[5] || '').replace(/^"|"$/g, ''),
      strategy: cols[4] || '',
      intent: cols[6] || '',
      fillerPrimary: (cols[7] || '').replace(/^"|"$/g, ''),
      fillerBridge: (cols[8] || '').replace(/^"|"$/g, ''),
      assistantResponse: (cols[19] || '').replace(/^"|"$/g, ''),
      fastLLMLatency: parseFloat(cols[9]) || 0,
      reasoningLLMTTFT: parseFloat(cols[10]) || 0,
      perceivedLatency: parseFloat(cols[20]) || 0,
      fillerAudioDuration: parseFloat(cols[11]) || 0,
      bridgeAudioDuration: parseFloat(cols[12]) || 0,
      bufferGap: parseFloat(cols[13]) || 0,
      bridgeTriggered: cols[14] === 'true',
      coherenceScore: parseInt(cols[17]) || -1,
      coherenceExplanation: (cols[18] || '').replace(/^"|"$/g, ''),
    });
  }

  printDetailedAnalysis(data);
  printStrategyComparison(data);
  printMetrics(data);
}

function printDetailedAnalysis(data: TurnData[]) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                          DETAILED TURN ANALYSIS                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  // Group by turn
  const turnMap = new Map<number, TurnData[]>();
  data.forEach(d => {
    if (!turnMap.has(d.turn)) turnMap.set(d.turn, []);
    turnMap.get(d.turn)!.push(d);
  });

  const sortedTurns = Array.from(turnMap.entries()).sort((a, b) => a[0] - b[0]);

  sortedTurns.forEach(([turnNum, strategies]) => {
    const userMsg = strategies[0].userMessage;
    console.log(`━━━ TURN ${turnNum} ${'━'.repeat(73)}`);
    console.log(`\n👤 USER: "${userMsg}"\n`);

    strategies.forEach(strat => {
      const icon = strat.strategy === 'dynamic' ? '🎲' :
                   strat.strategy === 'intent_conditioned' ? '🏷️ ' :
                   strat.strategy === 'opening_sentence' ? '💬' : '📊';

      console.log(`${icon} ${strat.strategy.toUpperCase().replace('_', '-')}`);

      if (strat.strategy !== 'none') {
        console.log(`   ┌─ FILLER GENERATION ────────────────────────────────────`);
        console.log(`   │ Fast LLM Latency: ${strat.fastLLMLatency}ms`);
        if (strat.intent) {
          console.log(`   │ Detected Intent:  ${strat.intent}`);
        }
        console.log(`   │ Primary Phrase:   "${strat.fillerPrimary}"`);
        console.log(`   │ Bridge Phrase:    "${strat.fillerBridge}"`);
        console.log(`   │ Audio Duration:   ${strat.fillerAudioDuration}ms (primary)`);
        console.log(`   └───────────────────────────────────────────────────────────`);
      }

      console.log(`   ┌─ REASONING LLM ────────────────────────────────────────`);
      console.log(`   │ TTFT:             ${strat.reasoningLLMTTFT}ms`);
      console.log(`   │ Buffer Gap:       ${strat.bufferGap}ms ${strat.bufferGap < 0 ? '✅ (good)' : '⚠️  (needs bridge)'}`);
      if (strat.bridgeTriggered) {
        console.log(`   │ Bridge Triggered: YES 🌉`);
      }
      console.log(`   └───────────────────────────────────────────────────────────`);

      console.log(`   ┌─ USER EXPERIENCE ──────────────────────────────────────`);
      console.log(`   │ Perceived Latency: ${strat.perceivedLatency}ms ${strat.perceivedLatency < 1000 ? '✅' : '⚠️'}`);
      if (strat.coherenceScore >= 0) {
        const emoji = strat.coherenceScore >= 4 ? '✅' : strat.coherenceScore >= 3 ? '👍' : '⚠️';
        console.log(`   │ Coherence Score:   ${strat.coherenceScore}/5 ${emoji}`);
        if (strat.coherenceExplanation) {
          console.log(`   │ Reason: ${strat.coherenceExplanation}`);
        }
      }
      console.log(`   └───────────────────────────────────────────────────────────`);

      console.log(`   💬 Response: "${strat.assistantResponse}"\n`);
    });
  });
}

function printStrategyComparison(data: TurnData[]) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        STRATEGY COMPARISON                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  const dynamic = data.filter(d => d.strategy === 'dynamic');
  const intent = data.filter(d => d.strategy === 'intent_conditioned');
  const opening = data.filter(d => d.strategy === 'opening_sentence');
  const baseline = data.filter(d => d.strategy === 'none');

  const cols = [
    { label: 'Dynamic', data: dynamic },
    { label: 'Intent', data: intent },
    { label: 'Opening', data: opening },
    { label: 'Baseline', data: baseline },
  ].filter(c => c.data.length > 0);

  const colWidth = 15;
  const header = ['Metric'.padEnd(30), ...cols.map(c => c.label.padEnd(colWidth))].join(' ');
  const divider = ['─'.repeat(30), ...cols.map(() => '─'.repeat(colWidth))].join(' ');

  const rows = [
    header,
    divider,
    row('Sample Size', cols, c => c.data.length.toString()),
    '',
    row('TIMING (averages)', cols, () => ''),
    row('Fast LLM Latency', cols, c => c.label === 'Baseline' ? 'N/A' : `${avg(c.data.map(d => d.fastLLMLatency))}ms`),
    row('Reasoning TTFT', cols, c => `${avg(c.data.map(d => d.reasoningLLMTTFT))}ms`),
    row('Perceived Latency', cols, c => `${avg(c.data.map(d => d.perceivedLatency))}ms`),
    '',
    row('FILLER PERFORMANCE', cols, () => ''),
    row('Bridge Triggered', cols, c => c.label === 'Baseline' ? 'N/A' : `${pct(c.data, d => d.bridgeTriggered)}%`),
    row('Avg Buffer Gap', cols, c => c.label === 'Baseline' ? 'N/A' : `${avg(c.data.map(d => d.bufferGap))}ms`),
    row('Avg Coherence', cols, c => c.label === 'Baseline' ? 'N/A' : `${avgValid(c.data.map(d => d.coherenceScore))}/5`),
    '',
    row('IMPROVEMENT', cols, () => ''),
    row('vs Baseline', cols, c => c.label === 'Baseline' ? '0%' : `${improvement(c.data, baseline)}%`),
  ];

  rows.forEach(r => console.log(`  ${r}`));

  console.log('');
}

function printMetrics(data: TurnData[]) {
  console.log('\n╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           KEY METRICS                                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  const strategies = [
    { label: 'Dynamic', data: data.filter(d => d.strategy === 'dynamic') },
    { label: 'Intent', data: data.filter(d => d.strategy === 'intent_conditioned') },
    { label: 'Opening', data: data.filter(d => d.strategy === 'opening_sentence') },
  ].filter(s => s.data.length > 0);

  const baseline = data.filter(d => d.strategy === 'none');

  console.log('🎯 SUCCESS CRITERIA (from spec):\n');

  const checks = [
    { metric: 'Perceived Latency ≤400ms', target: 400, lower: false },
    { metric: 'Bridge Filler Rate ≤5%', target: 5, lower: true },
    { metric: 'Coherence Score ≥4.0', target: 4.0, lower: false },
  ];

  checks.forEach(check => {
    console.log(`  ${check.metric}`);
    strategies.forEach(strat => {
      let value: number;
      if (check.metric.includes('Latency')) {
        value = avg(strat.data.map(d => d.perceivedLatency));
      } else if (check.metric.includes('Bridge')) {
        value = pct(strat.data, d => d.bridgeTriggered);
      } else {
        value = avgValid(strat.data.map(d => d.coherenceScore));
      }
      const pass = check.lower ? value <= check.target : value >= check.target;
      console.log(`    ${strat.label.padEnd(10)} ${value.toFixed(1)} ${pass ? '✅' : '❌'}`);
    });
    console.log('');
  });

  console.log('📊 FILLER VARIETY:\n');

  strategies.forEach(strat => {
    const primaryUnique = new Set(strat.data.map(d => d.fillerPrimary)).size;
    const bridgeUnique = new Set(strat.data.map(d => d.fillerBridge)).size;
    console.log(`  ${strat.label} Strategy:`);
    console.log(`    Primary:  ${primaryUnique}/${strat.data.length} unique (${Math.round(primaryUnique/strat.data.length*100)}%)`);
    console.log(`    Bridge:   ${bridgeUnique}/${strat.data.length} unique (${Math.round(bridgeUnique/strat.data.length*100)}%)`);
    console.log('');
  });

  console.log('🏆 WINNER:\n');

  // Find strategy with best coherence (primary goal of this iteration)
  const bestCoherence = strategies.reduce((best, s) => {
    const coherence = avgValid(s.data.map(d => d.coherenceScore));
    return coherence > best.score ? { label: s.label, data: s.data, score: coherence } : best;
  }, { label: '', data: [] as TurnData[], score: 0 });

  const bestPerceived = avg(bestCoherence.data.map(d => d.perceivedLatency));
  console.log(`  ${bestCoherence.label} Strategy (best coherence: ${bestCoherence.score.toFixed(1)}/5)`);
  console.log(`    Perceived Latency: ${bestPerceived}ms`);
  console.log(`    Improvement:       ${improvement(bestCoherence.data, baseline)}% vs baseline`);
  console.log('');
}

function row(
  label: string,
  cols: { label: string; data: TurnData[] }[],
  valueFn: (col: { label: string; data: TurnData[] }) => string
): string {
  return [label.padEnd(30), ...cols.map(c => valueFn(c).padEnd(15))].join(' ');
}

function truncate(text: string, maxLen: number): string {
  if (!text) return '';
  return text.length <= maxLen ? text : text.substring(0, maxLen - 3) + '...';
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function avgValid(nums: number[]): number {
  const valid = nums.filter(n => n >= 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10;
}

function pct(arr: TurnData[], predicate: (d: TurnData) => boolean): number {
  if (arr.length === 0) return 0;
  return Math.round(arr.filter(predicate).length / arr.length * 100);
}

function improvement(strat: TurnData[], baseline: TurnData[]): number {
  const stratAvg = avg(strat.map(d => d.perceivedLatency));
  const baselineAvg = avg(baseline.map(d => d.perceivedLatency));
  if (baselineAvg === 0) return 0;
  return Math.round((1 - stratAvg / baselineAvg) * 100);
}

analyzeResults().catch(console.error);
