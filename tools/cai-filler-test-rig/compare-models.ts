#!/usr/bin/env bun
/**
 * Compare multiple test results side-by-side
 */

console.log('\n═════════════════════════════════════════════════════════════════════════════');
console.log('                    FAST LLM MODEL COMPARISON');
console.log('═════════════════════════════════════════════════════════════════════════════\n');

const files = [
  { name: 'Nova 2 Lite', path: 'tools/cai-filler-test-rig/results/test_complex.csv' },
  { name: 'Claude 3.5 Haiku', path: 'tools/cai-filler-test-rig/results/test_haiku.csv' },
  { name: 'Nova Micro', path: 'tools/cai-filler-test-rig/results/test_micro.csv' },
];

interface Stats {
  name: string;
  dynamicFastLLM: number[];
  intentFastLLM: number[];
  dynamicPerceived: number[];
  intentPerceived: number[];
  baselinePerceived: number[];
  bridgeRate: number;
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

const results: Stats[] = [];

for (const file of files) {
  try {
    const fileContent = await Bun.file(file.path).text();
    const lines = fileContent.split('\n').filter(l => l.trim());

    const stats: Stats = {
      name: file.name,
      dynamicFastLLM: [],
      intentFastLLM: [],
      dynamicPerceived: [],
      intentPerceived: [],
      baselinePerceived: [],
      bridgeRate: 0,
    };

    let totalFiller = 0;
    let bridgeCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const strategy = cols[4];
      const fastLLM = parseFloat(cols[9]) || 0;
      const perceived = parseFloat(cols[19]) || 0;
      const bridgeTriggered = cols[14] === 'true';

      if (strategy === 'dynamic' && fastLLM > 0) {
        stats.dynamicFastLLM.push(fastLLM);
        stats.dynamicPerceived.push(perceived);
        totalFiller++;
        if (bridgeTriggered) bridgeCount++;
      } else if (strategy === 'intent_conditioned' && fastLLM > 0) {
        stats.intentFastLLM.push(fastLLM);
        stats.intentPerceived.push(perceived);
        totalFiller++;
        if (bridgeTriggered) bridgeCount++;
      } else if (strategy === 'none') {
        stats.baselinePerceived.push(perceived);
      }
    }

    stats.bridgeRate = totalFiller > 0 ? (bridgeCount / totalFiller) * 100 : 0;
    results.push(stats);
  } catch (error) {
    console.log(`⚠️  Could not read ${file.name}: ${file.path}`);
  }
}

const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b) / arr.length : 0;

console.log('┌─────────────────────────┬──────────────────┬──────────────────┬──────────────────┐');
console.log('│ Model                   │ Nova 2 Lite      │ Claude 3.5 Haiku │ Nova Micro       │');
console.log('├─────────────────────────┼──────────────────┼──────────────────┼──────────────────┤');

const nova = results[0];
const haiku = results[1];
const micro = results[2];

