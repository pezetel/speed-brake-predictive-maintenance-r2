// Simulate current vs proposed criteria against real fault data
// ONLY faults WITHIN flight data range are counted for detection %
// Run: npx tsx simulate-v2.ts

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

const allFaults: FaultRecord[] = [];
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
    const desc = String(row['Description'] || '').replace(/<br>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
    if (tail && date) allFaults.push({ tail, date, desc });
  }
}
console.log('  Total faults: ' + allFaults.length);

// FILTER: Only faults within flight data range
const faults = allFaults.filter(f => f.date >= minDate && f.date <= maxDate);
const excluded = allFaults.length - faults.length;
console.log('  Within flight data range: ' + faults.length);
console.log('  Excluded (before data): ' + excluded);

const faultTails = new Set(allFaults.map(f => f.tail));

// ─── 3. Score functions ───

function currentScore(r: FlightRecord): number {
  let score = 0;
  const nPfd = r.normalizedPfd;

  if (nPfd > 0 && nPfd < 60) score += 60;
  else if (nPfd >= 60 && nPfd < 75) score += 45;
  else if (nPfd >= 75 && nPfd < 85) score += 25;
  else if (nPfd >= 85 && nPfd < 92) score += 8;

  if (r.durationDerivative > 0 && r.durationExtTo99 > 0) {
    const ratio = r.durationRatio;
    const absExt = r.durationExtTo99;
    if (ratio > 6 && absExt > 8) score += 40;
    else if (ratio > 4 && absExt > 5) score += 25;
    else if (ratio > 3 && absExt > 4) score += 12;
  }

  if (r.durationExtTo99 > 15) score += 35;
  else if (r.durationExtTo99 > 10) score += 15;

  if (r.landingDist30kn > 0 && r.landingDist50kn > 0 && r.landingDist50kn > r.landingDist30kn * 1.05) {
    score += 30;
  }

  if (r.pfdTurn1Deg > 0 && r.pfeTo99Deg > 0) {
    if (r.pfdTurn1Deg < 20 && nPfd < 75) score += 40;
    else if (r.pfdTurn1Deg < 25 && nPfd < 80) score += 25;
    const degDiff = r.pfeTo99Deg - r.pfdTurn1Deg;
    if (degDiff > 10 && nPfd < 85) score += 20;
    else if (degDiff > 8 && nPfd < 80) score += 15;
  }

  if (r.gsAtAutoSbop > 0 && r.gsAtAutoSbop < 1500) score += 5;
  if (nPfd < 85 && r.landingDist30kn > 1800) score += 15;

  return score;
}

