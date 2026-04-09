// Analyze speedbrake fault records vs flight data anomaly detections
// Run: npx tsx analyze-faults.ts

import * as XLSX from 'xlsx';
import { parseExcelData, computeSummary } from './lib/utils';
import { FlightRecord } from './lib/types';

const FAULT_FILE = 'speedbrake ar\u0131zalar\u0131 filtreli.xlsx';
const DATA_FILE = 'speed brake info.xlsx';

// ─── 1. Read fault records ───
console.log('Reading fault file: ' + FAULT_FILE);
const faultWb = XLSX.readFile(FAULT_FILE);

interface FaultRecord {
  tailNumber: string;
  faultDate: string;
  description: string;
  rawRow: any;
}

const faults: FaultRecord[] = [];

for (const sheetName of faultWb.SheetNames) {
  const ws = faultWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  console.log('  Sheet "' + sheetName + '": ' + rows.length + ' rows');
  if (rows.length > 0) {
    console.log('  Columns: ' + Object.keys(rows[0]).join(' | '));
  }

  // Print first 3 rows raw
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    console.log('    Row ' + i + ': ' + JSON.stringify(rows[i]));
  }

  for (const row of rows) {
    const keys = Object.keys(row);

    let tail = '';
    let date = '';
    let desc = '';

    // Try labeled columns
    for (const key of keys) {
      const upper = key.toUpperCase();
      const val = row[key];

      if (upper.includes('TAIL') || upper.includes('KUYRUK') || upper.includes('AC_REG') || upper.includes('REGISTRATION') || upper.includes('A/C')) {
        tail = String(val || '').trim().toUpperCase();
      }
      if (upper.includes('DATE') || upper.includes('TARIH') || upper.includes('FAULT') || upper.includes('REPORT')) {
        if (val instanceof Date) {
          date = val.toISOString().split('T')[0];
        } else if (typeof val === 'number' && val > 40000 && val < 50000) {
          const d = new Date((val - 25569) * 86400 * 1000);
          date = d.toISOString().split('T')[0];
        } else {
          const s = String(val || '').trim();
          const parts = s.split('.');
          if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
            date = year + '-' + month + '-' + day;
          } else if (s.includes('-')) {
            date = s;
          } else if (s.includes('/')) {
            const p = s.split('/');
            if (p.length === 3) {
              date = (p[2].length === 2 ? '20' + p[2] : p[2]) + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0');
            }
          }
        }
      }
      if (upper.includes('DESC') || upper.includes('FAULT') || upper.includes('ARIZA') || upper.includes('DEFECT') || upper.includes('TEXT') || upper.includes('MESSAGE') || upper.includes('FINDING')) {
        if (typeof val === 'string' && val.length > 5) {
          desc = val.trim();
        }
      }
    }

    // Fallback: positional search
    if (!tail && !date) {
      for (const key of keys) {
        const val = row[key];
        const s = String(val || '').trim().toUpperCase();
        if (s.startsWith('TC-') && s.length <= 8) {
          tail = s;
        }
      }
      for (const key of keys) {
        const val = row[key];
        if (typeof val === 'number' && val > 40000 && val < 50000) {
          const d = new Date((val - 25569) * 86400 * 1000);
          date = d.toISOString().split('T')[0];
        } else if (typeof val === 'string') {
          const s = val.trim();
          const parts = s.split('.');
          if (parts.length === 3 && parts[0].length <= 2 && parts[1].length <= 2 && parts[2].length >= 2) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
            const candidate = year + '-' + month + '-' + day;
            if (candidate >= '2020-01-01' && candidate <= '2030-12-31') {
              date = candidate;
            }
          }
        }
      }
      let longestStr = '';
      for (const key of keys) {
        const val = row[key];
        if (typeof val === 'string' && val.length > longestStr.length && val !== tail && !val.match(/^\d{1,2}\.\d{1,2}\.\d{2,4}$/)) {
          longestStr = val;
        }
      }
      desc = longestStr;
    }

    if (tail || date) {
      faults.push({ tailNumber: tail, faultDate: date, description: desc, rawRow: row });
    }
  }
}

