// Simulate current vs proposed criteria against real fault data
// Run: npx tsx simulate-criteria.ts

import * as XLSX from 'xlsx';
import { parseExcelData } from './lib/utils';
import { FlightRecord } from './lib/types';

const FAULT_FILE = 'speedbrake ar\u0131zalar\u0131 filtreli.xlsx';
const DATA_FILE = 'speed brake info.xlsx';

// ─── 1. Read flight data ───
console.log('Reading flight data...');
const dataWb = XLSX.readFile(DATA_FILE);
let allFlights: FlightRecord[] = [];
for (const sheetName of dataWb.SheetNames) {
  const ws = dataWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  allFlights = allFlights.concat(parseExcelData(rows));
}
console.log('  Total flights: ' + allFlights.length);

let minDate = '9999'; let maxDate = '0000';
for (const f of allFlights) {
  if (f.flightDate < minDate) minDate = f.flightDate;
  if (f.flightDate > maxDate) maxDate = f.flightDate;
}
console.log('  Date range: ' + minDate + ' to ' + maxDate);

// Group by tail
const byTail = new Map<string, FlightRecord[]>();
for (const f of allFlights) {
  let arr = byTail.get(f.tailNumber);
  if (!arr) { arr = []; byTail.set(f.tailNumber, arr); }
  arr.push(f);
}
for (const [, arr] of byTail) arr.sort((a, b) => a.flightDate.localeCompare(b.flightDate));

// ─── 2. Read fault records ───
console.log('Reading fault data...');
const faultWb = XLSX.readFile(FAULT_FILE);

interface FaultRecord {
  tail: string;
  date: string;
  desc: string;
}

