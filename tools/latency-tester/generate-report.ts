#!/usr/bin/env bun
import { join } from 'path';

const RESULTS_DIR = join(import.meta.dir, 'results');
const CSV_FILE = join(RESULTS_DIR, process.env.CSV_FILE || 'latency.csv');
const OUTPUT_FILE = join(RESULTS_DIR, 'report.html');

interface Row {
  timestamp: string;
  provider: string;
  model: string;
  region: string;
  testName: string;
  latency: number;
  serverSideLatency: number;
  networkOverhead: number;
  inputTokens: number;
  outputTokens: number;
  timeToFirstToken: number;
  timeToFirstSentence: number;
  timeToLastToken: number;
  timeToGenerate: number;
  adjustedTTFT: number | null;
  adjustedTTFS: number | null;
  hasThinkingTag: boolean;
  thinkingTagDelay: number | null;
  optimised: boolean;
  systemPromptLengthBytes: number;
  messagesLengthBytes: number;
  messagesCount: number;
  withCache: boolean;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  temperature: number;
  maxTokens: number;
}

function parseCSV(text: string): Row[] {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const rows: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Handle quoted fields with commas
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    const get = (name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? values[idx] : '';
    };
    const num = (name: string) => {
      const v = get(name);
      return v && v !== '' && v !== 'undefined' ? parseFloat(v) : 0;
    };
    const numOrNull = (name: string) => {
      const v = get(name);
      return v && v !== '' && v !== 'undefined' ? parseFloat(v) : null;
    };

    rows.push({
      timestamp: get('timestamp'),
      provider: get('provider'),
      model: get('model'),
      region: get('region'),
      testName: get('testName'),
      latency: num('latency'),
      serverSideLatency: num('serverSideLatency'),
      networkOverhead: num('networkOverhead'),
      inputTokens: num('inputTokens'),
      outputTokens: num('outputTokens'),
      timeToFirstToken: num('timeToFirstToken'),
      timeToFirstSentence: num('timeToFirstSentence'),
      timeToLastToken: num('timeToLastToken'),
      timeToGenerate: num('timeToGenerate'),
      adjustedTTFT: numOrNull('adjustedTTFT'),
      adjustedTTFS: numOrNull('adjustedTTFS'),
      hasThinkingTag: get('hasThinkingTag') === 'true',
      thinkingTagDelay: numOrNull('thinkingTagDelay'),
      optimised: get('optimised') === 'true',
      systemPromptLengthBytes: num('systemPromptLengthBytes'),
      messagesLengthBytes: num('messagesLengthBytes'),
      messagesCount: num('messagesCount'),
      withCache: get('withCache') === 'true',
      cacheReadInputTokens: num('cacheReadInputTokens'),
      cacheWriteInputTokens: num('cacheWriteInputTokens'),
      temperature: num('temperature'),
      maxTokens: num('maxTokens'),
    });
  }
  return rows;
}

function groupBy(rows: Row[], key: (r: Row) => string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return map;
}

function stats(values: number[]) {
  if (values.length === 0) return { avg: 0, median: 0, min: 0, max: 0, p85: 0, p90: 0, p95: 0, p99: 0, stddev: 0, n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const p85idx = Math.min(Math.floor(n * 0.85), n - 1);
  const p90idx = Math.min(Math.floor(n * 0.90), n - 1);
  const p95idx = Math.min(Math.ceil(n * 0.95) - 1, n - 1);
  const p99idx = Math.min(Math.ceil(n * 0.99) - 1, n - 1);
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (n - 1 || 1);
  return {
    avg: Math.round(avg),
    median: Math.round(median),
    min: Math.round(sorted[0]),
    max: Math.round(sorted[n - 1]),
    p85: Math.round(sorted[p85idx]),
    p90: Math.round(sorted[p90idx]),
    p95: Math.round(sorted[p95idx]),
    p99: Math.round(sorted[p99idx]),
    stddev: Math.round(Math.sqrt(variance)),
    n,
  };
}

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'N/A';
  return `${Math.round(v).toLocaleString()}ms`;
}

