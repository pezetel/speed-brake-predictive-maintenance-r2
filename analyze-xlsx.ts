// Quick script to analyze "speed brake info.xlsx" and report anomaly stats
// Run: npx tsx analyze-xlsx.ts

import * as XLSX from 'xlsx';
import { parseExcelData, computeSummary } from './lib/utils';
import { computeTailHealthScores, generatePredictiveInsights } from './lib/analytics';
import { FlightRecord } from './lib/types';

const FILE = 'speed brake info.xlsx';

console.log(`
📂 Reading ${FILE}...
`);
const wb = XLSX.readFile(FILE);

let allRecords: FlightRecord[] = [];

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  console.log(`  Sheet "${sheetName}": ${rows.length} rows`);
  const records = parseExcelData(rows);
  console.log(`    → Parsed ${records.length} valid FlightRecords`);
  allRecords = allRecords.concat(records);
}

console.log(`
✈️  Total records: ${allRecords.length}`);

// --- Summary ---
const summary = computeSummary(allRecords);
console.log(`
📊 SUMMARY`);
console.log(`  Total flights:    ${summary.totalFlights}`);
console.log(`  Unique tails:     ${summary.uniqueTails}`);
console.log(`  Normal:           ${summary.normalCount}  (${((summary.normalCount / summary.totalFlights) * 100).toFixed(1)}%)`);
console.log(`  Warning:          ${summary.warningCount}  (${((summary.warningCount / summary.totalFlights) * 100).toFixed(1)}%)`);
console.log(`  Critical:         ${summary.criticalCount}  (${((summary.criticalCount / summary.totalFlights) * 100).toFixed(1)}%)`);
console.log(`  Avg PFD:          ${summary.avgPFD.toFixed(2)}%`);
console.log(`  Avg Angle:        ${summary.avgDeg.toFixed(2)}°`);
console.log(`  Avg Duration:     ${summary.avgDuration.toFixed(2)}s`);
console.log(`  Avg Dur. Ratio:   ${summary.avgDurationRatio.toFixed(3)}x`);
console.log(`  Doubled records:  ${summary.doubledRecords}`);
console.log(`  Landing anomaly:  ${summary.landingDistAnomalyCount}`);
console.log(`  Slow opening:     ${summary.slowOpeningCount}`);
console.log(`  Mech. failure:    ${summary.mechanicalFailureCount}`);
console.log(`  Problematic tails: ${summary.problematicTails.join(', ') || 'none'}`);

// --- Per-tail breakdown ---
const byTail = new Map<string, FlightRecord[]>();
for (const r of allRecords) {
  let arr = byTail.get(r.tailNumber);
  if (!arr) { arr = []; byTail.set(r.tailNumber, arr); }
  arr.push(r);
}

console.log(`
🔍 PER-TAIL ANOMALY BREAKDOWN`);
console.log('─'.repeat(90));
console.log(
  'Tail'.padEnd(10) +
  'Flights'.padStart(8) +
  'Normal'.padStart(8) +
  'Warn'.padStart(8) +
  'Crit'.padStart(8) +
  'AvgPFD'.padStart(9) +
  'AvgDeg'.padStart(9) +
  'AvgRatio'.padStart(10) +
  'LdAnom'.padStart(8) +
  'Doubled'.padStart(9)
);
console.log('─'.repeat(90));

const tailEntries = Array.from(byTail.entries()).sort((a, b) => a[0].localeCompare(b[0]));

for (const [tail, records] of tailEntries) {
  const s = computeSummary(records);
  console.log(
    tail.padEnd(10) +
    String(s.totalFlights).padStart(8) +
    String(s.normalCount).padStart(8) +
    String(s.warningCount).padStart(8) +
    String(s.criticalCount).padStart(8) +
    s.avgPFD.toFixed(2).padStart(9) +
    s.avgDeg.toFixed(2).padStart(9) +
    s.avgDurationRatio.toFixed(3).padStart(10) +
    String(s.landingDistAnomalyCount).padStart(8) +
    String(s.doubledRecords).padStart(9)
  );
}