function proposedScore(r: FlightRecord): number {
  let score = 0;
  const nPfd = r.normalizedPfd;

  // Signal 1: PFD — slightly more sensitive
  if (nPfd > 0 && nPfd < 60) score += 60;
  else if (nPfd >= 60 && nPfd < 75) score += 45;
  else if (nPfd >= 75 && nPfd < 85) score += 30; // was 25
  else if (nPfd >= 85 && nPfd < 92) score += 12; // was 8
  else if (nPfd >= 92 && nPfd < 95) score += 5;  // NEW

  // Signal 2: Duration ratio
  if (r.durationDerivative > 0 && r.durationExtTo99 > 0) {
    const ratio = r.durationRatio;
    const absExt = r.durationExtTo99;
    if (ratio > 6 && absExt > 8) score += 40;
    else if (ratio > 4 && absExt > 5) score += 25;
    else if (ratio > 3 && absExt > 4) score += 12;
    else if (ratio > 2.5 && absExt > 3) score += 6; // NEW
  }

  // Signal 3: Extension time
  if (r.durationExtTo99 > 15) score += 35;
  else if (r.durationExtTo99 > 10) score += 15;
  else if (r.durationExtTo99 > 7) score += 5; // NEW

  // Signal 4: Landing distance — REDUCED (sensor issue, not speedbrake)
  if (r.landingDist30kn > 0 && r.landingDist50kn > 0 && r.landingDist50kn > r.landingDist30kn * 1.05) {
    score += 18; // was 30
  }

  // Signal 5: Angle + PFD
  if (r.pfdTurn1Deg > 0 && r.pfeTo99Deg > 0) {
    if (r.pfdTurn1Deg < 20 && nPfd < 75) score += 40;
    else if (r.pfdTurn1Deg < 25 && nPfd < 80) score += 25;
    else if (r.pfdTurn1Deg < 30 && nPfd < 85) score += 15; // NEW
    const degDiff = r.pfeTo99Deg - r.pfdTurn1Deg;
    if (degDiff > 10 && nPfd < 85) score += 20;
    else if (degDiff > 8 && nPfd < 80) score += 15;
    else if (degDiff > 5 && nPfd < 90) score += 5; // NEW
  }

  // Signal 7: GS
  if (r.gsAtAutoSbop > 0 && r.gsAtAutoSbop < 1500) score += 5;

  // Signal 8: PFD + Landing combo
  if (nPfd < 85 && r.landingDist30kn > 1800) score += 15;

  // Signal 9: Mild PFD deviation (fleet avg 99.7%, anything <97 is noteworthy)
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
    if (s >= 40) crit++; else if (s >= 16) warn++;
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
  hs -= warn * 2;
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
  let ldOnlyWarn = 0;

  for (const f of flights) {
    const s = proposedScore(f);
    if (s >= 40) crit++;
    else if (s >= 16) {
      warn++;
      const ldScore = (f.landingDist30kn > 0 && f.landingDist50kn > 0 && f.landingDist50kn > f.landingDist30kn * 1.05) ? 18 : 0;
      if (s - ldScore < 16) ldOnlyWarn++;
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
  const realWarn = warn - ldOnlyWarn;

  let hs = 100;
  if (avgPfd < 95) hs -= (95 - avgPfd) * 1.5;
  if (avgPfd < 80) hs -= (80 - avgPfd) * 2;
  hs -= crit * 5;
  hs -= realWarn * 2;
  hs -= ldOnlyWarn * 0.5;
  if (drAvg > 2) hs -= (drAvg - 2) * 5;
  hs -= ldRate * 10; // was 20
  if (avgDeg < 40) hs -= (40 - avgDeg) * 0.5;

  // Worst flight penalty
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

// ─── 5. Detection analysis — ONLY for faults within data range ───

function daysDiff(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function pct(n: number, total: number): string {
  return ((n / Math.max(total, 1)) * 100).toFixed(1) + '%';
}

interface DetectionResult {
  fault: FaultRecord;
  tailFlights: number;
  cur_c30: number; cur_w30: number; cur_any30: boolean;
  cur_c60: number; cur_w60: number; cur_any60: boolean;
  cur_c90: number; cur_w90: number; cur_any90: boolean;
  prop_c30: number; prop_w30: number; prop_any30: boolean;
  prop_c60: number; prop_w60: number; prop_any60: boolean;
  prop_c90: number; prop_w90: number; prop_any90: boolean;
  cur_cAfter30: number;
  prop_cAfter30: number;
}

const results: DetectionResult[] = [];

for (const fault of faults) {
  const flights = byTail.get(fault.tail) || [];
  let cc30 = 0, cc60 = 0, cc90 = 0, cw30 = 0, cw60 = 0, cw90 = 0, ccA = 0;
  let pc30 = 0, pc60 = 0, pc90 = 0, pw30 = 0, pw60 = 0, pw90 = 0, pcA = 0;

  for (const f of flights) {
    const diff = daysDiff(fault.date, f.flightDate);
    const cs = currentScore(f);
    const ps = proposedScore(f);

    if (diff > 0 && diff <= 90) {
      if (cs >= 40) { cc90++; if (diff <= 60) cc60++; if (diff <= 30) cc30++; }
      else if (cs >= 16) { cw90++; if (diff <= 60) cw60++; if (diff <= 30) cw30++; }
      if (ps >= 40) { pc90++; if (diff <= 60) pc60++; if (diff <= 30) pc30++; }
      else if (ps >= 16) { pw90++; if (diff <= 60) pw60++; if (diff <= 30) pw30++; }
    } else if (diff < 0 && diff >= -30) {
      if (cs >= 40) ccA++;
      if (ps >= 40) pcA++;
    }
  }

  results.push({
    fault, tailFlights: flights.length,
    cur_c30: cc30, cur_w30: cw30, cur_any30: cc30 + cw30 > 0,
    cur_c60: cc60, cur_w60: cw60, cur_any60: cc60 + cw60 > 0,
    cur_c90: cc90, cur_w90: cw90, cur_any90: cc90 + cw90 > 0,
    prop_c30: pc30, prop_w30: pw30, prop_any30: pc30 + pw30 > 0,
    prop_c60: pc60, prop_w60: pw60, prop_any60: pc60 + pw60 > 0,
    prop_c90: pc90, prop_w90: pw90, prop_any90: pc90 + pw90 > 0,
    cur_cAfter30: ccA, prop_cAfter30: pcA,
  });
}

// ─── 6. Health scores for all tails ───
const healthyCur: HealthResult[] = [];
const healthyProp: HealthResult[] = [];
const faultyCur: HealthResult[] = [];
const faultyProp: HealthResult[] = [];

for (const [tail, flights] of byTail) {
  const hc = calcHealthCurrent(tail, flights);
  const hp = calcHealthProposed(tail, flights);
  if (faultTails.has(tail)) {
    faultyCur.push(hc);
    faultyProp.push(hp);
  } else {
    healthyCur.push(hc);
    healthyProp.push(hp);
  }
}

// ─── 7. Print results ───

console.log('');
console.log('='.repeat(120));
console.log('ARIZA TESPIT SIMULASYONU');
console.log('Sadece ucus verisi icerisindeki arizalar dahil: ' + faults.length + ' ariza');
console.log('Ucus verisi oncesi haric: ' + excluded + ' ariza');
console.log('='.repeat(120));

const n = results.length;

console.log('');
console.log('TESPIT ORANI (ariza oncesi 30/60/90 gun icinde sinyal var mi?)');
console.log('-'.repeat(110));
console.log(
  'Pencere'.padEnd(15) +
  '|  MEVCUT KRITERLER                       |  ONERILEN KRITERLER                      |  FARK'
);
console.log(
  ''.padEnd(15) +
  '|  Kritik     Uyari      Herhangi          |  Kritik     Uyari      Herhangi           |'
);
console.log('-'.repeat(110));

const windows = [
  { label: 'Son 30 gun', cc: 'cur_c30', cw: 'cur_w30', ca: 'cur_any30', pc: 'prop_c30', pw: 'prop_w30', pa: 'prop_any30' },
  { label: 'Son 60 gun', cc: 'cur_c60', cw: 'cur_w60', ca: 'cur_any60', pc: 'prop_c60', pw: 'prop_w60', pa: 'prop_any60' },
  { label: 'Son 90 gun', cc: 'cur_c90', cw: 'cur_w90', ca: 'cur_any90', pc: 'prop_c90', pw: 'prop_w90', pa: 'prop_any90' },
] as const;

for (const w of windows) {
  const curCrit = results.filter(r => (r as any)[w.cc] > 0).length;
  const curWarn = results.filter(r => (r as any)[w.cw] > 0).length;
  const curAny = results.filter(r => (r as any)[w.ca]).length;
  const propCrit = results.filter(r => (r as any)[w.pc] > 0).length;
  const propWarn = results.filter(r => (r as any)[w.pw] > 0).length;
  const propAny = results.filter(r => (r as any)[w.pa]).length;

  const critDiff = propCrit - curCrit;
  const anyDiff = propAny - curAny;

  console.log(
    w.label.padEnd(15) +
    '|  ' + (curCrit + '/' + n).padEnd(7) + pct(curCrit, n).padStart(6) + '   ' +
    (curWarn + '/' + n).padEnd(7) + pct(curWarn, n).padStart(6) + '   ' +
    (curAny + '/' + n).padEnd(7) + pct(curAny, n).padStart(6) +
    '   |  ' + (propCrit + '/' + n).padEnd(7) + pct(propCrit, n).padStart(6) + '   ' +
    (propWarn + '/' + n).padEnd(7) + pct(propWarn, n).padStart(6) + '   ' +
    (propAny + '/' + n).padEnd(7) + pct(propAny, n).padStart(6) +
    '   |  C:' + (critDiff >= 0 ? '+' : '') + critDiff + ' Any:' + (anyDiff >= 0 ? '+' : '') + anyDiff
  );
}

// ─── 8. Newly detected faults ───
const newDetect90 = results.filter(r => !r.cur_any90 && r.prop_any90);
const newDetect60 = results.filter(r => !r.cur_any60 && r.prop_any60);
const newDetect30 = results.filter(r => !r.cur_any30 && r.prop_any30);

if (newDetect90.length > 0) {
  console.log('');
  console.log('YENI TESPIT EDILEN ARIZALAR (90g pencere, onerilen kriterlerle):');
  for (const r of newDetect90) {
    console.log('  ' + r.fault.tail + ' ' + r.fault.date + ' | PropC90:' + r.prop_c90 + ' PropW90:' + r.prop_w90 + ' | ' + r.fault.desc.substring(0, 80));
  }
}

// ─── 9. Undetectable faults ───
const undetectedCur = results.filter(r => !r.cur_any90);
const undetectedProp = results.filter(r => !r.prop_any90);

console.log('');
console.log('TESPIT EDILEMEYEN ARIZALAR (90g pencere): MEVCUT ' + undetectedCur.length + '/' + n + '  ONERILEN ' + undetectedProp.length + '/' + n);
console.log('-'.repeat(110));
for (const r of undetectedProp) {
  const postCur = r.cur_cAfter30;
  const postProp = r.prop_cAfter30;
  console.log(
    '  ' + r.fault.tail.padEnd(10) + r.fault.date.padEnd(12) +
    'Ucus:' + String(r.tailFlights).padStart(5) +
    '  SonraCrit(30g): Cur=' + postCur + ' Prop=' + postProp +
    '  | ' + r.fault.desc.substring(0, 70)
  );
}

// ─── 10. False positive: Health scores ───
console.log('');
console.log('='.repeat(120));
console.log('SAGLIK SKORU KARSILASTIRMASI');
console.log('='.repeat(120));

function riskDist(arr: HealthResult[]): { crit: number; high: number; med: number; low: number } {
  return {
    crit: arr.filter(h => h.risk === 'CRITICAL').length,
    high: arr.filter(h => h.risk === 'HIGH').length,
    med: arr.filter(h => h.risk === 'MEDIUM').length,
    low: arr.filter(h => h.risk === 'LOW').length,
  };
}

console.log('');
console.log('ARIZASI OLMAYAN UCAKLAR (' + healthyCur.length + ' ucak) — Yanlis Pozitif:');
console.log('-'.repeat(80));
const hcD = riskDist(healthyCur);
const hpD = riskDist(healthyProp);
console.log('              MEVCUT                   ONERILEN                FARK');
console.log('  CRITICAL:   ' + String(hcD.crit).padStart(3) + ' (' + pct(hcD.crit, healthyCur.length).padStart(6) + ')           ' + String(hpD.crit).padStart(3) + ' (' + pct(hpD.crit, healthyProp.length).padStart(6) + ')           ' + (hpD.crit - hcD.crit));
console.log('  HIGH:       ' + String(hcD.high).padStart(3) + ' (' + pct(hcD.high, healthyCur.length).padStart(6) + ')           ' + String(hpD.high).padStart(3) + ' (' + pct(hpD.high, healthyProp.length).padStart(6) + ')           ' + (hpD.high - hcD.high));
console.log('  MEDIUM:     ' + String(hcD.med).padStart(3) + ' (' + pct(hcD.med, healthyCur.length).padStart(6) + ')           ' + String(hpD.med).padStart(3) + ' (' + pct(hpD.med, healthyProp.length).padStart(6) + ')           ' + (hpD.med - hcD.med));
console.log('  LOW:        ' + String(hcD.low).padStart(3) + ' (' + pct(hcD.low, healthyCur.length).padStart(6) + ')           ' + String(hpD.low).padStart(3) + ' (' + pct(hpD.low, healthyProp.length).padStart(6) + ')           ' + (hpD.low - hcD.low));

console.log('');
console.log('ARIZASI OLAN UCAKLAR (' + faultyCur.length + ' ucak) — Dogru Tespit:');
console.log('-'.repeat(80));
const fcD = riskDist(faultyCur);
const fpD = riskDist(faultyProp);
console.log('              MEVCUT                   ONERILEN                FARK');
console.log('  CRITICAL:   ' + String(fcD.crit).padStart(3) + ' (' + pct(fcD.crit, faultyCur.length).padStart(6) + ')           ' + String(fpD.crit).padStart(3) + ' (' + pct(fpD.crit, faultyProp.length).padStart(6) + ')           ' + (fpD.crit - fcD.crit));
console.log('  HIGH:       ' + String(fcD.high).padStart(3) + ' (' + pct(fcD.high, faultyCur.length).padStart(6) + ')           ' + String(fpD.high).padStart(3) + ' (' + pct(fpD.high, faultyProp.length).padStart(6) + ')           ' + (fpD.high - fcD.high));
console.log('  MEDIUM:     ' + String(fcD.med).padStart(3) + ' (' + pct(fcD.med, faultyCur.length).padStart(6) + ')           ' + String(fpD.med).padStart(3) + ' (' + pct(fpD.med, faultyProp.length).padStart(6) + ')           ' + (fpD.med - fcD.med));
console.log('  LOW:        ' + String(fcD.low).padStart(3) + ' (' + pct(fcD.low, faultyCur.length).padStart(6) + ')           ' + String(fpD.low).padStart(3) + ' (' + pct(fpD.low, faultyProp.length).padStart(6) + ')           ' + (fpD.low - fcD.low));

// Detailed health: faulty tails sorted by current score
console.log('');
console.log('ARIZALI UCAK DETAY (saglik skoru):');
console.log('-'.repeat(120));
console.log(
  'Kuyruk'.padEnd(10) +
  'Ariza#'.padStart(7) +
  '  |  CUR: Skor  Risk     Crit Warn  AvgPFD  Worst' +
  '  |  PROP: Skor  Risk     Crit Warn  AvgPFD  Worst'
);
console.log('-'.repeat(120));

const faultCountByTail = new Map<string, number>();
for (const f of allFaults) faultCountByTail.set(f.tail, (faultCountByTail.get(f.tail) || 0) + 1);

faultyCur.sort((a, b) => a.score - b.score);
for (const hc of faultyCur) {
  const hp = faultyProp.find(h => h.tail === hc.tail)!;
  const fc = faultCountByTail.get(hc.tail) || 0;
  console.log(
    hc.tail.padEnd(10) +
    String(fc).padStart(7) +
    '  |  ' + hc.score.toFixed(1).padStart(5) + '  ' + hc.risk.padEnd(9) + String(hc.critCount).padStart(4) + String(hc.warnCount).padStart(5) + '  ' + hc.avgPfd.toFixed(1).padStart(6) + '  ' + hc.worstPfd.toFixed(1).padStart(5) +
    '  |  ' + hp.score.toFixed(1).padStart(5) + '  ' + hp.risk.padEnd(9) + String(hp.critCount).padStart(4) + String(hp.warnCount).padStart(5) + '  ' + hp.avgPfd.toFixed(1).padStart(6) + '  ' + hp.worstPfd.toFixed(1).padStart(5)
  );
}

// ─── 11. Fleet anomaly % ───
console.log('');
console.log('='.repeat(80));
console.log('FILO ANOMALI DAGILIMI (97515 ucus)');
console.log('='.repeat(80));

let cN = 0, cW = 0, cC = 0, pN = 0, pW = 0, pC = 0;
for (const f of allFlights) {
  const cs = currentScore(f); const ps = proposedScore(f);
  if (cs >= 40) cC++; else if (cs >= 16) cW++; else cN++;
  if (ps >= 40) pC++; else if (ps >= 16) pW++; else pN++;
}

console.log('');
console.log('                  MEVCUT                  ONERILEN                 FARK');
console.log('  Normal:     ' + String(cN).padStart(7) + ' (' + pct(cN, allFlights.length).padStart(6) + ')        ' + String(pN).padStart(7) + ' (' + pct(pN, allFlights.length).padStart(6) + ')        ' + (pN - cN));
console.log('  Warning:    ' + String(cW).padStart(7) + ' (' + pct(cW, allFlights.length).padStart(6) + ')        ' + String(pW).padStart(7) + ' (' + pct(pW, allFlights.length).padStart(6) + ')        +' + (pW - cW));
console.log('  Critical:   ' + String(cC).padStart(7) + ' (' + pct(cC, allFlights.length).padStart(6) + ')        ' + String(pC).padStart(7) + ' (' + pct(pC, allFlights.length).padStart(6) + ')        +' + (pC - cC));

// ─── 12. Final summary ───
console.log('');
console.log('='.repeat(100));
console.log('NIHAI OZET');
console.log('='.repeat(100));

const cur90Any = results.filter(r => r.cur_any90).length;
const prop90Any = results.filter(r => r.prop_any90).length;
const cur60Any = results.filter(r => r.cur_any60).length;
const prop60Any = results.filter(r => r.prop_any60).length;
const cur30Any = results.filter(r => r.cur_any30).length;
const prop30Any = results.filter(r => r.prop_any30).length;

console.log('');
console.log('ARIZA TESPIT (' + n + ' ariza, sadece ucus verisi icindekiler):');
console.log('  90g: MEVCUT ' + cur90Any + '/' + n + ' (' + pct(cur90Any, n) + ')  ->  ONERILEN ' + prop90Any + '/' + n + ' (' + pct(prop90Any, n) + ')  [+' + (prop90Any - cur90Any) + ']');
console.log('  60g: MEVCUT ' + cur60Any + '/' + n + ' (' + pct(cur60Any, n) + ')  ->  ONERILEN ' + prop60Any + '/' + n + ' (' + pct(prop60Any, n) + ')  [+' + (prop60Any - cur60Any) + ']');
console.log('  30g: MEVCUT ' + cur30Any + '/' + n + ' (' + pct(cur30Any, n) + ')  ->  ONERILEN ' + prop30Any + '/' + n + ' (' + pct(prop30Any, n) + ')  [+' + (prop30Any - cur30Any) + ']');

console.log('');
console.log('YANLIS POZITIF (' + healthyCur.length + ' arizasiz ucak):');
console.log('  CRITICAL: MEVCUT ' + hcD.crit + ' (' + pct(hcD.crit, healthyCur.length) + ')  ->  ONERILEN ' + hpD.crit + ' (' + pct(hpD.crit, healthyCur.length) + ')  [' + (hpD.crit - hcD.crit) + ']');
console.log('  LOW:      MEVCUT ' + hcD.low + ' (' + pct(hcD.low, healthyCur.length) + ')  ->  ONERILEN ' + hpD.low + ' (' + pct(hpD.low, healthyCur.length) + ')  [+' + (hpD.low - hcD.low) + ']');

console.log('');
console.log('DOGRU TESPIT (' + faultyCur.length + ' arizali ucak):');
console.log('  CRITICAL+HIGH: MEVCUT ' + (fcD.crit + fcD.high) + '/' + faultyCur.length + ' (' + pct(fcD.crit + fcD.high, faultyCur.length) + ')  ->  ONERILEN ' + (fpD.crit + fpD.high) + '/' + faultyProp.length + ' (' + pct(fpD.crit + fpD.high, faultyProp.length) + ')');
console.log('  LOW:           MEVCUT ' + fcD.low + '/' + faultyCur.length + ' (' + pct(fcD.low, faultyCur.length) + ')  ->  ONERILEN ' + fpD.low + '/' + faultyProp.length + ' (' + pct(fpD.low, faultyProp.length) + ')');

console.log('');
console.log('FILO ANOMALI ORANI:');
console.log('  Warning:  ' + pct(cW, allFlights.length) + '  ->  ' + pct(pW, allFlights.length));
console.log('  Critical: ' + pct(cC, allFlights.length) + '  ->  ' + pct(pC, allFlights.length));

console.log('');
console.log('Simulasyon tamamlandi.');
