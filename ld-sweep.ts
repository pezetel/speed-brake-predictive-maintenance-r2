import * as XLSX from 'xlsx';
import { parseExcelData } from './lib/utils';
import { FlightRecord } from './lib/types';
const DATA_FILE = 'speed brake info.xlsx';
const FAULT_FILE = 'speedbrake ar\u0131zalar\u0131 filtreli.xlsx';
const dataWb = XLSX.readFile(DATA_FILE);
let allFlights: FlightRecord[] = [];
for (const sn of dataWb.SheetNames) { const ws = dataWb.Sheets[sn]; const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' }); allFlights = allFlights.concat(parseExcelData(rows)); }
let minD = '9999', maxD = '0000';
for (const f of allFlights) { if (f.flightDate < minD) minD = f.flightDate; if (f.flightDate > maxD) maxD = f.flightDate; }
const byTail = new Map<string, FlightRecord[]>();
for (const f of allFlights) { let a = byTail.get(f.tailNumber); if (!a) { a = []; byTail.set(f.tailNumber, a); } a.push(f); }
for (const [, a] of byTail) a.sort((x, y) => x.flightDate.localeCompare(y.flightDate));
const faultWb = XLSX.readFile(FAULT_FILE);
interface FR { tail: string; date: string; desc: string; }
const allFaults: FR[] = [];
for (const sn of faultWb.SheetNames) { const ws = faultWb.Sheets[sn]; const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' }); for (const row of rows) { let tail = String(row['A/C'] || '').trim().toUpperCase(); if (tail && !tail.startsWith('TC-')) tail = 'TC-' + tail; let date = ''; const dv = row['Date']; if (typeof dv === 'number' && dv > 40000 && dv < 50000) { const d = new Date((dv - 25569) * 86400 * 1000); date = d.toISOString().split('T')[0]; } const desc = String(row['Description'] || '').replace(/<br>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(); if (tail && date) allFaults.push({ tail, date, desc }); } }
const faultTailSet = new Set(allFaults.map(f => f.tail));
const faultsInRange = allFaults.filter(f => f.date >= minD && f.date <= maxD);
const totalF = faultsInRange.length;
function decompose(r: FlightRecord) { const nPfd = r.normalizedPfd; let base = 0; if (nPfd > 0 && nPfd < 60) base += 60; else if (nPfd >= 60 && nPfd < 75) base += 45; else if (nPfd >= 75 && nPfd < 85) base += 25; else if (nPfd >= 85 && nPfd < 92) base += 8; if (r.durationDerivative > 0 && r.durationExtTo99 > 0) { const ratio = r.durationRatio, ext = r.durationExtTo99; if (ratio > 6 && ext > 8) base += 40; else if (ratio > 4 && ext > 5) base += 25; else if (ratio > 3 && ext > 4) base += 12; } if (r.durationExtTo99 > 15) base += 35; else if (r.durationExtTo99 > 10) base += 15; let hasLD = false; if (r.landingDist30kn > 0 && r.landingDist50kn > 0 && r.landingDist50kn > r.landingDist30kn * 1.05) hasLD = true; if (r.pfdTurn1Deg > 0 && r.pfeTo99Deg > 0) { if (r.pfdTurn1Deg < 20 && nPfd < 75) base += 40; else if (r.pfdTurn1Deg < 25 && nPfd < 80) base += 25; const dd = r.pfeTo99Deg - r.pfdTurn1Deg; if (dd > 10 && nPfd < 85) base += 20; else if (dd > 8 && nPfd < 80) base += 15; } if (r.gsAtAutoSbop > 0 && r.gsAtAutoSbop < 1500) base += 5; if (nPfd < 85 && r.landingDist30kn > 1800) base += 15; return { base, hasLD }; }
interface FSD { base: number; hasLD: boolean; tail: string; date: string; isFault: boolean; }
const fsd: FSD[] = allFlights.map(f => { const d = decompose(f); return { base: d.base, hasLD: d.hasLD, tail: f.tailNumber, date: f.flightDate, isFault: faultTailSet.has(f.tailNumber) }; });
const sByTail = new Map<string, FSD[]>();
for (const fs of fsd) { let a = sByTail.get(fs.tail); if (!a) { a = []; sByTail.set(fs.tail, a); } a.push(fs); }
for (const [, a] of sByTail) a.sort((x, y) => x.date.localeCompare(y.date));
function daysDiff(a: string, b: string): number { return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000); }
function pct(n: number, t: number): string { return t === 0 ? '0.0%' : ((n / t) * 100).toFixed(1) + '%'; }
console.log('');
console.log('LD SKOR SWEEP: Her LD degerinde ariza tespit orani ve gurultu');
console.log('Mevcut LD=30 | Warning>=16 | Critical>=40 | Ariza:' + totalF);
console.log('');
console.log('LD  | Tespit    | %      | Kritik | Uyari  | Kacan | FiloWarn | LD-onlyW | FP      | Not');
console.log('-'.repeat(105));
for (let ld = 0; ld <= 30; ld++) {
  let filoW = 0, ldOnlyW = 0, fpC = 0, fpW = 0;
  for (const fs of fsd) {
    const tot = fs.base + (fs.hasLD ? ld : 0);
    if (tot >= 40) { if (!fs.isFault) fpC++; }
    else if (tot >= 16) { filoW++; if (fs.hasLD && fs.base < 16) ldOnlyW++; if (!fs.isFault) fpW++; }
  }
  let detC = 0, detW = 0;
  for (const fault of faultsInRange) {
    const tf = sByTail.get(fault.tail) || [];
    let fC = false, fW = false;
    for (const fs of tf) { const diff = daysDiff(fault.date, fs.date); if (diff > 0 && diff <= 90) { const tot = fs.base + (fs.hasLD ? ld : 0); if (tot >= 40) { fC = true; break; } else if (tot >= 16) fW = true; } }
    if (fC) detC++; else if (fW) detW++;
  }
  const det = detC + detW;
  let mark = '';
  if (ld === 30) mark = '<-- MEVCUT';
  else if (det >= 49) mark = 'KORUNUYOR ✅';
  else if (det === 48) mark = '-1 ariza';
  else if (det === 47) mark = '-2 ariza';
  console.log(
    String(ld).padStart(3) + ' | ' +
    (det + '/' + totalF).padStart(9) + ' | ' +
    pct(det, totalF).padStart(6) + ' | ' +
    String(detC).padStart(6) + ' | ' +
    String(detW).padStart(6) + ' | ' +
    String(totalF - det).padStart(5) + ' | ' +
    String(filoW).padStart(8) + ' | ' +
    String(ldOnlyW).padStart(8) + ' | ' +
    String(fpC + fpW).padStart(7) + ' | ' +
    mark
  );
}