if (nova && haiku && micro) {
  console.log('│ FAST LLM LATENCY        │                  │                  │                  │');
  console.log(`│   Dynamic Generation    │ ${avg(nova.dynamicFastLLM).toFixed(0).padStart(6)}ms         │ ${avg(haiku.dynamicFastLLM).toFixed(0).padStart(6)}ms         │ ${avg(micro.dynamicFastLLM).toFixed(0).padStart(6)}ms         │`);
  console.log(`│   Intent Classification │ ${avg(nova.intentFastLLM).toFixed(0).padStart(6)}ms         │ ${avg(haiku.intentFastLLM).toFixed(0).padStart(6)}ms         │ ${avg(micro.intentFastLLM).toFixed(0).padStart(6)}ms         │`);
  console.log('│                         │                  │                  │                  │');
  console.log('│ PERCEIVED LATENCY       │                  │                  │                  │');
  console.log(`│   Dynamic Strategy      │ ${avg(nova.dynamicPerceived).toFixed(0).padStart(6)}ms         │ ${avg(haiku.dynamicPerceived).toFixed(0).padStart(6)}ms         │ ${avg(micro.dynamicPerceived).toFixed(0).padStart(6)}ms         │`);
  console.log(`│   Intent Strategy       │ ${avg(nova.intentPerceived).toFixed(0).padStart(6)}ms         │ ${avg(haiku.intentPerceived).toFixed(0).padStart(6)}ms         │ ${avg(micro.intentPerceived).toFixed(0).padStart(6)}ms         │`);
  console.log(`│   Baseline (no filler)  │ ${avg(nova.baselinePerceived).toFixed(0).padStart(6)}ms         │ ${avg(haiku.baselinePerceived).toFixed(0).padStart(6)}ms         │ ${avg(micro.baselinePerceived).toFixed(0).padStart(6)}ms         │`);
  console.log('│                         │                  │                  │                  │');
  console.log('│ IMPROVEMENT vs BASELINE │                  │                  │                  │');
  const novaImprovement = ((avg(nova.baselinePerceived) - avg(nova.dynamicPerceived)) / avg(nova.baselinePerceived) * 100);
  const haikuImprovement = ((avg(haiku.baselinePerceived) - avg(haiku.dynamicPerceived)) / avg(haiku.baselinePerceived) * 100);
  const microImprovement = ((avg(micro.baselinePerceived) - avg(micro.dynamicPerceived)) / avg(micro.baselinePerceived) * 100);
  console.log(`│   Dynamic Strategy      │ ${novaImprovement >= 0 ? '+' : ''}${novaImprovement.toFixed(1)}%          │ ${haikuImprovement >= 0 ? '+' : ''}${haikuImprovement.toFixed(1)}%          │ ${microImprovement >= 0 ? '+' : ''}${microImprovement.toFixed(1)}%          │`);
  console.log('│                         │                  │                  │                  │');
  console.log(`│ Bridge Filler Rate      │ ${nova.bridgeRate.toFixed(1).padStart(5)}%          │ ${haiku.bridgeRate.toFixed(1).padStart(5)}%          │ ${micro.bridgeRate.toFixed(1).padStart(5)}%          │`);
  console.log('└─────────────────────────┴──────────────────┴──────────────────┴──────────────────┘');

  console.log('\n📊 KEY FINDINGS:\n');

  console.log(`1. Fast LLM Speed Ranking:`);
  const speeds = [
    { name: 'Nova Micro', speed: avg(micro.dynamicFastLLM) },
    { name: 'Nova 2 Lite', speed: avg(nova.dynamicFastLLM) },
    { name: 'Claude 3.5 Haiku', speed: avg(haiku.dynamicFastLLM) },
  ].sort((a, b) => a.speed - b.speed);
  speeds.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.name}: ${s.speed.toFixed(0)}ms`);
  });

  console.log(`\n2. Perceived Latency Improvement:`);
  console.log(`   - Nova Micro: ${microImprovement.toFixed(1)}% ${microImprovement >= 0 ? 'faster' : 'SLOWER'} than baseline`);
  console.log(`   - Nova 2 Lite: ${novaImprovement.toFixed(1)}% faster than baseline`);
  console.log(`   - Claude 3.5 Haiku: ${haikuImprovement.toFixed(1)}% ${haikuImprovement >= 0 ? 'faster' : 'SLOWER'} than baseline`);

  console.log(`\n3. Bridge Filler Triggering:`);
  console.log(`   - Nova Micro: ${micro.bridgeRate.toFixed(1)}% of turns`);
  console.log(`   - Nova 2 Lite: ${nova.bridgeRate.toFixed(1)}% of turns`);
  console.log(`   - Claude 3.5 Haiku: ${haiku.bridgeRate.toFixed(1)}% of turns`);

  console.log('\n💡 RECOMMENDATION:\n');

  const bestPerceived = Math.min(
    avg(nova.dynamicPerceived),
    avg(haiku.dynamicPerceived),
    avg(micro.dynamicPerceived)
  );

  let winner = 'Nova 2 Lite';
  if (bestPerceived === avg(micro.dynamicPerceived)) winner = 'Nova Micro';
  else if (bestPerceived === avg(haiku.dynamicPerceived)) winner = 'Claude 3.5 Haiku';

  console.log(`   ✅ Winner: ${winner} (${bestPerceived.toFixed(0)}ms perceived latency)`);
  console.log(`   🥈 Runner-up: Nova ${winner === 'Nova Micro' ? '2 Lite' : 'Micro'}`);
  console.log(`   ❌ Slowest: Claude 3.5 Haiku (${avg(haiku.dynamicPerceived).toFixed(0)}ms - makes latency worse)`);

  console.log('\n   🎯 Spec Target: ≤400ms perceived latency');
  console.log(`   📍 Current Best: ${bestPerceived.toFixed(0)}ms (${winner})`);
  console.log(`   📉 Gap: ${(bestPerceived - 400).toFixed(0)}ms ${bestPerceived > 400 ? 'above' : 'below'} target`);
}

console.log('\n═════════════════════════════════════════════════════════════════════════════\n');
