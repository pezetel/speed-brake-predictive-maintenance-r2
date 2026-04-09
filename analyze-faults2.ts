// Analyze speedbrake fault records vs flight data anomaly detections
// Fixed: TC- prefix + align based on flight data date range
// Run: npx tsx analyze-faults2.ts

import * as XLSX from 'xlsx';
import { parseExcelData, computeSummary } from './lib/utils';
import { FlightRecord } from './lib/types';

const FAULT_FILE = 'speedbrake ar\u0131zalar\u0131 filtreli.xlsx';
const DATA_FILE = 'speed brake info.xlsx';

// ─── 1. Read flight data first (to know date range) ───
console.log('Reading flight data: ' + DATA_FILE);
const dataWb = XLSX.readFile(DATA_FILE);
let allFlights: FlightRecord[] = [];

for (const sheetName of dataWb.SheetNames) {
  const ws = dataWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const records = parseExcelData(rows);
  allFlights = allFlights.concat(records);
}
console.log('  Total flights: ' + allFlights.length);

// Find flight data date range
let minFlightDate = '9999-99-99';
let maxFlightDate = '0000-00-00';
for (const f of allFlights) {
  if (f.flightDate < minFlightDate) minFlightDate = f.flightDate;
  if (f.flightDate > maxFlightDate) maxFlightDate = f.flightDate;
}
console.log('  Flight data range: ' + minFlightDate + ' to ' + maxFlightDate);

// Group flights by tail
const flightsByTail = new Map<string, FlightRecord[]>();
for (const f of allFlights) {
  let arr = flightsByTail.get(f.tailNumber);
  if (!arr) { arr = []; flightsByTail.set(f.tailNumber, arr); }
  arr.push(f);
}
for (const [, arr] of flightsByTail) {
  arr.sort((a, b) => a.flightDate.localeCompare(b.flightDate));
}

// ─── 2. Read fault records ───
console.log('');
console.log('Reading fault file: ' + FAULT_FILE);
const faultWb = XLSX.readFile(FAULT_FILE);

interface FaultRecord {
  tailNumber: string;
  faultDate: string;
  description: string;
  ata: string;
  wo: string;
}

const faults: FaultRecord[] = [];

for (const sheetName of faultWb.SheetNames) {
  const ws = faultWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  console.log('  Sheet "' + sheetName + '": ' + rows.length + ' rows');

  for (const row of rows) {
    let tail = String(row['A/C'] || '').trim().toUpperCase();
    let wo = String(row['W/O'] || '').trim();
    let ata = String(row['ATA'] || '').trim();
    let desc = String(row['Description'] || '').trim();
    let date = '';

    // Parse date
    const dateVal = row['Date'];
    if (typeof dateVal === 'number' && dateVal > 40000 && dateVal < 50000) {
      const d = new Date((dateVal - 25569) * 86400 * 1000);
      date = d.toISOString().split('T')[0];
    } else if (dateVal instanceof Date) {
      date = dateVal.toISOString().split('T')[0];
    } else {
      const s = String(dateVal || '').trim();
      const parts = s.split('.');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        date = year + '-' + month + '-' + day;
      }
    }

    // Add TC- prefix if missing
    if (tail && !tail.startsWith('TC-')) {
      tail = 'TC-' + tail;
    }

    // Clean description (remove <br> tags)
    desc = desc.replace(/<br>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();

    if (tail && date) {
      faults.push({ tailNumber: tail, faultDate: date, description: desc, ata, wo });
    }
  }
}

// Sort faults by date
faults.sort((a, b) => a.faultDate.localeCompare(b.faultDate));

console.log('  Total fault records: ' + faults.length);
console.log('');

// ─── 3. Classify faults by relationship to flight data ───
// Faults BEFORE flight data start -> can only check "after fault" signals
// Faults WITHIN flight data range -> can check both before and after
// Faults AFTER flight data end -> can only check "before fault" signals

const faultsBeforeData = faults.filter(f => f.faultDate < minFlightDate);
const faultsWithinData = faults.filter(f => f.faultDate >= minFlightDate && f.faultDate <= maxFlightDate);
const faultsAfterData = faults.filter(f => f.faultDate > maxFlightDate);

console.log('Fault distribution vs flight data range (' + minFlightDate + ' to ' + maxFlightDate + '):');
console.log('  Before flight data: ' + faultsBeforeData.length + ' faults (can check post-fault signals)');
console.log('  Within flight data: ' + faultsWithinData.length + ' faults (can check pre+post fault signals)');
console.log('  After flight data:  ' + faultsAfterData.length + ' faults (can check pre-fault signals)');