function generateInsights(groups: Map<string, Row[]>): string[] {
  const insights: string[] = [];
  // Use adjusted TTFT where available, raw otherwise (same as primaryTTFT logic)
  const scenarioStats = new Map<string, { primary: ReturnType<typeof stats>; raw: ReturnType<typeof stats>; hasAdj: boolean }>();

  for (const [name, rows] of groups) {
    const raw = stats(rows.map(r => r.timeToFirstToken));
    const adjVals = rows.map(r => r.adjustedTTFT).filter((v): v is number => v !== null && v < 10000);
    const hasAdj = adjVals.length > 0;
    const primary = hasAdj ? stats(adjVals) : raw;
    scenarioStats.set(name, { primary, raw, hasAdj });
  }

  // Find fastest and slowest (network-adjusted)
  const sorted = [...scenarioStats.entries()].sort((a, b) => a[1].primary.median - b[1].primary.median);
  const fastest = sorted[0];
  const slowest = sorted[sorted.length - 1];
  insights.push(`<strong>Fastest TTFT (net-adjusted P50):</strong> ${fastest[0]} at ${fmtMs(fastest[1].primary.median)} - ${((slowest[1].primary.median - fastest[1].primary.median) / slowest[1].primary.median * 100).toFixed(0)}% faster than the slowest.`);

  // Most consistent (lowest stddev)
  const mostConsistent = [...scenarioStats.entries()].sort((a, b) => a[1].primary.stddev - b[1].primary.stddev)[0];
  insights.push(`<strong>Most consistent:</strong> ${mostConsistent[0]} with ${fmtMs(mostConsistent[1].primary.stddev)} standard deviation (${fmtMs(mostConsistent[1].primary.min)} - ${fmtMs(mostConsistent[1].primary.max)} range).`);

  // Worst tail latency (highest P95)
  const worstTail = [...scenarioStats.entries()].sort((a, b) => b[1].primary.p95 - a[1].primary.p95)[0];
  insights.push(`<strong>Worst tail latency:</strong> ${worstTail[0]} with P95 of ${fmtMs(worstTail[1].primary.p95)} and max of ${fmtMs(worstTail[1].primary.max)}.`);

  // Nova vs Haiku comparison
  const novaEntries = [...scenarioStats.entries()].filter(([n]) => n.includes('Nova'));
  const haikuEntries = [...scenarioStats.entries()].filter(([n]) => n.includes('Haiku 4.5') || n.includes('Claude 4.5'));
  if (novaEntries.length > 0 && haikuEntries.length > 0) {
    const bestNova = novaEntries.sort((a, b) => a[1].primary.median - b[1].primary.median)[0];
    const bestHaiku = haikuEntries.sort((a, b) => a[1].primary.median - b[1].primary.median)[0];
    const diff = bestHaiku[1].primary.median - bestNova[1].primary.median;
    insights.push(`<strong>Nova vs Haiku:</strong> Best Nova (${bestNova[0]}, ${fmtMs(bestNova[1].primary.median)}) is ${fmtMs(diff)} faster than best Haiku 4.5 (${bestHaiku[0]}, ${fmtMs(bestHaiku[1].primary.median)}).`);
  }

  // Cache impact (use adjusted values)
  const cacheGroups = new Map<string, { cached: ReturnType<typeof stats>; uncached: ReturnType<typeof stats>; cachedName: string; uncachedName: string }>();
  for (const [name, st] of scenarioStats) {
    const baseKey = name.replace(', With Cache', '').replace(', No Cache', '').replace(' (Cache)', '').replace(' (No Cache)', '');
    if (!cacheGroups.has(baseKey)) cacheGroups.set(baseKey, {} as any);
    const group = cacheGroups.get(baseKey)!;
    if (name.includes('With Cache') || name.includes('Cache)')) {
      group.cached = st.primary;
      group.cachedName = name;
    } else if (name.includes('No Cache')) {
      group.uncached = st.primary;
      group.uncachedName = name;
    }
  }
  let cacheHelps = 0;
  let cacheHurts = 0;
  for (const [, g] of cacheGroups) {
    if (g.cached && g.uncached) {
      if (g.cached.median < g.uncached.median) cacheHelps++;
      else cacheHurts++;
    }
  }
  if (cacheHelps + cacheHurts > 0) {
    insights.push(`<strong>Prompt caching:</strong> Helped in ${cacheHelps}/${cacheHelps + cacheHurts} comparable pairs. ${cacheHurts > cacheHelps ? 'Caching is not consistently beneficial at this sample size - cold cache penalty may outweigh hits.' : 'Caching provides a consistent benefit.'}`);
  }

  // Network overhead
  const bedrockEU = [...groups.entries()].filter(([n, rows]) => rows[0].provider === 'bedrock' && rows[0].region === 'eu-west-1');
  const bedrockUS = [...groups.entries()].filter(([n, rows]) => rows[0].provider === 'bedrock' && rows[0].region?.includes('us-'));
  if (bedrockEU.length > 0 && bedrockUS.length > 0) {
    const euOH = bedrockEU.flatMap(([, rows]) => rows.map(r => r.networkOverhead)).filter(v => v > 0);
    const usOH = bedrockUS.flatMap(([, rows]) => rows.map(r => r.networkOverhead)).filter(v => v > 0);
    if (euOH.length > 0 && usOH.length > 0) {
      const euMed = stats(euOH).median;
      const usMed = stats(usOH).median;
      insights.push(`<strong>Network overhead:</strong> EU Bedrock ~${fmtMs(euMed)}, US Bedrock ~${fmtMs(usMed)}. US adds ~${fmtMs(usMed - euMed)} of transatlantic latency. For UK-based deployments, EU Bedrock saves significant network time.`);
    }
  }

  // Anthropic Direct vs Bedrock (raw TTFT since Anthropic has no adjusted)
  const anthropicEntries = [...scenarioStats.entries()].filter(([n]) => n.includes('Anthropic Direct'));
  const bedrockHaikuEntries = [...scenarioStats.entries()].filter(([n]) => n.includes('Bedrock') && (n.includes('4.5 Haiku') || n.includes('Haiku 4.5')));
  if (anthropicEntries.length > 0 && bedrockHaikuEntries.length > 0) {
    const bestAnthropic = anthropicEntries.sort((a, b) => a[1].raw.median - b[1].raw.median)[0];
    const bestBedrock = bedrockHaikuEntries.sort((a, b) => a[1].raw.median - b[1].raw.median)[0];
    if (bestAnthropic[1].raw.median > bestBedrock[1].raw.median) {
      insights.push(`<strong>Anthropic Direct vs Bedrock (raw TTFT):</strong> Bedrock (${bestBedrock[0]}, ${fmtMs(bestBedrock[1].raw.median)}) is faster than Anthropic Direct (${bestAnthropic[0]}, ${fmtMs(bestAnthropic[1].raw.median)}). Note: Anthropic Direct has no server-side metadata for adjustment.`);
    }
  }

  // TTFT vs TTFS divergence
  const ttfsStats = new Map<string, ReturnType<typeof stats>>();
  for (const [name, rows] of groups) {
    const adjVals = rows.map(r => r.adjustedTTFS).filter((v): v is number => v !== null && v < 10000);
    ttfsStats.set(name, adjVals.length > 0 ? stats(adjVals) : stats(rows.map(r => r.timeToFirstSentence)));
  }
  const bestTTFT = sorted[0];
  const bestTTFS = [...ttfsStats.entries()].sort((a, b) => a[1].median - b[1].median)[0];
  if (bestTTFT[0] !== bestTTFS[0]) {
    insights.push(`<strong>TTFT vs TTFS winners differ:</strong> Fastest TTFT is ${bestTTFT[0]} (${fmtMs(bestTTFT[1].primary.median)}), but fastest TTFS is ${bestTTFS[0]} (${fmtMs(bestTTFS[1].median)}). A fast first token doesn't always mean a fast first sentence.`);
  }

  return insights;
}