console.log('');
console.log('Total fault records parsed: ' + faults.length);
console.log('---');
console.log('ALL FAULT RECORDS:');
console.log('-'.repeat(100));
for (const f of faults) {
  console.log('  ' + (f.faultDate || 'NO_DATE') + ' | ' + (f.tailNumber || 'NO_TAIL') + ' | ' + f.description.substring(0, 100));
  if (!f.tailNumber || !f.faultDate) {
    console.log('    RAW: ' + JSON.stringify(f.rawRow));
  }
}

// ─── 2. Read flight data ───
console.log('');
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

// ─── 3. For each fault, find earliest anomaly signals ───
console.log('');
console.log('='.repeat(100));
console.log('FAULT vs ANOMALY CORRELATION ANALYSIS');
console.log('='.repeat(100));

interface FaultAnalysis {
  fault: FaultRecord;
  tailFlightCount: number;
  criticalBefore: { flight: FlightRecord; daysBefore: number }[];
  warningBefore: { flight: FlightRecord; daysBefore: number }[];
  firstCritical: { flight: FlightRecord; daysBefore: number } | null;
  firstWarning: { flight: FlightRecord; daysBefore: number } | null;
  criticalAfter: { flight: FlightRecord; daysAfter: number }[];
  criticals30d: number;
  criticals60d: number;
  criticals90d: number;
  warnings30d: number;
  warnings60d: number;
  warnings90d: number;
}