// --- Health scores ---
const healthScores = computeTailHealthScores(allRecords);
console.log(`
🏥 TAIL HEALTH SCORES (sorted worst → best)`);
console.log('─'.repeat(100));
console.log(
  'Tail'.padEnd(10) +
  'Score'.padStart(8) +
  'Risk'.padStart(10) +
  'Trend'.padStart(12) +
  'Flights'.padStart(9) +
  'AvgPFD'.padStart(9) +
  'Crit'.padStart(6) +
  'Warn'.padStart(6) +
  'DurRatio'.padStart(10) +
  'Degrad'.padStart(8) +
  'LastFlight'.padStart(13)
);
console.log('─'.repeat(100));

for (const h of healthScores) {
  console.log(
    h.tailNumber.padEnd(10) +
    h.healthScore.toFixed(1).padStart(8) +
    h.riskLevel.padStart(10) +
    h.trend.padStart(12) +
    String(h.totalFlights).padStart(9) +
    h.avgPfd.toFixed(2).padStart(9) +
    String(h.criticalCount).padStart(6) +
    String(h.warningCount).padStart(6) +
    h.durationRatioAvg.toFixed(3).padStart(10) +
    h.degradationRate.toFixed(2).padStart(8) +
    h.lastFlightDate.padStart(13)
  );
}

// --- Predictive insights ---
const insights = generatePredictiveInsights(allRecords, healthScores);
console.log(`
🧠 PREDICTIVE INSIGHTS (${insights.length} total)`);
console.log('─'.repeat(100));

if (insights.length === 0) {
  console.log('  No insights generated — all tails are healthy!');
} else {
  for (const ins of insights) {
    const icon = ins.severity === 'critical' ? '🔴' : ins.severity === 'warning' ? '🟡' : '🔵';
    console.log(`
  ${icon} [${ins.severity.toUpperCase()}] ${ins.title}`);
    console.log(`     Category: ${ins.category} | Confidence: ${ins.confidence}% | Flights: ${ins.relatedFlights}`);
    console.log(`     ${ins.description}`);
    console.log(`     Recommendation: ${ins.recommendation}`);
    if (ins.evidence.length > 0) {
      console.log(`     Evidence:`);
      for (const ev of ins.evidence.slice(0, 3)) {
        console.log(`       • ${ev}`);
      }
      if (ins.evidence.length > 3) {
        console.log(`       ... and ${ins.evidence.length - 3} more`);
      }
    }
  }
}

// --- Critical flights detail ---
const criticalFlights = allRecords.filter(r => r.anomalyLevel === 'critical');
console.log(`
🔴 CRITICAL FLIGHTS DETAIL (${criticalFlights.length} total)`);
console.log('─'.repeat(120));

if (criticalFlights.length === 0) {
  console.log('  No critical flights found!');
} else {
  for (const f of criticalFlights.slice(0, 50)) {
    console.log(`
  ${f.flightDate} | ${f.tailNumber} | ${f.takeoffAirport}→${f.landingAirport}`);
    console.log(`    PFD: ${f.pfdTurn1.toFixed(1)}%  Norm: ${f.normalizedPfd.toFixed(1)}%  Deg: ${f.pfdTurn1Deg.toFixed(1)}°  DurD: ${f.durationDerivative}s  DurE: ${f.durationExtTo99}s  Ratio: ${f.durationRatio.toFixed(2)}x`);
    console.log(`    Land30: ${f.landingDist30kn.toFixed(0)}m  Land50: ${f.landingDist50kn.toFixed(0)}m  ${f.landingDistAnomaly ? '⚠️ 50kn>30kn!' : ''}  GS: ${f.gsAtAutoSbop.toFixed(0)}`);
    console.log(`    Reasons: ${f.anomalyReasons.join(' | ')}`);
  }
  if (criticalFlights.length > 50) {
    console.log(`
  ... and ${criticalFlights.length - 50} more critical flights`);
  }
}

// --- Warning flights sample ---
const warningFlights = allRecords.filter(r => r.anomalyLevel === 'warning');
console.log(`
🟡 WARNING FLIGHTS SAMPLE (showing first 20 of ${warningFlights.length})`);
console.log('─'.repeat(120));

for (const f of warningFlights.slice(0, 20)) {
  console.log(`  ${f.flightDate} | ${f.tailNumber} | ${f.takeoffAirport}→${f.landingAirport} | PFD:${f.normalizedPfd.toFixed(1)}% Deg:${f.pfdTurn1Deg.toFixed(1)}° Ratio:${f.durationRatio.toFixed(2)}x | ${f.anomalyReasons.join('; ')}`);
}

console.log(`
✅ Analysis complete.
`);