function generateHTML(rows: Row[]): string {
  const groups = groupBy(rows, r => r.testName);
  const firstTs = rows[0].timestamp;
  const lastTs = rows[rows.length - 1].timestamp;
  const iterations = Math.floor(rows.length / groups.size);
  const insights = generateInsights(groups);

  // Compute all scenario stats
  type ScenarioData = {
    name: string;
    n: number;
    ttft: ReturnType<typeof stats>;
    ttfs: ReturnType<typeof stats>;
    adjTTFT: ReturnType<typeof stats> | null;
    adjTTFS: ReturnType<typeof stats> | null;
    primaryTTFT: ReturnType<typeof stats>;
    primaryTTFS: ReturnType<typeof stats>;
    hasAdjusted: boolean;
    netOH: ReturnType<typeof stats> | null;
    serverLatency: ReturnType<typeof stats> | null;
    provider: string;
    region: string;
    inputTokens: number;
    promptBytes: number;
    withCache: boolean;
    promptGroup: string;
  };

  const scenarios: ScenarioData[] = [];
  for (const [name, data] of groups) {
    const adjTTFTVals = data.map(r => r.adjustedTTFT).filter((v): v is number => v !== null && v < 10000);
    const adjTTFSVals = data.map(r => r.adjustedTTFS).filter((v): v is number => v !== null && v < 10000);
    const netOHVals = data.map(r => r.networkOverhead).filter(v => v > 0);
    const serverVals = data.map(r => r.serverSideLatency).filter(v => v > 0);
    const rawTTFT = stats(data.map(r => r.timeToFirstToken));
    const rawTTFS = stats(data.map(r => r.timeToFirstSentence));
    const adjTTFT = adjTTFTVals.length > 0 ? stats(adjTTFTVals) : null;
    const adjTTFS = adjTTFSVals.length > 0 ? stats(adjTTFSVals) : null;
    const hasAdjusted = adjTTFT !== null;

    scenarios.push({
      name,
      n: data.length,
      ttft: rawTTFT,
      ttfs: rawTTFS,
      adjTTFT,
      adjTTFS,
      primaryTTFT: hasAdjusted ? adjTTFT! : rawTTFT,
      primaryTTFS: hasAdjusted ? adjTTFS ?? rawTTFS : rawTTFS,
      hasAdjusted,
      netOH: netOHVals.length > 0 ? stats(netOHVals) : null,
      serverLatency: serverVals.length > 0 ? stats(serverVals) : null,
      provider: data[0].provider,
      region: data[0].region,
      inputTokens: data[0].inputTokens,
      promptBytes: data[0].systemPromptLengthBytes,
      withCache: data[0].withCache,
      promptGroup: name.startsWith('MobileDE') ? 'MobileDE Triage' : 'Contacts (Original)',
    });
  }

  // Helper to color-code latency cells
  const latencyClass = (val: number, thresholds: [number, number, number]) => {
    if (val <= thresholds[0]) return 'good';
    if (val <= thresholds[1]) return 'ok';
    if (val <= thresholds[2]) return 'warn';
    return 'bad';
  };

  const nameWithMarker = (s: ScenarioData) => s.hasAdjusted ? s.name : `${s.name} *`;

  const primaryTableRow = (s: ScenarioData, rank: number, field: 'ttft' | 'ttfs') => {
    const st = field === 'ttft' ? s.primaryTTFT : s.primaryTTFS;
    const raw = field === 'ttft' ? s.ttft : s.ttfs;
    return `<tr>
      <td class="rank">${rank}</td>
      <td class="scenario">${nameWithMarker(s)}</td>
      <td>${s.n}</td>
      <td class="${latencyClass(st.avg, [1000, 1500, 2200])}">${fmtMs(st.avg)}</td>
      <td class="${latencyClass(st.median, [1000, 1500, 2200])}">${fmtMs(st.median)}</td>
      <td class="${latencyClass(st.p90, [1300, 2000, 3000])}">${fmtMs(st.p90)}</td>
      <td class="${latencyClass(st.p95, [1500, 2500, 3500])}">${fmtMs(st.p95)}</td>
      <td class="${latencyClass(st.p99, [2000, 3500, 5000])}">${fmtMs(st.p99)}</td>
      <td class="${latencyClass(st.max, [1800, 3000, 5000])}">${fmtMs(st.max)}</td>
      <td>${fmtMs(st.stddev)}</td>
      <td>${fmtMs(raw.median)}</td>
      <td>${s.netOH ? fmtMs(s.netOH.median) : 'N/A'}</td>
    </tr>`;
  };

  const rawTableRow = (s: ScenarioData, rank: number, field: 'ttft' | 'ttfs') => {
    const st = field === 'ttft' ? s.ttft : s.ttfs;
    return `<tr>
      <td class="rank">${rank}</td>
      <td class="scenario">${s.name}</td>
      <td>${s.n}</td>
      <td class="${latencyClass(st.avg, [1200, 1800, 2500])}">${fmtMs(st.avg)}</td>
      <td class="${latencyClass(st.median, [1200, 1800, 2500])}">${fmtMs(st.median)}</td>
      <td class="${latencyClass(st.p90, [1500, 2500, 3500])}">${fmtMs(st.p90)}</td>
      <td class="${latencyClass(st.p95, [1800, 3000, 4000])}">${fmtMs(st.p95)}</td>
      <td class="${latencyClass(st.p99, [2500, 4000, 6000])}">${fmtMs(st.p99)}</td>
      <td class="${latencyClass(st.max, [2000, 3500, 5000])}">${fmtMs(st.max)}</td>
      <td>${fmtMs(st.stddev)}</td>
      <td>${s.netOH ? fmtMs(s.netOH.median) : 'N/A'}</td>
    </tr>`;
  };

  const sortedByPrimaryTTFT = [...scenarios].sort((a, b) => a.primaryTTFT.p95 - b.primaryTTFT.p95);
  const sortedByPrimaryTTFS = [...scenarios].sort((a, b) => a.primaryTTFS.p95 - b.primaryTTFS.p95);
  const sortedByRawTTFT = [...scenarios].sort((a, b) => a.ttft.p95 - b.ttft.p95);
  const sortedByRawTTFS = [...scenarios].sort((a, b) => a.ttfs.p95 - b.ttfs.p95);

  // Time series data for chart
  const timeSeriesData: { iteration: number; [key: string]: number }[] = [];
  const iterationSize = groups.size;
  for (let i = 0; i < rows.length; i += iterationSize) {
    const chunk = rows.slice(i, i + iterationSize);
    const entry: any = { iteration: Math.floor(i / iterationSize) + 1 };
    for (const r of chunk) {
      entry[r.testName] = r.timeToFirstToken;
    }
    timeSeriesData.push(entry);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Latency Test Report</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #e6edf3;
    --text-muted: #8b949e; --accent: #58a6ff; --good: #3fb950; --ok: #d29922;
    --warn: #db6d28; --bad: #f85149;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); padding: 2rem; line-height: 1.6; }
  h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.3rem; margin: 2rem 0 1rem; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  h3 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; color: var(--text-muted); }
  .meta { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 2rem; }
  .meta span { margin-right: 2rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
  .card .label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 1.5rem; font-weight: 600; margin-top: 0.25rem; }
  .card .detail { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem; }
  .insights { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; }
  .insights ul { list-style: none; padding: 0; }
  .insights li { padding: 0.5rem 0; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
  .insights li:last-child { border-bottom: none; }
  .section-desc { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 2rem; }
  th { background: var(--surface); color: var(--text-muted); text-align: right; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--border); position: sticky; top: 0; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
  th:nth-child(1), th:nth-child(2) { text-align: left; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); text-align: right; font-variant-numeric: tabular-nums; }
  td.rank { text-align: center; color: var(--text-muted); font-weight: 600; }
  td.scenario { text-align: left; font-weight: 500; max-width: 350px; }
  tr:hover { background: rgba(88, 166, 255, 0.05); }
  td.good { color: var(--good); font-weight: 600; }
  td.ok { color: var(--ok); }
  td.warn { color: var(--warn); }
  td.bad { color: var(--bad); font-weight: 600; }
  .chart-container { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; overflow-x: auto; }
  .bar-chart { display: flex; flex-direction: column; gap: 0.4rem; }
  .bar-row { display: flex; align-items: center; gap: 0.5rem; }
  .bar-label { width: 320px; text-align: right; font-size: 0.8rem; color: var(--text-muted); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 22px; background: var(--bg); border-radius: 3px; position: relative; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; display: flex; align-items: center; padding-left: 6px; font-size: 0.75rem; font-weight: 600; min-width: 50px; }
  .bar-fill.nova { background: linear-gradient(90deg, #1a6b3c, #3fb950); }
  .bar-fill.haiku { background: linear-gradient(90deg, #1a4b8c, #58a6ff); }
  .bar-fill.anthropic { background: linear-gradient(90deg, #6e3b8c, #bc8cff); }
  .bar-fill.legacy { background: linear-gradient(90deg, #5a3a1a, #d29922); }
  .bar-median { position: absolute; top: 0; bottom: 0; width: 2px; background: white; opacity: 0.8; }
  .legend { display: flex; gap: 1.5rem; margin-bottom: 1rem; font-size: 0.8rem; color: var(--text-muted); }
  .legend-item { display: flex; align-items: center; gap: 0.4rem; }
  .legend-swatch { width: 12px; height: 12px; border-radius: 2px; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.8rem; }
</style>
</head>
<body>

<h1>Latency Test Report</h1>
<div class="meta">
  <span>Generated: ${new Date().toISOString().slice(0, 19)}</span>
  <span>Period: ${firstTs.slice(0, 19)} - ${lastTs.slice(0, 19)}</span>
  <span>Iterations: ~${iterations}</span>
  <span>Data points: ${rows.length}</span>
</div>

<div class="cards">
  <div class="card">
    <div class="label">Scenarios</div>
    <div class="value">${groups.size}</div>
    <div class="detail">${new Set([...groups.values()].map(v => v[0].model)).size} models, ${new Set([...groups.values()].map(v => v[0].provider)).size} providers</div>
  </div>
  <div class="card">
    <div class="label">Fastest TTFT (P50, Net-Adj)</div>
    <div class="value" style="color: var(--good)">${fmtMs(sortedByPrimaryTTFT[0].primaryTTFT.median)}</div>
    <div class="detail">${sortedByPrimaryTTFT[0].name}</div>
  </div>
  <div class="card">
    <div class="label">Fastest TTFS (P50, Net-Adj)</div>
    <div class="value" style="color: var(--good)">${fmtMs(sortedByPrimaryTTFS[0].primaryTTFS.median)}</div>
    <div class="detail">${sortedByPrimaryTTFS[0].name}</div>
  </div>
  <div class="card">
    <div class="label">Most Consistent</div>
    <div class="value" style="color: var(--accent)">${fmtMs([...scenarios].sort((a, b) => a.primaryTTFT.stddev - b.primaryTTFT.stddev)[0].primaryTTFT.stddev)} SD</div>
    <div class="detail">${[...scenarios].sort((a, b) => a.primaryTTFT.stddev - b.primaryTTFT.stddev)[0].name}</div>
  </div>
  <div class="card">
    <div class="label">Worst Tail (P95, Net-Adj)</div>
    <div class="value" style="color: var(--bad)">${fmtMs([...scenarios].sort((a, b) => b.primaryTTFT.p95 - a.primaryTTFT.p95)[0].primaryTTFT.p95)}</div>
    <div class="detail">${[...scenarios].sort((a, b) => b.primaryTTFT.p95 - a.primaryTTFT.p95)[0].name}</div>
  </div>
</div>

<h2>Insights</h2>
<div class="insights">
  <ul>
    ${insights.map(i => `<li>${i}</li>`).join('\n    ')}
  </ul>
</div>

<h2>TTFT Comparison (Network-Adjusted, P95)</h2>
<p class="section-desc">Visual comparison of Time to First Token with network latency removed. For Bedrock, uses server-side adjusted TTFT. Scenarios marked * use raw TTFT (no server-side metadata available).</p>
<div class="chart-container">
  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background: #3fb950"></div> Nova 2 Lite</div>
    <div class="legend-item"><div class="legend-swatch" style="background: #58a6ff"></div> Haiku 4.5</div>
    <div class="legend-item"><div class="legend-swatch" style="background: #bc8cff"></div> Anthropic Direct</div>
    <div class="legend-item"><div class="legend-swatch" style="background: #d29922"></div> Claude 3.5 Haiku</div>
    <div class="legend-item"><div class="legend-swatch" style="background: white; width: 2px; height: 12px;"></div> P50 (median)</div>
    <div class="legend-item">Bar = P95</div>
  </div>
  <div class="bar-chart">
    ${[...scenarios].sort((a, b) => a.primaryTTFT.p95 - b.primaryTTFT.p95).map(s => {
      const maxVal = Math.max(...scenarios.map(s => s.primaryTTFT.p95), 4000);
      const barWidth = (s.primaryTTFT.p95 / maxVal) * 100;
      const barClass = s.name.includes('Nova') ? 'nova' : s.name.includes('3.5') ? 'legacy' : s.name.includes('Anthropic') ? 'anthropic' : 'haiku';
      return `<div class="bar-row">
        <div class="bar-label">${nameWithMarker(s)}</div>
        <div class="bar-track">
          <div class="bar-fill ${barClass}" style="width: ${barWidth}%">
            P95: ${fmtMs(s.primaryTTFT.p95)}
          </div>
          <div class="bar-median" style="left: ${(s.primaryTTFT.median / maxVal) * 100}%" title="P50: ${fmtMs(s.primaryTTFT.median)}"></div>
        </div>
      </div>`;
    }).join('\n    ')}
  </div>
</div>

<h2>TTFT - Network-Adjusted</h2>
<p class="section-desc">Primary metric. Network latency removed using Bedrock server-side metadata. Represents true model + infrastructure performance independent of client location. Scenarios marked * show raw TTFT (Anthropic Direct does not expose server-side latency).</p>
<table>
  <thead>
    <tr><th>#</th><th>Scenario</th><th>N</th><th>Avg</th><th>P50</th><th>P90</th><th style="color: var(--accent); font-weight: 800;">P95 ▲</th><th>P99</th><th>Max</th><th>StdDev</th><th>Raw P50</th><th>Net OH</th></tr>
  </thead>
  <tbody>
    ${sortedByPrimaryTTFT.map((s, i) => primaryTableRow(s, i + 1, 'ttft')).join('\n    ')}
  </tbody>
</table>

<h2>TTFS - Network-Adjusted</h2>
<p class="section-desc">Time to First Sentence with network latency removed. More relevant for voice applications where TTS needs a full sentence to begin speaking. Scenarios marked * show raw TTFS.</p>
<table>
  <thead>
    <tr><th>#</th><th>Scenario</th><th>N</th><th>Avg</th><th>P50</th><th>P90</th><th style="color: var(--accent); font-weight: 800;">P95 ▲</th><th>P99</th><th>Max</th><th>StdDev</th><th>Raw P50</th><th>Net OH</th></tr>
  </thead>
  <tbody>
    ${sortedByPrimaryTTFS.map((s, i) => primaryTableRow(s, i + 1, 'ttfs')).join('\n    ')}
  </tbody>
</table>

<h2>Raw TTFT - Client-Side (Includes Network)</h2>
<p class="section-desc">Client-side measurement from request sent to first token received. Includes full network round-trip. This is what the end-user actually experiences from the client's location.</p>
<table>
  <thead>
    <tr><th>#</th><th>Scenario</th><th>N</th><th>Avg</th><th>P50</th><th>P90</th><th style="color: var(--accent); font-weight: 800;">P95 ▲</th><th>P99</th><th>Max</th><th>StdDev</th><th>Net OH</th></tr>
  </thead>
  <tbody>
    ${sortedByRawTTFT.map((s, i) => rawTableRow(s, i + 1, 'ttft')).join('\n    ')}
  </tbody>
</table>

<h2>Raw TTFS - Client-Side (Includes Network)</h2>
<p class="section-desc">Time to First Sentence as measured client-side. Includes full network round-trip.</p>
<table>
  <thead>
    <tr><th>#</th><th>Scenario</th><th>N</th><th>Avg</th><th>P50</th><th>P90</th><th style="color: var(--accent); font-weight: 800;">P95 ▲</th><th>P99</th><th>Max</th><th>StdDev</th><th>Net OH</th></tr>
  </thead>
  <tbody>
    ${sortedByRawTTFS.map((s, i) => rawTableRow(s, i + 1, 'ttfs')).join('\n    ')}
  </tbody>
</table>

<h2>Server-Side Latency (Bedrock Metadata)</h2>
<p class="section-desc">Total server-side processing time as reported by Bedrock's response metadata. Includes model inference, token generation, and any server-side queuing. Does not include network transit.</p>
<table>
  <thead>
    <tr><th>#</th><th>Scenario</th><th>N</th><th>Avg</th><th>P50</th><th>P90</th><th style="color: var(--accent); font-weight: 800;">P95 ▲</th><th>P99</th><th>Max</th><th>StdDev</th><th>Input Tok</th><th>Prompt KB</th></tr>
  </thead>
  <tbody>
    ${[...scenarios].filter(s => s.serverLatency).sort((a, b) => a.serverLatency!.p95 - b.serverLatency!.p95).map((s, i) => {
      const st = s.serverLatency!;
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td class="scenario">${s.name}</td>
        <td>${st.n}</td>
        <td class="${latencyClass(st.avg, [1500, 2500, 3500])}">${fmtMs(st.avg)}</td>
        <td class="${latencyClass(st.median, [1500, 2500, 3500])}">${fmtMs(st.median)}</td>
        <td class="${latencyClass(st.p90, [2000, 3500, 5000])}">${fmtMs(st.p90)}</td>
        <td class="${latencyClass(st.p95, [2500, 4000, 6000])}">${fmtMs(st.p95)}</td>
        <td class="${latencyClass(st.p99, [3000, 5000, 7000])}">${fmtMs(st.p99)}</td>
        <td class="${latencyClass(st.max, [3000, 5000, 8000])}">${fmtMs(st.max)}</td>
        <td>${fmtMs(st.stddev)}</td>
        <td>${s.inputTokens.toLocaleString()}</td>
        <td>${(s.promptBytes / 1024).toFixed(1)}KB</td>
      </tr>`;
    }).join('\n    ')}
  </tbody>
</table>

<h2>Network Overhead by Region</h2>
<p class="section-desc">Estimated network round-trip overhead calculated from the difference between client-side and server-side latency. Helps determine optimal region selection based on deployment location.</p>
<table>
  <thead>
    <tr><th>#</th><th>Scenario</th><th>Provider</th><th>Region</th><th>Net OH Med</th><th>Net OH Avg</th><th>Net OH Max</th></tr>
  </thead>
  <tbody>
    ${[...scenarios].filter(s => s.netOH && s.netOH.median < 2000).sort((a, b) => (a.netOH?.median ?? 0) - (b.netOH?.median ?? 0)).map((s, i) => {
      const st = s.netOH!;
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td class="scenario">${s.name}</td>
        <td>${s.provider}</td>
        <td>${s.region || 'N/A'}</td>
        <td>${fmtMs(st.median)}</td>
        <td>${fmtMs(st.avg)}</td>
        <td>${fmtMs(st.max)}</td>
      </tr>`;
    }).join('\n    ')}
  </tbody>
</table>

<h2>TTFT &amp; TTFS Over Time (Per Scenario)</h2>
<p class="section-desc">Each chart shows network-adjusted TTFT and TTFS for every test attempt over time. Helps identify latency spikes, warm-up effects, and consistency patterns.</p>

${[...groups.entries()].map(([name, data]) => {
  const width = 800;
  const height = 200;
  const pad = { top: 20, right: 20, bottom: 30, left: 60 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Get adjusted values where available, fall back to raw
  const points = data.map((r, i) => ({
    idx: i,
    timestamp: r.timestamp,
    ttft: r.adjustedTTFT ?? r.timeToFirstToken,
    ttfs: r.adjustedTTFS ?? r.timeToFirstSentence,
  }));

  const allVals = points.flatMap(p => [p.ttft, p.ttfs]);
  const maxY = Math.max(...allVals, 1000);
  const minY = 0;
  const yRange = maxY - minY;

  const xScale = (i: number) => pad.left + (i / Math.max(points.length - 1, 1)) * plotW;
  const yScale = (v: number) => pad.top + plotH - ((v - minY) / yRange) * plotH;

  // Y-axis ticks
  const yTicks = [0, Math.round(maxY * 0.25), Math.round(maxY * 0.5), Math.round(maxY * 0.75), Math.round(maxY)];

  const ttftPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.idx).toFixed(1)},${yScale(p.ttft).toFixed(1)}`).join(' ');
  const ttfsPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.idx).toFixed(1)},${yScale(p.ttfs).toFixed(1)}`).join(' ');

  // Dots for each point
  const ttftDots = points.map(p => `<circle cx="${xScale(p.idx).toFixed(1)}" cy="${yScale(p.ttft).toFixed(1)}" r="2.5" fill="#58a6ff" opacity="0.7"/>`).join('');
  const ttfsDots = points.map(p => `<circle cx="${xScale(p.idx).toFixed(1)}" cy="${yScale(p.ttfs).toFixed(1)}" r="2.5" fill="#f0883e" opacity="0.7"/>`).join('');

  return `<div class="chart-container">
    <h3 style="margin-top: 0; margin-bottom: 0.5rem; color: var(--text);">${name}</h3>
    <div style="display: flex; gap: 1.5rem; margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-muted);">
      <span><span style="color: #58a6ff;">&#9679;</span> TTFT</span>
      <span><span style="color: #f0883e;">&#9679;</span> TTFS</span>
      <span style="margin-left: auto;">${points.length} samples</span>
    </div>
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="max-width: 100%;">
      <!-- Grid lines -->
      ${yTicks.map(t => `<line x1="${pad.left}" y1="${yScale(t).toFixed(1)}" x2="${width - pad.right}" y2="${yScale(t).toFixed(1)}" stroke="var(--border)" stroke-dasharray="3,3"/>`).join('\n      ')}
      <!-- Y-axis labels -->
      ${yTicks.map(t => `<text x="${pad.left - 8}" y="${(yScale(t) + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="11">${t}ms</text>`).join('\n      ')}
      <!-- X-axis labels -->
      <text x="${pad.left}" y="${height - 5}" fill="var(--text-muted)" font-size="11">#1</text>
      <text x="${width - pad.right}" y="${height - 5}" text-anchor="end" fill="var(--text-muted)" font-size="11">#${points.length}</text>
      <!-- Lines -->
      <path d="${ttftPath}" fill="none" stroke="#58a6ff" stroke-width="1.5" opacity="0.5"/>
      <path d="${ttfsPath}" fill="none" stroke="#f0883e" stroke-width="1.5" opacity="0.5"/>
      <!-- Dots -->
      ${ttftDots}
      ${ttfsDots}
    </svg>
  </div>`;
}).join('\n')}

<footer>
  Generated by ai-utils latency tester report generator. Raw data: ${CSV_FILE}
</footer>

</body>
</html>`;
}

async function main() {
  const csvText = await Bun.file(CSV_FILE).text();
  const rows = parseCSV(csvText);

  if (rows.length === 0) {
    console.error('No data in CSV file');
    process.exit(1);
  }

  console.log(`Parsed ${rows.length} rows from ${CSV_FILE}`);

  const html = generateHTML(rows);
  await Bun.write(OUTPUT_FILE, html);
  console.log(`Report written to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
