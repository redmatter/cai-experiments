#!/usr/bin/env bun
/**
 * Show the actual conversation - user utterances and full assistant responses
 */

const csvPath = process.argv[2] || 'tools/cai-filler-test-rig/results/test_small.csv';

const content = await Bun.file(csvPath).text();
const lines = content.split('\n').filter(l => l.trim());

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

console.log('\n═══════════════════════════════════════════════════════════════════════════');
console.log('                         ACTUAL CONVERSATION');
console.log('═══════════════════════════════════════════════════════════════════════════\n');

interface Turn {
  turnNum: number;
  user: string;
  strategies: {
    strategy: string;
    filler?: string;
    bridge?: string;
    response: string;
    latency: number;
  }[];
}

const turns = new Map<number, Turn>();

for (let i = 1; i < lines.length; i++) {
  const cols = parseCSVLine(lines[i]);
  if (cols.length < 19) continue;

  const turnNum = parseInt(cols[2]);
  const strategy = cols[4];
  const userUtterance = (cols[5] || '').replace(/^"|"$/g, '');
  const filler = (cols[7] || '').replace(/^"|"$/g, '');
  const bridge = (cols[8] || '').replace(/^"|"$/g, '');
  const responseText = (cols[18] || '').replace(/^"|"$/g, '');
  const latency = parseInt(cols[19]) || 0;

  if (!turns.has(turnNum)) {
    turns.set(turnNum, {
      turnNum,
      user: userUtterance,
      strategies: [],
    });
  }

  turns.get(turnNum)!.strategies.push({
    strategy,
    filler: filler || undefined,
    bridge: bridge || undefined,
    response: responseText,
    latency,
  });
}

const sortedTurns = Array.from(turns.values()).sort((a, b) => a.turnNum - b.turnNum);

sortedTurns.forEach((turn) => {
  console.log(`\n━━━ TURN ${turn.turnNum} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`👤 USER: "${turn.user}"\n`);

  turn.strategies.forEach((strat) => {
    const stratLabel = strat.strategy === 'dynamic' ? '🎲 DYNAMIC' :
                       strat.strategy === 'intent_conditioned' ? '🏷️  INTENT' :
                       '📊 BASELINE';

    console.log(`${stratLabel}:`);

    if (strat.filler) {
      console.log(`  🤖 Filler spoken: "${strat.filler}"`);
      if (strat.bridge) {
        console.log(`              (+ "${strat.bridge}" if needed)`);
      }
      console.log(`  ⏱️  User hears something at: ${strat.latency}ms`);
      console.log(``);
    }

    console.log(`  💬 Assistant responds: "${strat.response}"`);
    if (!strat.filler) {
      console.log(`  ⏱️  User hears response at: ${strat.latency}ms`);
    }
    console.log(``);
  });
});

console.log('═══════════════════════════════════════════════════════════════════════════\n');

// Show user experience comparison
console.log('📊 USER EXPERIENCE COMPARISON (Perceived Latency)\n');
const avgDynamic = sortedTurns.flatMap(t => t.strategies.filter(s => s.strategy === 'dynamic').map(s => s.latency));
const avgIntent = sortedTurns.flatMap(t => t.strategies.filter(s => s.strategy === 'intent_conditioned').map(s => s.latency));
const avgBaseline = sortedTurns.flatMap(t => t.strategies.filter(s => s.strategy === 'none').map(s => s.latency));

const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b) / arr.length) : 0;

console.log(`  Dynamic Strategy:          ${avg(avgDynamic)}ms average wait`);
console.log(`  Intent-Conditioned:        ${avg(avgIntent)}ms average wait`);
console.log(`  Baseline (no filler):      ${avg(avgBaseline)}ms average wait`);
console.log(``);
console.log(`  ✅ Improvement: ${Math.round((1 - avg(avgDynamic) / avg(avgBaseline)) * 100)}% faster with dynamic filler`);
console.log(`  ✅ Improvement: ${Math.round((1 - avg(avgIntent) / avg(avgBaseline)) * 100)}% faster with intent filler\n`);