function daysDiff(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

interface FlightSignal {
  flight: FlightRecord;
  daysFromFault: number; // negative = before fault, positive = after fault
}

interface FaultAnalysis {
  fault: FaultRecord;
  category: 'before_data' | 'within_data' | 'after_data';
  tailFlightCount: number;
  tailFirstFlight: string;
  tailLastFlight: string;
  // Pre-fault signals (flights before fault date with anomalies)
  criticalsBefore: FlightSignal[];
  warningsBefore: FlightSignal[];
  firstCriticalBefore: FlightSignal | null;
  firstWarningBefore: FlightSignal | null;
  // Post-fault signals (did anomalies continue/appear after fault?)
  criticalsAfter: FlightSignal[];
  warningsAfter: FlightSignal[];
  // Window counts (pre-fault)
  crit30d: number;
  crit60d: number;
  crit90d: number;
  warn30d: number;
  warn60d: number;
  warn90d: number;
  // PFD trend before fault
  avgPfd30d: number;
  avgPfd60d: number;
  avgPfdAll: number;
}

function analyzeFault(fault: FaultRecord): FaultAnalysis {
  const flights = flightsByTail.get(fault.tailNumber) || [];

  let category: FaultAnalysis['category'] = 'within_data';
  if (fault.faultDate < minFlightDate) category = 'before_data';
  else if (fault.faultDate > maxFlightDate) category = 'after_data';

  const criticalsBefore: FlightSignal[] = [];
  const warningsBefore: FlightSignal[] = [];
  const criticalsAfter: FlightSignal[] = [];
  const warningsAfter: FlightSignal[] = [];

  const flights30d: FlightRecord[] = [];
  const flights60d: FlightRecord[] = [];

  for (const f of flights) {
    const diff = daysDiff(fault.faultDate, f.flightDate); // positive = flight is before fault

    if (diff > 0) {
      // Flight is BEFORE fault
      if (f.anomalyLevel === 'critical') {
        criticalsBefore.push({ flight: f, daysFromFault: -diff });
      } else if (f.anomalyLevel === 'warning') {
        warningsBefore.push({ flight: f, daysFromFault: -diff });
      }
      if (diff <= 30) flights30d.push(f);
      if (diff <= 60) flights60d.push(f);
    } else if (diff < 0) {
      // Flight is AFTER fault
      if (f.anomalyLevel === 'critical') {
        criticalsAfter.push({ flight: f, daysFromFault: -diff });
      } else if (f.anomalyLevel === 'warning') {
        warningsAfter.push({ flight: f, daysFromFault: -diff });
      }
    }
  }

  // Sort: most recent before fault first
  criticalsBefore.sort((a, b) => b.daysFromFault - a.daysFromFault); // closest to fault first (least negative)
  warningsBefore.sort((a, b) => b.daysFromFault - a.daysFromFault);
  criticalsAfter.sort((a, b) => a.daysFromFault - b.daysFromFault); // soonest after fault first
  warningsAfter.sort((a, b) => a.daysFromFault - b.daysFromFault);

  // First signals (earliest in time = furthest before fault)
  const firstCriticalBefore = criticalsBefore.length > 0 ? criticalsBefore[criticalsBefore.length - 1] : null;
  const firstWarningBefore = warningsBefore.length > 0 ? warningsBefore[warningsBefore.length - 1] : null;

  // Window counts
  const crit30d = criticalsBefore.filter(c => Math.abs(c.daysFromFault) <= 30).length;
  const crit60d = criticalsBefore.filter(c => Math.abs(c.daysFromFault) <= 60).length;
  const crit90d = criticalsBefore.filter(c => Math.abs(c.daysFromFault) <= 90).length;
  const warn30d = warningsBefore.filter(w => Math.abs(w.daysFromFault) <= 30).length;
  const warn60d = warningsBefore.filter(w => Math.abs(w.daysFromFault) <= 60).length;
  const warn90d = warningsBefore.filter(w => Math.abs(w.daysFromFault) <= 90).length;

  // Avg PFD in windows
  const pfd30 = flights30d.length > 0 ? flights30d.reduce((s, f) => s + f.normalizedPfd, 0) / flights30d.length : 0;
  const pfd60 = flights60d.length > 0 ? flights60d.reduce((s, f) => s + f.normalizedPfd, 0) / flights60d.length : 0;
  const allPfd = flights.filter(f => f.normalizedPfd > 0 && f.normalizedPfd <= 105);
  const pfdAll = allPfd.length > 0 ? allPfd.reduce((s, f) => s + f.normalizedPfd, 0) / allPfd.length : 0;

  const tailFirstFlight = flights.length > 0 ? flights[0].flightDate : '-';
  const tailLastFlight = flights.length > 0 ? flights[flights.length - 1].flightDate : '-';

  return {
    fault,
    category,
    tailFlightCount: flights.length,
    tailFirstFlight,
    tailLastFlight,
    criticalsBefore,
    warningsBefore,
    firstCriticalBefore,
    firstWarningBefore,
    criticalsAfter,
    warningsAfter,
    crit30d, crit60d, crit90d,
    warn30d, warn60d, warn90d,
    avgPfd30d: pfd30,
    avgPfd60d: pfd60,
    avgPfdAll: pfdAll,
  };
}

// ─── 4. Run analysis ───
const allAnalyses = faults.map(f => analyzeFault(f));

// ─── 5. Print results ───

// === FAULTS BEFORE FLIGHT DATA (check post-fault signals) ===
console.log('');
console.log('='.repeat(120));
console.log('A) ARIZALAR UCUS VERISI ONCESINDE (' + faultsBeforeData.length + ' ariza)');
console.log('   Ucus verisi ' + minFlightDate + ' tarihinde basliyor. Bu arizalar oncesinde ucus verisi yok.');
console.log('   Sadece ariza SONRASI sinyallere bakiyoruz (sorun devam ediyor mu?)');
console.log('='.repeat(120));

const beforeAnalyses = allAnalyses.filter(a => a.category === 'before_data');
for (const a of beforeAnalyses) {
  const daysToDataStart = daysDiff(minFlightDate, a.fault.faultDate);
  console.log('');
  console.log('-'.repeat(100));
  console.log(a.fault.tailNumber + ' | Ariza: ' + a.fault.faultDate + ' | Ucus verisi ' + daysToDataStart + 'g sonra basliyor | Ucus sayisi: ' + a.tailFlightCount);
  console.log('  Aciklama: ' + a.fault.description.substring(0, 120));

  if (a.criticalsAfter.length > 0 || a.warningsAfter.length > 0) {
    console.log('  ARIZA SONRASI SINYALLER (sorun devam ediyor olabilir):');
    console.log('    Kritik: ' + a.criticalsAfter.length + ' ucus  |  Uyari: ' + a.warningsAfter.length + ' ucus');
    // Show first few critical after fault
    for (const c of a.criticalsAfter.slice(0, 5)) {
      const f = c.flight;
      console.log('    [CRIT] ' + f.flightDate + ' (+' + c.daysFromFault + 'g) ' + f.takeoffAirport + '->' + f.landingAirport + ' PFD:' + f.normalizedPfd.toFixed(1) + '% Aci:' + f.pfdTurn1Deg.toFixed(1) + ' Ratio:' + f.durationRatio.toFixed(2) + 'x');
      console.log('           ' + f.anomalyReasons.join(' | '));
    }
    for (const w of a.warningsAfter.slice(0, 3)) {
      const f = w.flight;
      console.log('    [WARN] ' + f.flightDate + ' (+' + w.daysFromFault + 'g) ' + f.takeoffAirport + '->' + f.landingAirport + ' | ' + f.anomalyReasons.join(' | '));
    }
  } else {
    console.log('  Ariza sonrasi anomali sinyali YOK (sorun giderilmis olabilir)');
  }
}

// === FAULTS WITHIN FLIGHT DATA (check both before and after) ===
console.log('');
console.log('='.repeat(120));
console.log('B) ARIZALAR UCUS VERISI ICERISINDE (' + faultsWithinData.length + ' ariza)');
console.log('   Hem ariza oncesi hem sonrasi sinyallere bakiyoruz.');
console.log('='.repeat(120));

const withinAnalyses = allAnalyses.filter(a => a.category === 'within_data');
for (const a of withinAnalyses) {
  console.log('');
  console.log('-'.repeat(100));
  console.log(a.fault.tailNumber + ' | Ariza: ' + a.fault.faultDate + ' | Toplam ucus: ' + a.tailFlightCount + ' | Ort PFD: ' + a.avgPfdAll.toFixed(1) + '%');
  console.log('  W/O: ' + a.fault.wo + ' | ATA: ' + a.fault.ata);
  console.log('  Aciklama: ' + a.fault.description.substring(0, 140));
  console.log('');

  // Pre-fault signals
  if (a.firstCriticalBefore) {
    const lead = Math.abs(a.firstCriticalBefore.daysFromFault);
    console.log('  >> ILK KRITIK SINYAL: ' + a.firstCriticalBefore.flight.flightDate + ' (' + lead + ' gun ONCE)');
    const f = a.firstCriticalBefore.flight;
    console.log('     ' + f.takeoffAirport + '->' + f.landingAirport + ' PFD:' + f.normalizedPfd.toFixed(1) + '% Aci:' + f.pfdTurn1Deg.toFixed(1) + ' Ratio:' + f.durationRatio.toFixed(2) + 'x');
    console.log('     ' + f.anomalyReasons.join(' | '));
  } else {
    console.log('  >> ILK KRITIK SINYAL: YOK');
  }

  if (a.firstWarningBefore) {
    const lead = Math.abs(a.firstWarningBefore.daysFromFault);
    console.log('  >> ILK UYARI SINYAL: ' + a.firstWarningBefore.flight.flightDate + ' (' + lead + ' gun ONCE)');
    console.log('     ' + a.firstWarningBefore.flight.anomalyReasons.join(' | '));
  } else {
    console.log('  >> ILK UYARI SINYAL: YOK');
  }

  console.log('');
  console.log('  Ariza oncesi sinyal yogunlugu:');
  console.log('    Son 30g: ' + a.crit30d + ' kritik, ' + a.warn30d + ' uyari  |  Ort PFD(30g): ' + a.avgPfd30d.toFixed(1) + '%');
  console.log('    Son 60g: ' + a.crit60d + ' kritik, ' + a.warn60d + ' uyari  |  Ort PFD(60g): ' + a.avgPfd60d.toFixed(1) + '%');
  console.log('    Son 90g: ' + a.crit90d + ' kritik, ' + a.warn90d + ' uyari');
  console.log('    Toplam:  ' + a.criticalsBefore.length + ' kritik, ' + a.warningsBefore.length + ' uyari');

  // Last 5 critical before fault (closest to fault)
  if (a.criticalsBefore.length > 0) {
    console.log('');
    console.log('  Son kritik ucuslar (arizaya en yakin):');
    for (const c of a.criticalsBefore.slice(0, 8)) {
      const f = c.flight;
      console.log('    ' + f.flightDate + ' (' + Math.abs(c.daysFromFault) + 'g once) ' + f.takeoffAirport + '->' + f.landingAirport + ' PFD:' + f.normalizedPfd.toFixed(1) + '% Aci:' + f.pfdTurn1Deg.toFixed(1) + ' Ratio:' + f.durationRatio.toFixed(2) + 'x');
      console.log('      ' + f.anomalyReasons.join(' | '));
    }
    if (a.criticalsBefore.length > 8) {
      console.log('    ... ve ' + (a.criticalsBefore.length - 8) + ' tane daha');
    }
  }

  // Post-fault
  if (a.criticalsAfter.length > 0) {
    console.log('');
    console.log('  Ariza SONRASI kritik ucuslar:');
    for (const c of a.criticalsAfter.slice(0, 5)) {
      const f = c.flight;
      console.log('    ' + f.flightDate + ' (+' + c.daysFromFault + 'g) ' + f.takeoffAirport + '->' + f.landingAirport + ' PFD:' + f.normalizedPfd.toFixed(1) + '% Aci:' + f.pfdTurn1Deg.toFixed(1));
    }
  } else {
    console.log('');
    console.log('  Ariza sonrasi kritik ucus YOK (tamir edilmis olabilir)');
  }
}

// === FAULTS AFTER FLIGHT DATA ===
if (faultsAfterData.length > 0) {
  console.log('');
  console.log('='.repeat(120));
  console.log('C) ARIZALAR UCUS VERISI SONRASINDA (' + faultsAfterData.length + ' ariza)');
  console.log('   Ucus verisi ' + maxFlightDate + ' tarihinde bitiyor. Sadece ariza oncesi sinyallere bakiyoruz.');
  console.log('='.repeat(120));

  const afterAnalyses = allAnalyses.filter(a => a.category === 'after_data');
  for (const a of afterAnalyses) {
    console.log('');
    console.log('-'.repeat(100));
    console.log(a.fault.tailNumber + ' | Ariza: ' + a.fault.faultDate + ' | Toplam ucus: ' + a.tailFlightCount);
    console.log('  Aciklama: ' + a.fault.description.substring(0, 120));
    console.log('  Toplam: ' + a.criticalsBefore.length + ' kritik, ' + a.warningsBefore.length + ' uyari (tum ucus verisi ariza oncesi)');
  }
}

// ─── 6. SUMMARY TABLE ───
console.log('');
console.log('='.repeat(140));
console.log('OZET TABLO — TUM ARIZALAR');
console.log('='.repeat(140));
console.log(
  'Kuyruk'.padEnd(10) +
  'ArizaTrh'.padEnd(12) +
  'Konum'.padEnd(8) +
  'Ucus'.padStart(6) +
  '  ' +
  'IlkCritTrh'.padEnd(12) +
  'Lead'.padStart(5) +
  '  ' +
  'IlkWarnTrh'.padEnd(12) +
  'Lead'.padStart(5) +
  '  ' +
  'C<30'.padStart(5) +
  'C<60'.padStart(5) +
  'C<90'.padStart(5) +
  'CAll'.padStart(5) +
  '  ' +
  'W<30'.padStart(5) +
  'W<60'.padStart(5) +
  'WAll'.padStart(5) +
  '  ' +
  'CAftr'.padStart(6) +
  '  PFD30'.padStart(7) +
  '  ' +
  'Aciklama'
);
console.log('-'.repeat(140));

for (const a of allAnalyses) {
  const firstCritLead = a.firstCriticalBefore ? String(Math.abs(a.firstCriticalBefore.daysFromFault)) : '-';
  const firstWarnLead = a.firstWarningBefore ? String(Math.abs(a.firstWarningBefore.daysFromFault)) : '-';
  const firstCritDate = a.firstCriticalBefore ? a.firstCriticalBefore.flight.flightDate.substring(5) : '-';
  const firstWarnDate = a.firstWarningBefore ? a.firstWarningBefore.flight.flightDate.substring(5) : '-';

  let konum = 'WITHIN';
  if (a.category === 'before_data') konum = 'BEFORE';
  if (a.category === 'after_data') konum = 'AFTER';

  console.log(
    a.fault.tailNumber.padEnd(10) +
    a.fault.faultDate.substring(2).padEnd(12) +
    konum.padEnd(8) +
    String(a.tailFlightCount).padStart(6) +
    '  ' +
    firstCritDate.padEnd(12) +
    firstCritLead.padStart(5) +
    '  ' +
    firstWarnDate.padEnd(12) +
    firstWarnLead.padStart(5) +
    '  ' +
    String(a.crit30d).padStart(5) +
    String(a.crit60d).padStart(5) +
    String(a.crit90d).padStart(5) +
    String(a.criticalsBefore.length).padStart(5) +
    '  ' +
    String(a.warn30d).padStart(5) +
    String(a.warn60d).padStart(5) +
    String(a.warningsBefore.length).padStart(5) +
    '  ' +
    String(a.criticalsAfter.length).padStart(6) +
    ('  ' + (a.avgPfd30d > 0 ? a.avgPfd30d.toFixed(1) : '-')).padStart(7) +
    '  ' +
    a.fault.description.substring(0, 35)
  );
}

// ─── 7. LEAD TIME STATISTICS ───
console.log('');
console.log('='.repeat(100));
console.log('LEAD TIME ISTATISTIKLERI');
console.log('='.repeat(100));

// Only consider faults that have flight data before them
const withPreData = allAnalyses.filter(a => a.criticalsBefore.length > 0 || a.warningsBefore.length > 0);
const withCritBefore = allAnalyses.filter(a => a.criticalsBefore.length > 0);
const withWarnBefore = allAnalyses.filter(a => a.warningsBefore.length > 0);
const withAnyBefore = allAnalyses.filter(a => a.criticalsBefore.length > 0 || a.warningsBefore.length > 0);
const totalWithFlightData = allAnalyses.filter(a => a.tailFlightCount > 0);

console.log('');
console.log('Toplam ariza: ' + allAnalyses.length);
console.log('Ucus verisi olan: ' + totalWithFlightData.length + ' / ' + allAnalyses.length);
console.log('Ariza oncesi KRITIK sinyal olan: ' + withCritBefore.length + ' / ' + totalWithFlightData.length + ' (' + ((withCritBefore.length / Math.max(totalWithFlightData.length, 1)) * 100).toFixed(0) + '%)');
console.log('Ariza oncesi UYARI sinyal olan: ' + withWarnBefore.length + ' / ' + totalWithFlightData.length + ' (' + ((withWarnBefore.length / Math.max(totalWithFlightData.length, 1)) * 100).toFixed(0) + '%)');
console.log('Ariza oncesi HERHANGI sinyal: ' + withAnyBefore.length + ' / ' + totalWithFlightData.length + ' (' + ((withAnyBefore.length / Math.max(totalWithFlightData.length, 1)) * 100).toFixed(0) + '%)');

if (withCritBefore.length > 0) {
  const leadTimes = withCritBefore.map(a => Math.abs(a.firstCriticalBefore!.daysFromFault));
  leadTimes.sort((a, b) => a - b);
  const avg = leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length;
  const median = leadTimes[Math.floor(leadTimes.length / 2)];

  console.log('');
  console.log('ILK KRITIK SINYAL -> ARIZA ARASI SURE:');
  console.log('  Minimum:  ' + leadTimes[0] + ' gun');
  console.log('  Medyan:   ' + median + ' gun');
  console.log('  Ortalama: ' + avg.toFixed(1) + ' gun');
  console.log('  Maksimum: ' + leadTimes[leadTimes.length - 1] + ' gun');

  console.log('');
  console.log('  Dagilim:');
  const buckets = [7, 14, 30, 60, 90, 120, 180, 365];
  for (const b of buckets) {
    const count = leadTimes.filter(t => t <= b).length;
    const bar = '#'.repeat(Math.round((count / leadTimes.length) * 40));
    console.log('    <=' + String(b).padStart(4) + 'g: ' + String(count).padStart(3) + '/' + leadTimes.length + ' (' + ((count / leadTimes.length) * 100).toFixed(0).padStart(3) + '%) ' + bar);
  }
}

if (withWarnBefore.length > 0) {
  const leadTimes = withWarnBefore.map(a => Math.abs(a.firstWarningBefore!.daysFromFault));
  leadTimes.sort((a, b) => a - b);
  const avg = leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length;
  const median = leadTimes[Math.floor(leadTimes.length / 2)];

  console.log('');
  console.log('ILK UYARI SINYALI -> ARIZA ARASI SURE:');
  console.log('  Minimum:  ' + leadTimes[0] + ' gun');
  console.log('  Medyan:   ' + median + ' gun');
  console.log('  Ortalama: ' + avg.toFixed(1) + ' gun');
  console.log('  Maksimum: ' + leadTimes[leadTimes.length - 1] + ' gun');
}

// ─── 8. DETECTION RATE by tail ───
console.log('');
console.log('='.repeat(100));
console.log('UCAK BAZLI TESPIT ORANI');
console.log('='.repeat(100));

// Group faults by tail
const faultsByTail = new Map<string, FaultAnalysis[]>();
for (const a of allAnalyses) {
  let arr = faultsByTail.get(a.fault.tailNumber);
  if (!arr) { arr = []; faultsByTail.set(a.fault.tailNumber, arr); }
  arr.push(a);
}

console.log('');
console.log(
  'Kuyruk'.padEnd(10) +
  'Ariza#'.padStart(7) +
  'Ucus#'.padStart(7) +
  'OnceCrit'.padStart(10) +
  'OnceWarn'.padStart(10) +
  'SonraCrit'.padStart(10) +
  'AvgPFD'.padStart(8) +
  '  Ariza Tarihleri'
);
console.log('-'.repeat(100));

const tailEntries = Array.from(faultsByTail.entries()).sort((a, b) => b[1].length - a[1].length);
for (const [tail, faultAnalyses] of tailEntries) {
  const totalCritBefore = faultAnalyses.reduce((s, a) => s + a.criticalsBefore.length, 0);
  const totalWarnBefore = faultAnalyses.reduce((s, a) => s + a.warningsBefore.length, 0);
  const totalCritAfter = faultAnalyses.reduce((s, a) => s + a.criticalsAfter.length, 0);
  const flightCount = faultAnalyses[0].tailFlightCount;
  const avgPfd = faultAnalyses[0].avgPfdAll;
  const dates = faultAnalyses.map(a => a.fault.faultDate.substring(5)).join(', ');

  console.log(
    tail.padEnd(10) +
    String(faultAnalyses.length).padStart(7) +
    String(flightCount).padStart(7) +
    String(totalCritBefore).padStart(10) +
    String(totalWarnBefore).padStart(10) +
    String(totalCritAfter).padStart(10) +
    (avgPfd > 0 ? avgPfd.toFixed(1) : '-').padStart(8) +
    '  ' + dates
  );
}

console.log('');
console.log('Analiz tamamlandi.');
