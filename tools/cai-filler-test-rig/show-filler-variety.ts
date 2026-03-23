#!/usr/bin/env bun
/**
 * Show filler variety across conversation turns
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

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log('                    FILLER VARIETY ACROSS TURNS');
console.log('══════════════════════════════════════════════════════════════════════════\n');

const dynamicFillers: Array<{ turn: number; primary: string; bridge: string; user: string }> = [];
const intentFillers: Array<{ turn: number; primary: string; bridge: string; user: string; intent: string }> = [];

for (let i = 1; i < lines.length; i++) {
  const cols = parseCSVLine(lines[i]);
  if (cols.length < 9) continue; // Skip incomplete rows

  const turn = parseInt(cols[2]);
  const strategy = cols[4];
  const userUtterance = (cols[5] || '').replace(/^"|"$/g, '');
  const intent = cols[6] || '';
  const primary = (cols[7] || '').replace(/^"|"$/g, '');
  const bridge = (cols[8] || '').replace(/^"|"$/g, '');

  if (strategy === 'dynamic' && primary) {
    dynamicFillers.push({ turn, primary, bridge, user: userUtterance });
  } else if (strategy === 'intent_conditioned' && primary) {
    intentFillers.push({ turn, primary, bridge, user: userUtterance, intent });
  }
}

if (dynamicFillers.length > 0) {
  console.log('🎲 DYNAMIC STRATEGY (context-aware generation)\n');
  dynamicFillers.forEach((f, idx) => {
    console.log(`Turn ${f.turn}:`);
    console.log(`  User: "${f.user.substring(0, 60)}${f.user.length > 60 ? '...' : ''}"`);
    console.log(`  ├─ Primary: "${f.primary}"`);
    console.log(`  └─ Bridge:  "${f.bridge}"`);
    console.log('');
  });

  // Check for repetition
  const primarySet = new Set(dynamicFillers.map(f => f.primary));
  const bridgeSet = new Set(dynamicFillers.map(f => f.bridge));
  console.log(`  📊 Variety: ${primarySet.size}/${dynamicFillers.length} unique primary fillers`);
  console.log(`  📊 Variety: ${bridgeSet.size}/${dynamicFillers.length} unique bridge fillers\n`);
}

if (intentFillers.length > 0) {
  console.log('🏷️  INTENT-CONDITIONED STRATEGY (template-based)\n');
  intentFillers.forEach((f) => {
    console.log(`Turn ${f.turn}:`);
    console.log(`  User: "${f.user.substring(0, 60)}${f.user.length > 60 ? '...' : ''}"`);
    console.log(`  Intent: ${f.intent}`);
    console.log(`  ├─ Primary: "${f.primary}"`);
    console.log(`  └─ Bridge:  "${f.bridge}"`);
    console.log('');
  });

  const primarySet = new Set(intentFillers.map(f => f.primary));
  const bridgeSet = new Set(intentFillers.map(f => f.bridge));
  console.log(`  📊 Variety: ${primarySet.size}/${intentFillers.length} unique primary fillers`);
  console.log(`  📊 Variety: ${bridgeSet.size}/${intentFillers.length} unique bridge fillers\n`);
}

console.log('══════════════════════════════════════════════════════════════════════════\n');