function daysDiff(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

const analyses: FaultAnalysis[] = [];

for (const fault of faults) {
  if (!fault.tailNumber || !fault.faultDate) continue;

  const flights = flightsByTail.get(fault.tailNumber) || [];

  const criticalBefore: { flight: FlightRecord; daysBefore: number }[] = [];
  const warningBefore: { flight: FlightRecord; daysBefore: number }[] = [];
  const criticalAfter: { flight: FlightRecord; daysAfter: number }[] = [];

  for (const f of flights) {
    const diff = daysDiff(fault.faultDate, f.flightDate);

    if (diff > 0) {
      if (f.anomalyLevel === 'critical') {
        criticalBefore.push({ flight: f, daysBefore: diff });
      } else if (f.anomalyLevel === 'warning') {
        warningBefore.push({ flight: f, daysBefore: diff });
      }
    } else if (diff < 0) {
      if (f.anomalyLevel === 'critical') {
        criticalAfter.push({ flight: f, daysAfter: -diff });
      }
    }
  }

  criticalBefore.sort((a, b) => b.daysBefore - a.daysBefore);
  warningBefore.sort((a, b) => b.daysBefore - a.daysBefore);
  criticalAfter.sort((a, b) => a.daysAfter - b.daysAfter);

  const firstCritical = criticalBefore.length > 0 ? criticalBefore[0] : null;
  const firstWarning = warningBefore.length > 0 ? warningBefore[0] : null;

  const criticals30d = criticalBefore.filter(c => c.daysBefore <= 30).length;
  const criticals60d = criticalBefore.filter(c => c.daysBefore <= 60).length;
  const criticals90d = criticalBefore.filter(c => c.daysBefore <= 90).length;
  const warnings30d = warningBefore.filter(w => w.daysBefore <= 30).length;
  const warnings60d = warningBefore.filter(w => w.daysBefore <= 60).length;
  const warnings90d = warningBefore.filter(w => w.daysBefore <= 90).length;

  analyses.push({
    fault,
    tailFlightCount: flights.length,
    criticalBefore,
    warningBefore,
    firstCritical,
    firstWarning,
    criticalAfter,
    criticals30d, criticals60d, criticals90d,
    warnings30d, warnings60d, warnings90d,
  });
}

// ─── 4. Print detailed analysis ───
for (const a of analyses) {
  console.log('');
  console.log('='.repeat(100));
  console.log('TAIL: ' + a.fault.tailNumber + '  |  ARIZA TARIHI: ' + a.fault.faultDate);
  console.log('Aciklama: ' + a.fault.description.substring(0, 120));
  console.log('Toplam ucus: ' + a.tailFlightCount);
  console.log('');

  if (a.firstCritical) {
    console.log('  [KRITIK] ILK KRITIK SINYAL: ' + a.firstCritical.flight.flightDate + ' (arizadan ' + a.firstCritical.daysBefore + ' gun ONCE)');
    console.log('    Route: ' + a.firstCritical.flight.takeoffAirport + ' -> ' + a.firstCritical.flight.landingAirport);
    console.log('    PFD: ' + a.firstCritical.flight.normalizedPfd.toFixed(1) + '%  Aci: ' + a.firstCritical.flight.pfdTurn1Deg.toFixed(1) + ' deg  Ratio: ' + a.firstCritical.flight.durationRatio.toFixed(2) + 'x');
    console.log('    Sebepler: ' + a.firstCritical.flight.anomalyReasons.join(' | '));
  } else {
    console.log('  [KRITIK] ILK KRITIK SINYAL: YOK (ariza oncesi kritik ucus bulunamadi)');
  }

  if (a.firstWarning) {
    console.log('  [UYARI] ILK UYARI SINYALI: ' + a.firstWarning.flight.flightDate + ' (arizadan ' + a.firstWarning.daysBefore + ' gun ONCE)');
    console.log('    Route: ' + a.firstWarning.flight.takeoffAirport + ' -> ' + a.firstWarning.flight.landingAirport);
    console.log('    Sebepler: ' + a.firstWarning.flight.anomalyReasons.join(' | '));
  } else {
    console.log('  [UYARI] ILK UYARI SINYALI: YOK');
  }

  console.log('');
  console.log('  Ariza oncesi sinyal yogunlugu:');
  console.log('    Son 30 gun:  ' + a.criticals30d + ' kritik, ' + a.warnings30d + ' uyari');
  console.log('    Son 60 gun:  ' + a.criticals60d + ' kritik, ' + a.warnings60d + ' uyari');
  console.log('    Son 90 gun:  ' + a.criticals90d + ' kritik, ' + a.warnings90d + ' uyari');
  console.log('    Toplam:      ' + a.criticalBefore.length + ' kritik, ' + a.warningBefore.length + ' uyari');

  if (a.criticalBefore.length > 0) {
    console.log('');
    console.log('  Ariza oncesi son kritik ucuslar (en yakindan en uzaga):');
    const recent = [...a.criticalBefore].sort((x, y) => x.daysBefore - y.daysBefore);
    for (const c of recent.slice(0, 10)) {
      const f = c.flight;
      console.log('    ' + f.flightDate + ' (' + c.daysBefore + 'g once) ' + f.takeoffAirport + '->' + f.landingAirport + ' PFD:' + f.normalizedPfd.toFixed(1) + '% Aci:' + f.pfdTurn1Deg.toFixed(1) + ' deg Ratio:' + f.durationRatio.toFixed(2) + 'x');
      console.log('      -> ' + f.anomalyReasons.join(' | '));
    }
    if (recent.length > 10) {
      console.log('    ... ve ' + (recent.length - 10) + ' tane daha');
    }
  }

  if (a.criticalAfter.length > 0) {
    console.log('');
    console.log('  Ariza SONRASI kritik ucuslar (sorun devam ediyor mu?):');
    for (const c of a.criticalAfter.slice(0, 5)) {
      const f = c.flight;
      console.log('    ' + f.flightDate + ' (' + c.daysAfter + 'g sonra) ' + f.takeoffAirport + '->' + f.landingAirport + ' PFD:' + f.normalizedPfd.toFixed(1) + '% Aci:' + f.pfdTurn1Deg.toFixed(1) + ' deg');
    }
  } else {
    console.log('');
    console.log('  Ariza sonrasi kritik ucus yok (sorun giderilmis veya veri yok)');
  }
}

// ─── 5. Summary statistics ───
console.log('');
console.log('='.repeat(100));
console.log('OZET ISTATISTIKLER');
console.log('='.repeat(100));

const validAnalyses = analyses.filter(a => a.fault.tailNumber && a.fault.faultDate);
const withCriticalBefore = validAnalyses.filter(a => a.criticalBefore.length > 0);
const withWarningBefore = validAnalyses.filter(a => a.warningBefore.length > 0);
const withAnySigBefore = validAnalyses.filter(a => a.criticalBefore.length > 0 || a.warningBefore.length > 0);

console.log('');
console.log('Toplam ariza kaydi: ' + validAnalyses.length);
console.log('Ariza oncesi KRITIK sinyal olan: ' + withCriticalBefore.length + ' / ' + validAnalyses.length + ' (' + ((withCriticalBefore.length / Math.max(validAnalyses.length, 1)) * 100).toFixed(0) + '%)');
console.log('Ariza oncesi UYARI sinyal olan: ' + withWarningBefore.length + ' / ' + validAnalyses.length + ' (' + ((withWarningBefore.length / Math.max(validAnalyses.length, 1)) * 100).toFixed(0) + '%)');
console.log('Ariza oncesi HERHANGI sinyal olan: ' + withAnySigBefore.length + ' / ' + validAnalyses.length + ' (' + ((withAnySigBefore.length / Math.max(validAnalyses.length, 1)) * 100).toFixed(0) + '%)');

if (withCriticalBefore.length > 0) {
  const leadTimes = withCriticalBefore.map(a => a.firstCritical!.daysBefore);
  leadTimes.sort((a, b) => a - b);
  const avg = leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length;
  const median = leadTimes[Math.floor(leadTimes.length / 2)];
  const min = leadTimes[0];
  const max = leadTimes[leadTimes.length - 1];

  console.log('');
  console.log('ILK KRITIK SINYAL -> ARIZA ARASI SURE:');
  console.log('  Minimum:  ' + min + ' gun');
  console.log('  Medyan:   ' + median + ' gun');
  console.log('  Ortalama: ' + avg.toFixed(1) + ' gun');
  console.log('  Maksimum: ' + max + ' gun');

  console.log('');
  console.log('  Dagilim:');
  const buckets = [7, 14, 30, 60, 90, 180, 365];
  for (const b of buckets) {
    const count = leadTimes.filter(t => t <= b).length;
    console.log('    <= ' + String(b).padStart(3) + 'g: ' + String(count).padStart(3) + ' / ' + leadTimes.length + ' (' + ((count / leadTimes.length) * 100).toFixed(0) + '%)');
  }
}

if (withWarningBefore.length > 0) {
  const leadTimes = withWarningBefore.map(a => a.firstWarning!.daysBefore);
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

// Per-fault summary table
console.log('');
console.log('-'.repeat(140));
console.log('ARIZA BAZLI OZET TABLO');
console.log('-'.repeat(140));
console.log(
  'Kuyruk'.padEnd(10) +
  'ArizaTarihi'.padEnd(14) +
  'IlkKritik'.padEnd(14) +
  'Lead(g)'.padStart(8) +
  '  ' +
  'IlkUyari'.padEnd(14) +
  'Lead(g)'.padStart(8) +
  '  ' +
  'Crit<30d'.padStart(9) +
  'Crit<60d'.padStart(9) +
  'Crit<90d'.padStart(9) +
  'Warn<30d'.padStart(9) +
  '  Aciklama'
);
console.log('-'.repeat(140));

for (const a of validAnalyses) {
  console.log(
    a.fault.tailNumber.padEnd(10) +
    a.fault.faultDate.padEnd(14) +
    (a.firstCritical ? a.firstCritical.flight.flightDate : '-').padEnd(14) +
    (a.firstCritical ? String(a.firstCritical.daysBefore) : '-').padStart(8) +
    '  ' +
    (a.firstWarning ? a.firstWarning.flight.flightDate : '-').padEnd(14) +
    (a.firstWarning ? String(a.firstWarning.daysBefore) : '-').padStart(8) +
    '  ' +
    String(a.criticals30d).padStart(9) +
    String(a.criticals60d).padStart(9) +
    String(a.criticals90d).padStart(9) +
    String(a.warnings30d).padStart(9) +
    '  ' + a.fault.description.substring(0, 40)
  );
}

console.log('');
console.log('Analiz tamamlandi.');