const faults: FaultRecord[] = [];
for (const sheetName of faultWb.SheetNames) {
  const ws = faultWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  for (const row of rows) {
    let tail = String(row['A/C'] || '').trim().toUpperCase();
    if (tail && !tail.startsWith('TC-')) tail = 'TC-' + tail;
    let date = '';
    const dv = row['Date'];
    if (typeof dv === 'number' && dv > 40000 && dv < 50000) {
      const d = new Date((dv - 25569) * 86400 * 1000);
      date = d.toISOString().split('T')[0];
    }
    const desc = String(row['Description'] || '').replace(/<br>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (tail && date) faults.push({ tail, date, desc });
  }
}
console.log('  Total faults: ' + faults.length);

// Deduplicate: per tail, keep unique fault dates
const uniqueFaultsByTail = new Map<string, Set<string>>();
for (const f of faults) {
  let s = uniqueFaultsByTail.get(f.tail);
  if (!s) { s = new Set(); uniqueFaultsByTail.set(f.tail, s); }
  s.add(f.date);
}

// ─── 3. Define criteria sets ───

// CURRENT CRITERIA (from lib/utils.ts detectAnomaly)
// Score thresholds: warning >= 16, critical >= 40

// Anomaly score calculator — mirrors current detectAnomaly logic
function currentScore(r: FlightRecord): number {
  let score = 0;
  const nPfd = r.normalizedPfd;

  // Signal 1: PFD
  if (nPfd > 0 && nPfd < 60) score += 60;
  else if (nPfd >= 60 && nPfd < 75) score += 45;
  else if (nPfd >= 75 && nPfd < 85) score += 25;
  else if (nPfd >= 85 && nPfd < 92) score += 8;

  // Signal 2: Duration ratio
  if (r.durationDerivative > 0 && r.durationExtTo99 > 0) {
    const ratio = r.durationRatio;
    const absExt = r.durationExtTo99;
    if (ratio > 6 && absExt > 8) score += 40;
    else if (ratio > 4 && absExt > 5) score += 25;
    else if (ratio > 3 && absExt > 4) score += 12;
  }

  // Signal 3: Extension time
  if (r.durationExtTo99 > 15) score += 35;
  else if (r.durationExtTo99 > 10) score += 15;

  // Signal 4: Landing distance inversion
  if (r.landingDist30kn > 0 && r.landingDist50kn > 0 && r.landingDist50kn > r.landingDist30kn * 1.05) {
    score += 30;
  }

  // Signal 5: Angle + PFD
  if (r.pfdTurn1Deg > 0 && r.pfeTo99Deg > 0) {
    if (r.pfdTurn1Deg < 20 && nPfd < 75) score += 40;
    else if (r.pfdTurn1Deg < 25 && nPfd < 80) score += 25;
    const degDiff = r.pfeTo99Deg - r.pfdTurn1Deg;
    if (degDiff > 10 && nPfd < 85) score += 20;
    else if (degDiff > 8 && nPfd < 80) score += 15;
  }

  // Signal 7: GS at SBOP
  if (r.gsAtAutoSbop > 0 && r.gsAtAutoSbop < 1500) score += 5;

  // Signal 8: PFD + Landing combo
  if (nPfd < 85 && r.landingDist30kn > 1800) score += 15;

  return score;
}

// PROPOSED CRITERIA — more aggressive early detection
function proposedScore(r: FlightRecord): number {
  let score = 0;
  const nPfd = r.normalizedPfd;

  // Signal 1: PFD — LOWERED thresholds for warning zone
  if (nPfd > 0 && nPfd < 60) score += 60;
  else if (nPfd >= 60 && nPfd < 75) score += 45;
  else if (nPfd >= 75 && nPfd < 85) score += 30; // was 25
  else if (nPfd >= 85 && nPfd < 92) score += 12; // was 8
  else if (nPfd >= 92 && nPfd < 95) score += 5;  // NEW: mild flag for 92-95

  // Signal 2: Duration ratio — LOWERED thresholds
  if (r.durationDerivative > 0 && r.durationExtTo99 > 0) {
    const ratio = r.durationRatio;
    const absExt = r.durationExtTo99;
    if (ratio > 6 && absExt > 8) score += 40;
    else if (ratio > 4 && absExt > 5) score += 25;
    else if (ratio > 3 && absExt > 4) score += 12;
    else if (ratio > 2.5 && absExt > 3) score += 6; // NEW: earlier detection
  }

  // Signal 3: Extension time — same
  if (r.durationExtTo99 > 15) score += 35;
  else if (r.durationExtTo99 > 10) score += 15;
  else if (r.durationExtTo99 > 7) score += 5; // NEW

  // Signal 4: Landing distance inversion — REDUCED weight
  // This is mostly a sensor issue, not speedbrake
  if (r.landingDist30kn > 0 && r.landingDist50kn > 0 && r.landingDist50kn > r.landingDist30kn * 1.05) {
    score += 18; // was 30 — reduced because it's sensor noise, not speedbrake
  }

  // Signal 5: Angle + PFD — added intermediate tier
  if (r.pfdTurn1Deg > 0 && r.pfeTo99Deg > 0) {
    if (r.pfdTurn1Deg < 20 && nPfd < 75) score += 40;
    else if (r.pfdTurn1Deg < 25 && nPfd < 80) score += 25;
    else if (r.pfdTurn1Deg < 30 && nPfd < 85) score += 15; // NEW tier
    const degDiff = r.pfeTo99Deg - r.pfdTurn1Deg;
    if (degDiff > 10 && nPfd < 85) score += 20;
    else if (degDiff > 8 && nPfd < 80) score += 15;
    else if (degDiff > 5 && nPfd < 90) score += 5; // NEW: subtler lag
  }

  // Signal 7: GS — same
  if (r.gsAtAutoSbop > 0 && r.gsAtAutoSbop < 1500) score += 5;

  // Signal 8: PFD + Landing combo — same
  if (nPfd < 85 && r.landingDist30kn > 1800) score += 15;

  // NEW Signal 9: PFD high deviation from 100%
  // Even PFD 95% is unusual for a healthy aircraft (fleet avg is 99.7%)
  // This catches early degradation
  if (nPfd > 0 && nPfd < 97 && nPfd >= 92) score += 3;

  return score;
}

// ─── 4. Health score calculators ───

interface HealthResult {
  tail: string;
  score: number;
  risk: string;
  flightCount: number;
  critCount: number;
  warnCount: number;
  avgPfd: number;
  worstPfd: number;
}

function calcHealthCurrent(tail: string, flights: FlightRecord[]): HealthResult {
  let pfdSum = 0, pfdN = 0, crit = 0, warn = 0, worstPfd = 999;
  let drSum = 0, drN = 0, ldAnom = 0;
  let degSum = 0, degN = 0;

  for (const f of flights) {
    const s = currentScore(f);
    if (s >= 40) crit++;
    else if (s >= 16) warn++;
    if (f.normalizedPfd > 0 && f.normalizedPfd <= 105) {
      pfdSum += f.normalizedPfd; pfdN++;
      if (f.normalizedPfd < worstPfd) worstPfd = f.normalizedPfd;
    }
    if (f.durationRatio > 0 && f.durationRatio < 50) { drSum += f.durationRatio; drN++; }
    if (f.landingDistAnomaly) ldAnom++;
    if (f.pfdTurn1Deg > 0 && f.pfdTurn1Deg < 100) { degSum += f.pfdTurn1Deg; degN++; }
  }

  const avgPfd = pfdN > 0 ? pfdSum / pfdN : 0;
  const avgDeg = degN > 0 ? degSum / degN : 0;
  const drAvg = drN > 0 ? drSum / drN : 0;
  const ldRate = ldAnom / Math.max(flights.length, 1);

  let hs = 100;
  if (avgPfd < 95) hs -= (95 - avgPfd) * 1.5;
  if (avgPfd < 80) hs -= (80 - avgPfd) * 2;
  hs -= crit * 5;
  hs -= warn * 2; // all warnings weighted equally
  if (drAvg > 2) hs -= (drAvg - 2) * 5;
  hs -= ldRate * 20;
  if (avgDeg < 40) hs -= (40 - avgDeg) * 0.5;
  hs = Math.max(0, Math.min(100, hs));

  let risk = 'LOW';
  if (hs < 50) risk = 'CRITICAL';
  else if (hs < 70) risk = 'HIGH';
  else if (hs < 85) risk = 'MEDIUM';

  return { tail, score: Math.round(hs * 10) / 10, risk, flightCount: flights.length, critCount: crit, warnCount: warn, avgPfd, worstPfd: worstPfd === 999 ? 0 : worstPfd };
}

function calcHealthProposed(tail: string, flights: FlightRecord[]): HealthResult {
  let pfdSum = 0, pfdN = 0, crit = 0, warn = 0, worstPfd = 999;
  let drSum = 0, drN = 0, ldAnom = 0;
  let degSum = 0, degN = 0;
  let ldOnlyWarn = 0; // warnings that are ONLY from landing distance

  for (const f of flights) {
    const s = proposedScore(f);
    if (s >= 40) crit++;
    else if (s >= 16) {
      warn++;
      // Check if this warning is ONLY from landing distance inversion
      const ldScore = (f.landingDist30kn > 0 && f.landingDist50kn > 0 && f.landingDist50kn > f.landingDist30kn * 1.05) ? 18 : 0;
      if (s - ldScore < 16) ldOnlyWarn++; // without LD score, would not be warning
    }
    if (f.normalizedPfd > 0 && f.normalizedPfd <= 105) {
      pfdSum += f.normalizedPfd; pfdN++;
      if (f.normalizedPfd < worstPfd) worstPfd = f.normalizedPfd;
    }
    if (f.durationRatio > 0 && f.durationRatio < 50) { drSum += f.durationRatio; drN++; }
    if (f.landingDistAnomaly) ldAnom++;
    if (f.pfdTurn1Deg > 0 && f.pfdTurn1Deg < 100) { degSum += f.pfdTurn1Deg; degN++; }
  }

  const avgPfd = pfdN > 0 ? pfdSum / pfdN : 0;
  const avgDeg = degN > 0 ? degSum / degN : 0;
  const drAvg = drN > 0 ? drSum / drN : 0;
  const ldRate = ldAnom / Math.max(flights.length, 1);
  const realWarn = warn - ldOnlyWarn; // warnings from actual speedbrake issues

  let hs = 100;
  if (avgPfd < 95) hs -= (95 - avgPfd) * 1.5;
  if (avgPfd < 80) hs -= (80 - avgPfd) * 2;
  hs -= crit * 5;
  hs -= realWarn * 2;       // speedbrake warnings: full weight
  hs -= ldOnlyWarn * 0.5;   // landing distance only warnings: reduced weight
  if (drAvg > 2) hs -= (drAvg - 2) * 5;
  hs -= ldRate * 10;        // was 20, reduced
  if (avgDeg < 40) hs -= (40 - avgDeg) * 0.5;

  // NEW: Worst flight penalty
  if (worstPfd < 999 && worstPfd < 50) hs -= 20;
  else if (worstPfd < 999 && worstPfd < 70) hs -= 10;
  else if (worstPfd < 999 && worstPfd < 80) hs -= 5;

  hs = Math.max(0, Math.min(100, hs));

  let risk = 'LOW';
  if (hs < 50) risk = 'CRITICAL';
  else if (hs < 70) risk = 'HIGH';
  else if (hs < 85) risk = 'MEDIUM';

  return { tail, score: Math.round(hs * 10) / 10, risk, flightCount: flights.length, critCount: crit, warnCount: warn, avgPfd, worstPfd: worstPfd === 999 ? 0 : worstPfd };
}

// ─── 5. For each fault, check detection in windows ───

function daysDiff(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

interface DetectionResult {
  fault: FaultRecord;
  tailFlights: number;
  // Current criteria
  cur_critBefore30: number;
  cur_critBefore60: number;
  cur_critBefore90: number;
  cur_warnBefore30: number;
  cur_warnBefore60: number;
  cur_warnBefore90: number;
  cur_anySig30: boolean;
  cur_anySig60: boolean;
  cur_anySig90: boolean;
  cur_critAfter30: number;
  // Proposed criteria
  prop_critBefore30: number;
  prop_critBefore60: number;
  prop_critBefore90: number;
  prop_warnBefore30: number;
  prop_warnBefore60: number;
  prop_warnBefore90: number;
  prop_anySig30: boolean;
  prop_anySig60: boolean;
  prop_anySig90: boolean;
  prop_critAfter30: number;
}

const results: DetectionResult[] = [];

for (const fault of faults) {
  const flights = byTail.get(fault.tail) || [];
  let cur_c30 = 0, cur_c60 = 0, cur_c90 = 0, cur_w30 = 0, cur_w60 = 0, cur_w90 = 0, cur_cA30 = 0;
  let prop_c30 = 0, prop_c60 = 0, prop_c90 = 0, prop_w30 = 0, prop_w60 = 0, prop_w90 = 0, prop_cA30 = 0;

  for (const f of flights) {
    const diff = daysDiff(fault.date, f.flightDate); // positive = flight before fault
    const curS = currentScore(f);
    const propS = proposedScore(f);

    if (diff > 0 && diff <= 90) {
      // Before fault
      if (curS >= 40) { cur_c90++; if (diff <= 60) cur_c60++; if (diff <= 30) cur_c30++; }
      else if (curS >= 16) { cur_w90++; if (diff <= 60) cur_w60++; if (diff <= 30) cur_w30++; }
      if (propS >= 40) { prop_c90++; if (diff <= 60) prop_c60++; if (diff <= 30) prop_c30++; }
      else if (propS >= 16) { prop_w90++; if (diff <= 60) prop_w60++; if (diff <= 30) prop_w30++; }
    } else if (diff < 0 && diff >= -30) {
      // After fault (within 30 days)
      if (curS >= 40) cur_cA30++;
      if (propS >= 40) prop_cA30++;
    }
  }

  results.push({
    fault,
    tailFlights: flights.length,
    cur_critBefore30: cur_c30, cur_critBefore60: cur_c60, cur_critBefore90: cur_c90,
    cur_warnBefore30: cur_w30, cur_warnBefore60: cur_w60, cur_warnBefore90: cur_w90,
    cur_anySig30: cur_c30 + cur_w30 > 0,
    cur_anySig60: cur_c60 + cur_w60 > 0,
    cur_anySig90: cur_c90 + cur_w90 > 0,
    cur_critAfter30: cur_cA30,
    prop_critBefore30: prop_c30, prop_critBefore60: prop_c60, prop_critBefore90: prop_c90,
    prop_warnBefore30: prop_w30, prop_warnBefore60: prop_w60, prop_warnBefore90: prop_w90,
    prop_anySig30: prop_c30 + prop_w30 > 0,
    prop_anySig60: prop_c60 + prop_w60 > 0,
    prop_anySig90: prop_c90 + prop_w90 > 0,
    prop_critAfter30: prop_cA30,
  });
}

// ─── 6. Fleet-wide false positive analysis ───
// For tails that NEVER had a fault — how many get flagged?

const faultTails = new Set(faults.map(f => f.tail));
const healthyCurrent: HealthResult[] = [];
const healthyProposed: HealthResult[] = [];
const faultyCurrentHealth: HealthResult[] = [];
const faultyProposedHealth: HealthResult[] = [];

for (const [tail, flights] of byTail) {
  const hCur = calcHealthCurrent(tail, flights);
  const hProp = calcHealthProposed(tail, flights);
  if (faultTails.has(tail)) {
    faultyCurrentHealth.push(hCur);
    faultyProposedHealth.push(hProp);
  } else {
    healthyCurrent.push(hCur);
    healthyProposed.push(hProp);
  }
}

// ─── 7. Print results ───

console.log('');
console.log('='.repeat(120));
console.log('ARIZA TESPIT ORANI KARSILASTIRMASI: MEVCUT vs ONERILEN KRITERLER');
console.log('='.repeat(120));

// Detection rates
const totalFaults = results.length;
const faultsWithData = results.filter(r => r.tailFlights > 0);

console.log('');
console.log('Toplam ariza: ' + totalFaults + ' (' + faultsWithData.length + ' ucus verisi olan)');
console.log('');

function pct(n: number, total: number): string {
  return ((n / Math.max(total, 1)) * 100).toFixed(1) + '%';
}

console.log('TESPIT ORANI (ariza oncesinde sinyal var mi?)');
console.log('-'.repeat(100));
console.log(
  'Pencere'.padEnd(15) +
  '|  MEVCUT                          |  ONERILEN                         |  FARK'
);
console.log(
  ''.padEnd(15) +
  '|  Kritik   Uyari    Herhangi      |  Kritik   Uyari    Herhangi       |'
);
console.log('-'.repeat(100));

const windows = [
  { label: 'Son 30 gun', curC: 'cur_critBefore30', curW: 'cur_warnBefore30', curA: 'cur_anySig30', propC: 'prop_critBefore30', propW: 'prop_warnBefore30', propA: 'prop_anySig30' },
  { label: 'Son 60 gun', curC: 'cur_critBefore60', curW: 'cur_warnBefore60', curA: 'cur_anySig60', propC: 'prop_critBefore60', propW: 'prop_warnBefore60', propA: 'prop_anySig60' },
  { label: 'Son 90 gun', curC: 'cur_critBefore90', curW: 'cur_warnBefore90', curA: 'cur_anySig90', propC: 'prop_critBefore90', propW: 'prop_warnBefore90', propA: 'prop_anySig90' },
] as const;

for (const w of windows) {
  const curCritDet = faultsWithData.filter(r => (r as any)[w.curC] > 0).length;
  const curWarnDet = faultsWithData.filter(r => (r as any)[w.curW] > 0).length;
  const curAnyDet = faultsWithData.filter(r => (r as any)[w.curA]).length;
  const propCritDet = faultsWithData.filter(r => (r as any)[w.propC] > 0).length;
  const propWarnDet = faultsWithData.filter(r => (r as any)[w.propW] > 0).length;
  const propAnyDet = faultsWithData.filter(r => (r as any)[w.propA]).length;

  const n = faultsWithData.length;
  const critDiff = propCritDet - curCritDet;
  const anyDiff = propAnyDet - curAnyDet;

  console.log(
    w.label.padEnd(15) +
    '|  ' + (curCritDet + '/' + n).padEnd(8) + pct(curCritDet, n).padStart(6) + '  ' +
    (curWarnDet + '/' + n).padEnd(8) + pct(curWarnDet, n).padStart(6) + '  ' +
    (curAnyDet + '/' + n).padEnd(8) + pct(curAnyDet, n).padStart(6) +
    '  |  ' + (propCritDet + '/' + n).padEnd(8) + pct(propCritDet, n).padStart(6) + '  ' +
    (propWarnDet + '/' + n).padEnd(8) + pct(propWarnDet, n).padStart(6) + '  ' +
    (propAnyDet + '/' + n).padEnd(8) + pct(propAnyDet, n).padStart(6) +
    '  |  Crit:' + (critDiff >= 0 ? '+' : '') + critDiff + ' Any:' + (anyDiff >= 0 ? '+' : '') + anyDiff
  );
}

// Also check: faults where fault date is BEFORE flight data
// (can only check post-fault signals — did issue persist?)
const preFaults = results.filter(r => r.fault.date < minDate && r.tailFlights > 0);
if (preFaults.length > 0) {
  console.log('');
  console.log('ARIZA TARIHI UCUS VERISINDEN ONCE (' + preFaults.length + ' ariza):');
  console.log('  Ariza sonrasi 30g icinde kritik sinyal:');
  const curPost = preFaults.filter(r => r.cur_critAfter30 > 0).length;
  const propPost = preFaults.filter(r => r.prop_critAfter30 > 0).length;
  console.log('    Mevcut:  ' + curPost + '/' + preFaults.length + ' (' + pct(curPost, preFaults.length) + ')');
  console.log('    Onerilen: ' + propPost + '/' + preFaults.length + ' (' + pct(propPost, preFaults.length) + ')');
}

// ─── 8. False positive analysis ───
console.log('');
console.log('='.repeat(120));
console.log('YANLIS POZITIF ANALIZI (arizasi olmayan ucaklar)');
console.log('='.repeat(120));

console.log('');
console.log('Arizasi olan ucak sayisi:  ' + faultTails.size);
console.log('Arizasi olmayan ucak:      ' + healthyCurrent.length);
console.log('');

console.log('SAGLIK SKORU KARSILASTIRMASI — Arizasi OLMAYAN ucaklar (yanlis pozitif):');
console.log('-'.repeat(90));

function riskDist(arr: HealthResult[]): { crit: number; high: number; med: number; low: number } {
  return {
    crit: arr.filter(h => h.risk === 'CRITICAL').length,
    high: arr.filter(h => h.risk === 'HIGH').length,
    med: arr.filter(h => h.risk === 'MEDIUM').length,
    low: arr.filter(h => h.risk === 'LOW').length,
  };
}

const hcDist = riskDist(healthyCurrent);
const hpDist = riskDist(healthyProposed);

console.log('                MEVCUT                      ONERILEN');
console.log('  CRITICAL:     ' + String(hcDist.crit).padStart(3) + ' (' + pct(hcDist.crit, healthyCurrent.length).padStart(6) + ')          ' + String(hpDist.crit).padStart(3) + ' (' + pct(hpDist.crit, healthyProposed.length).padStart(6) + ')');
console.log('  HIGH:         ' + String(hcDist.high).padStart(3) + ' (' + pct(hcDist.high, healthyCurrent.length).padStart(6) + ')          ' + String(hpDist.high).padStart(3) + ' (' + pct(hpDist.high, healthyProposed.length).padStart(6) + ')');
console.log('  MEDIUM:       ' + String(hcDist.med).padStart(3) + ' (' + pct(hcDist.med, healthyCurrent.length).padStart(6) + ')          ' + String(hpDist.med).padStart(3) + ' (' + pct(hpDist.med, healthyProposed.length).padStart(6) + ')');
console.log('  LOW:          ' + String(hcDist.low).padStart(3) + ' (' + pct(hcDist.low, healthyCurrent.length).padStart(6) + ')          ' + String(hpDist.low).padStart(3) + ' (' + pct(hpDist.low, healthyProposed.length).padStart(6) + ')');

console.log('');
console.log('SAGLIK SKORU KARSILASTIRMASI — Arizasi OLAN ucaklar (dogru tespit):');
console.log('-'.repeat(90));

const fcDist = riskDist(faultyCurrentHealth);
const fpDist = riskDist(faultyProposedHealth);

console.log('                MEVCUT                      ONERILEN');
console.log('  CRITICAL:     ' + String(fcDist.crit).padStart(3) + ' (' + pct(fcDist.crit, faultyCurrentHealth.length).padStart(6) + ')          ' + String(fpDist.crit).padStart(3) + ' (' + pct(fpDist.crit, faultyProposedHealth.length).padStart(6) + ')');
console.log('  HIGH:         ' + String(fcDist.high).padStart(3) + ' (' + pct(fcDist.high, faultyCurrentHealth.length).padStart(6) + ')          ' + String(fpDist.high).padStart(3) + ' (' + pct(fpDist.high, faultyProposedHealth.length).padStart(6) + ')');
console.log('  MEDIUM:       ' + String(fcDist.med).padStart(3) + ' (' + pct(fcDist.med, faultyCurrentHealth.length).padStart(6) + ')          ' + String(fpDist.med).padStart(3) + ' (' + pct(fpDist.med, faultyProposedHealth.length).padStart(6) + ')');
console.log('  LOW:          ' + String(fcDist.low).padStart(3) + ' (' + pct(fcDist.low, faultyCurrentHealth.length).padStart(6) + ')          ' + String(fpDist.low).padStart(3) + ' (' + pct(fpDist.low, faultyProposedHealth.length).padStart(6) + ')');

// ─── 9. Per-flight anomaly count comparison ───
console.log('');
console.log('='.repeat(120));
console.log('FILO GENELI ANOMALI SAYISI KARSILASTIRMASI');
console.log('='.repeat(120));

let curTotal_crit = 0, curTotal_warn = 0, curTotal_norm = 0;
let propTotal_crit = 0, propTotal_warn = 0, propTotal_norm = 0;

for (const f of allFlights) {
  const cs = currentScore(f);
  const ps = proposedScore(f);
  if (cs >= 40) curTotal_crit++; else if (cs >= 16) curTotal_warn++; else curTotal_norm++;
  if (ps >= 40) propTotal_crit++; else if (ps >= 16) propTotal_warn++; else propTotal_norm++;
}

console.log('');
console.log('                    MEVCUT                ONERILEN              FARK');
console.log('  Normal:       ' + String(curTotal_norm).padStart(7) + ' (' + pct(curTotal_norm, allFlights.length).padStart(6) + ')     ' + String(propTotal_norm).padStart(7) + ' (' + pct(propTotal_norm, allFlights.length).padStart(6) + ')     ' + (propTotal_norm - curTotal_norm));
console.log('  Warning:      ' + String(curTotal_warn).padStart(7) + ' (' + pct(curTotal_warn, allFlights.length).padStart(6) + ')     ' + String(propTotal_warn).padStart(7) + ' (' + pct(propTotal_warn, allFlights.length).padStart(6) + ')     +' + (propTotal_warn - curTotal_warn));
console.log('  Critical:     ' + String(curTotal_crit).padStart(7) + ' (' + pct(curTotal_crit, allFlights.length).padStart(6) + ')     ' + String(propTotal_crit).padStart(7) + ' (' + pct(propTotal_crit, allFlights.length).padStart(6) + ')     +' + (propTotal_crit - curTotal_crit));

// ─── 10. Detailed per-fault table ───
console.log('');
console.log('='.repeat(140));
console.log('ARIZA BAZLI DETAY');
console.log('='.repeat(140));
console.log(
  'Kuyruk'.padEnd(10) +
  'Trh'.padEnd(12) +
  'Ucus'.padStart(6) +
  '  |  CUR: C30 W30 Any30 C60 W60 Any60 C90 W90 Any90' +
  '  |  PROP: C30 W30 Any30 C60 W60 Any60 C90 W90 Any90' +
  '  |  Iyilesme?'
);
console.log('-'.repeat(140));

for (const r of results) {
  const curBetter90 = r.cur_anySig90 ? 'EVET' : 'HAYIR';
  const propBetter90 = r.prop_anySig90 ? 'EVET' : 'HAYIR';
  const improved = (!r.cur_anySig90 && r.prop_anySig90) ? ' << YENI TESPIT' :
                   (!r.cur_anySig60 && r.prop_anySig60) ? ' << ERKEN TESPIT' :
                   (!r.cur_anySig30 && r.prop_anySig30) ? ' << DAHA ERKEN' : '';

  console.log(
    r.fault.tail.padEnd(10) +
    r.fault.date.substring(2).padEnd(12) +
    String(r.tailFlights).padStart(6) +
    '  |  ' +
    String(r.cur_critBefore30).padStart(3) + String(r.cur_warnBefore30).padStart(4) + ('  ' + (r.cur_anySig30 ? 'Y' : '-')).padStart(5) +
    String(r.cur_critBefore60).padStart(4) + String(r.cur_warnBefore60).padStart(4) + ('  ' + (r.cur_anySig60 ? 'Y' : '-')).padStart(5) +
    String(r.cur_critBefore90).padStart(4) + String(r.cur_warnBefore90).padStart(4) + ('  ' + (r.cur_anySig90 ? 'Y' : '-')).padStart(5) +
    '  |  ' +
    String(r.prop_critBefore30).padStart(3) + String(r.prop_warnBefore30).padStart(4) + ('  ' + (r.prop_anySig30 ? 'Y' : '-')).padStart(5) +
    String(r.prop_critBefore60).padStart(4) + String(r.prop_warnBefore60).padStart(4) + ('  ' + (r.prop_anySig60 ? 'Y' : '-')).padStart(5) +
    String(r.prop_critBefore90).padStart(4) + String(r.prop_warnBefore90).padStart(4) + ('  ' + (r.prop_anySig90 ? 'Y' : '-')).padStart(5) +
    '  |  ' + improved
  );
}

console.log('');
console.log('='.repeat(100));
console.log('SONUC');
console.log('='.repeat(100));

// Summary
const n = faultsWithData.length;
const cur90 = faultsWithData.filter(r => r.cur_anySig90).length;
const prop90 = faultsWithData.filter(r => r.prop_anySig90).length;
const cur60 = faultsWithData.filter(r => r.cur_anySig60).length;
const prop60 = faultsWithData.filter(r => r.prop_anySig60).length;
const cur30 = faultsWithData.filter(r => r.cur_anySig30).length;
const prop30 = faultsWithData.filter(r => r.prop_anySig30).length;
const newDetections90 = faultsWithData.filter(r => !r.cur_anySig90 && r.prop_anySig90).length;

console.log('');
console.log('ARIZA TESPIT OZETI (' + n + ' ariza):');
console.log('  90g pencere: MEVCUT ' + cur90 + '/' + n + ' (' + pct(cur90, n) + ')  ->  ONERILEN ' + prop90 + '/' + n + ' (' + pct(prop90, n) + ')  [+' + (prop90 - cur90) + ' ariza]');
console.log('  60g pencere: MEVCUT ' + cur60 + '/' + n + ' (' + pct(cur60, n) + ')  ->  ONERILEN ' + prop60 + '/' + n + ' (' + pct(prop60, n) + ')  [+' + (prop60 - cur60) + ' ariza]');
console.log('  30g pencere: MEVCUT ' + cur30 + '/' + n + ' (' + pct(cur30, n) + ')  ->  ONERILEN ' + prop30 + '/' + n + ' (' + pct(prop30, n) + ')  [+' + (prop30 - cur30) + ' ariza]');
console.log('');
console.log('YANLIS POZITIF OZETI (arizasi olmayan ' + healthyCurrent.length + ' ucak):');
console.log('  CRITICAL olarak isaretlenen: MEVCUT ' + hcDist.crit + '  ->  ONERILEN ' + hpDist.crit);
console.log('  HIGH olarak isaretlenen:     MEVCUT ' + hcDist.high + '  ->  ONERILEN ' + hpDist.high);
console.log('  LOW (dogru negatif):         MEVCUT ' + hcDist.low + '  ->  ONERILEN ' + hpDist.low);
console.log('');
console.log('FILO ANOMALI YUZDESI:');
console.log('  Warning: MEVCUT ' + pct(curTotal_warn, allFlights.length) + '  ->  ONERILEN ' + pct(propTotal_warn, allFlights.length));
console.log('  Critical: MEVCUT ' + pct(curTotal_crit, allFlights.length) + '  ->  ONERILEN ' + pct(propTotal_crit, allFlights.length));

console.log('');
console.log('Simulasyon tamamlandi.');
