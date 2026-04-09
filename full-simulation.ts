// ============================================================
// SPEED BRAKE TAHMİNSEL BAKIM SİMÜLASYONU
// Gerçek arıza kayıtları vs Tahminsel bakım uyarıları karşılaştırması
//
// Amaç: "speed brake info.xlsx" uçuş verisindeki arama kriterlerimizi
//        "speedbrake arızaları filtreli.xlsx" gerçek arızalarla eşleştirip
//        yakalama oranını, kaçırılan arızaları ve ek uyarıları analiz etmek.
//
// Çalıştır: npx tsx full-simulation.ts
// ============================================================

import * as XLSX from 'xlsx';
import { parseExcelData } from './lib/utils';
import { FlightRecord } from './lib/types';

const FAULT_FILE = 'speedbrake arızaları filtreli.xlsx';
const DATA_FILE = 'speed brake info.xlsx';

// ════════════════════════════════════════════════════════════════
// 1. VERİ OKUMA
// ════════════════════════════════════════════════════════════════

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║   B737 SPEED BRAKE - TAHMİNSEL BAKIM SİMÜLASYON RAPORU           ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log('');

// --- Uçuş verisi ---
console.log('📂 Uçuş verisi okunuyor: ' + DATA_FILE);
const dataWb = XLSX.readFile(DATA_FILE);
let allFlights: FlightRecord[] = [];
for (const sheetName of dataWb.SheetNames) {
  const ws = dataWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  allFlights = allFlights.concat(parseExcelData(rows));
}
console.log('   Toplam uçuş kaydı: ' + allFlights.length);

// Tarih aralığı
let minFlightDate = '9999-99-99';
let maxFlightDate = '0000-00-00';
for (const f of allFlights) {
  if (f.flightDate < minFlightDate) minFlightDate = f.flightDate;
  if (f.flightDate > maxFlightDate) maxFlightDate = f.flightDate;
}
console.log('   Tarih aralığı: ' + minFlightDate + ' → ' + maxFlightDate);

// Kuyruk bazlı gruplama
const flightsByTail = new Map<string, FlightRecord[]>();
for (const f of allFlights) {
  let arr = flightsByTail.get(f.tailNumber);
  if (!arr) { arr = []; flightsByTail.set(f.tailNumber, arr); }
  arr.push(f);
}
for (const [, arr] of flightsByTail) {
  arr.sort((a, b) => a.flightDate.localeCompare(b.flightDate));
}
console.log('   Benzersiz kuyruk sayısı: ' + flightsByTail.size);

// --- Arıza verisi ---
console.log('');
console.log('📂 Arıza verisi okunuyor: ' + FAULT_FILE);
const faultWb = XLSX.readFile(FAULT_FILE);

interface FaultRecord {
  tail: string;
  date: string;
  desc: string;
  ata: string;
  wo: string;
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
    } else if (dv instanceof Date) {
      date = dv.toISOString().split('T')[0];
    } else {
      const s = String(dv || '').trim();
      const parts = s.split('.');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        date = year + '-' + month + '-' + day;
      }
    }

    const desc = String(row['Description'] || '')
      .replace(/<br>/gi, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();

    const ata = String(row['ATA'] || '').trim();
    const wo = String(row['W/O'] || '').trim();

    if (tail && date) {
      allFaults.push({ tail, date, desc, ata, wo });
    }
  }
}

// Tarihe göre sırala
allFaults.sort((a, b) => a.date.localeCompare(b.date));
console.log('   Toplam arıza kaydı: ' + allFaults.length);

// Uçuş verisi aralığındaki arızaları filtrele
const faultsInRange = allFaults.filter(f => f.date >= minFlightDate && f.date <= maxFlightDate);
const faultsBeforeRange = allFaults.filter(f => f.date < minFlightDate);
const faultsAfterRange = allFaults.filter(f => f.date > maxFlightDate);

console.log('');
console.log('   ┌─ Uçuş verisi öncesi arızalar: ' + faultsBeforeRange.length);
console.log('   ├─ Uçuş verisi içindeki arızalar: ' + faultsInRange.length + ' ← ANALİZ EDİLECEK');
console.log('   └─ Uçuş verisi sonrası arızalar: ' + faultsAfterRange.length);

// ════════════════════════════════════════════════════════════════
// 2. ANOMALI SKORU HESAPLAMA (mevcut kriterler - lib/utils.ts)
// ════════════════════════════════════════════════════════════════

function computeAnomalyScore(r: FlightRecord): number {
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

function getAnomalyLevel(score: number): 'normal' | 'warning' | 'critical' {
  if (score >= 40) return 'critical';
  if (score >= 16) return 'warning';
  return 'normal';
}

// ════════════════════════════════════════════════════════════════
// 3. GERÇEK ARIZA EŞLEŞTİRME ANALİZİ
// ════════════════════════════════════════════════════════════════

function daysDiff(dateA: string, dateB: string): number {
  return Math.round((new Date(dateA).getTime() - new Date(dateB).getTime()) / 86400000);
}

interface FaultMatchResult {
  fault: FaultRecord;
  tailFlightCount: number;
  // Arıza tarihi ile ±7 gün aralığında eşleşen uçuşlar
  exactMatchFlights: FlightRecord[];
  nearMatchFlights: FlightRecord[];
  // En iyi eşleşme
  bestMatch: FlightRecord | null;
  caughtAs: 'critical' | 'warning' | 'missed';
  bestMatchScore: number;
  bestMatchDate: string;
  // 90 gün öncesindeki sinyaller (tahminsel bakım perspektifi)
  critBefore30: number;
  warnBefore30: number;
  critBefore60: number;
  warnBefore60: number;
  critBefore90: number;
  warnBefore90: number;
  anySignal30: boolean;
  anySignal60: boolean;
  anySignal90: boolean;
  // İlk sinyal lead time
  firstCriticalLeadDays: number;
  firstWarningLeadDays: number;
  firstAnyLeadDays: number;
}

const matchResults: FaultMatchResult[] = [];

for (const fault of faultsInRange) {
  const flights = flightsByTail.get(fault.tail) || [];

  // ±3 gün ve ±7 gün eşleşmeleri
  const exactMatch: FlightRecord[] = [];
  const nearMatch: FlightRecord[] = [];

  // 30/60/90 gün öncesi sinyaller
  let c30 = 0, w30 = 0, c60 = 0, w60 = 0, c90 = 0, w90 = 0;
  let firstCritLead = -1, firstWarnLead = -1, firstAnyLead = -1;

  for (const f of flights) {
    const diff = daysDiff(fault.date, f.flightDate); // pozitif = uçuş arızadan önce
    const score = computeAnomalyScore(f);
    const level = getAnomalyLevel(score);

    // Eşleştirme: arıza tarihiyle ±3 gün
    if (Math.abs(diff) <= 3) {
      exactMatch.push(f);
    } else if (Math.abs(diff) <= 7) {
      nearMatch.push(f);
    }

    // Arıza öncesi sinyal analizi (tahminsel bakım)
    if (diff > 0 && diff <= 90) {
      if (level === 'critical') {
        c90++;
        if (diff <= 60) c60++;
        if (diff <= 30) c30++;
        if (firstCritLead < 0 || diff > firstCritLead) firstCritLead = diff;
      } else if (level === 'warning') {
        w90++;
        if (diff <= 60) w60++;
        if (diff <= 30) w30++;
        if (firstWarnLead < 0 || diff > firstWarnLead) firstWarnLead = diff;
      }
      if (level !== 'normal') {
        if (firstAnyLead < 0 || diff > firstAnyLead) firstAnyLead = diff;
      }
    }
  }

  // En iyi eşleşme bul
  const allMatched = [...exactMatch, ...nearMatch];
  let bestMatch: FlightRecord | null = null;
  let bestScore = -1;

  for (const f of allMatched) {
    const score = computeAnomalyScore(f);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = f;
    }
  }

  // Eğer direkt eşleşme yoksa, normal uçuşlar arasından bile en yakını al
  if (!bestMatch && allMatched.length > 0) {
    bestMatch = allMatched[0];
    bestScore = computeAnomalyScore(bestMatch);
  }

  let caughtAs: 'critical' | 'warning' | 'missed' = 'missed';
  if (bestMatch) {
    const level = getAnomalyLevel(bestScore);
    if (level === 'critical') caughtAs = 'critical';
    else if (level === 'warning') caughtAs = 'warning';
  }

  matchResults.push({
    fault,
    tailFlightCount: flights.length,
    exactMatchFlights: exactMatch,
    nearMatchFlights: nearMatch,
    bestMatch,
    caughtAs,
    bestMatchScore: bestScore,
    bestMatchDate: bestMatch ? bestMatch.flightDate : '',
    critBefore30: c30, warnBefore30: w30,
    critBefore60: c60, warnBefore60: w60,
    critBefore90: c90, warnBefore90: w90,
    anySignal30: c30 + w30 > 0,
    anySignal60: c60 + w60 > 0,
    anySignal90: c90 + w90 > 0,
    firstCriticalLeadDays: firstCritLead,
    firstWarningLeadDays: firstWarnLead,
    firstAnyLeadDays: firstAnyLead,
  });
}

// ════════════════════════════════════════════════════════════════
// 4. FİLO GENELİ ANOMALİ SAYILARI
// ════════════════════════════════════════════════════════════════

let totalNormal = 0, totalWarning = 0, totalCritical = 0;
const anomalyByTail = new Map<string, { crit: number; warn: number; norm: number; total: number }>();

for (const f of allFlights) {
  const score = computeAnomalyScore(f);
  const level = getAnomalyLevel(score);

  if (level === 'critical') totalCritical++;
  else if (level === 'warning') totalWarning++;
  else totalNormal++;

  let entry = anomalyByTail.get(f.tailNumber);
  if (!entry) { entry = { crit: 0, warn: 0, norm: 0, total: 0 }; anomalyByTail.set(f.tailNumber, entry); }
  entry.total++;
  if (level === 'critical') entry.crit++;
  else if (level === 'warning') entry.warn++;
  else entry.norm++;
}

// Arızası olan vs olmayan kuyruklar
const faultTailSet = new Set(allFaults.map(f => f.tail));
const faultTailCount = faultTailSet.size;
const healthyTailCount = flightsByTail.size - faultTailCount;

// ════════════════════════════════════════════════════════════════
// 5. EK UYARILAR (gerçek arızayla eşleşmeyen sinyaller)
// ════════════════════════════════════════════════════════════════

// Arıza kayıtlarının ±7 gün tarih aralığı
const faultDateKeys = new Set<string>();
for (const fault of allFaults) {
  if (fault.date) {
    const faultDate = new Date(fault.date);
    for (let d = -7; d <= 7; d++) {
      const dt = new Date(faultDate);
      dt.setDate(dt.getDate() + d);
      faultDateKeys.add(fault.tail + '|' + dt.toISOString().split('T')[0]);
    }
  }
}

// Sadece faultsInRange tarih aralığındaki uçuşları filtrele
const analysisStart = faultsInRange.length > 0 ? faultsInRange[0].date : minFlightDate;
const analysisEnd = faultsInRange.length > 0 ? faultsInRange[faultsInRange.length - 1].date : maxFlightDate;

const extraCriticals: FlightRecord[] = [];
const extraWarnings: FlightRecord[] = [];

for (const f of allFlights) {
  // Analiz dönemindeki uçuşlar
  if (f.flightDate < minFlightDate || f.flightDate > maxFlightDate) continue;
  const score = computeAnomalyScore(f);
  const level = getAnomalyLevel(score);
  const key = f.tailNumber + '|' + f.flightDate;

  if (level === 'critical' && !faultDateKeys.has(key)) {
    extraCriticals.push(f);
  } else if (level === 'warning' && !faultDateKeys.has(key)) {
    extraWarnings.push(f);
  }
}

// ════════════════════════════════════════════════════════════════
// 6. RAPORLAMA
// ════════════════════════════════════════════════════════════════

function pct(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}
function rpad(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

// ─── BÖLÜM A: TAHMİNSEL BAKIM GENEL TABLO ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  A) TAHMİNSEL BAKIM SİSTEMİ GENEL GÖRÜNÜM                          │');
console.log('│  "Sistem aktif olsaydı ne görünürdü?"                               │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');
console.log('  Analiz dönemi:            ' + minFlightDate + ' → ' + maxFlightDate);
console.log('  Toplam uçuş:              ' + allFlights.length);
console.log('  Toplam kuyruk:            ' + flightsByTail.size);
console.log('  Arızası olan kuyruk:      ' + faultTailCount);
console.log('  Arızası olmayan kuyruk:   ' + healthyTailCount);
console.log('');
console.log('  ┌────────────────────────────────────────────────────────┐');
console.log('  │  FİLO GENELİ ANOMALİ DAĞILIMI                        │');
console.log('  ├───────────────┬──────────┬────────────────────────────┤');
console.log('  │ Seviye         │ Sayı     │ Oran                       │');
console.log('  ├───────────────┼──────────┼────────────────────────────┤');
console.log('  │ 🔴 KRİTİK     │ ' + rpad(String(totalCritical), 8) + ' │ ' + pad(pct(totalCritical, allFlights.length), 26) + ' │');
console.log('  │ 🟡 UYARI      │ ' + rpad(String(totalWarning), 8) + ' │ ' + pad(pct(totalWarning, allFlights.length), 26) + ' │');
console.log('  │ 🟢 NORMAL     │ ' + rpad(String(totalNormal), 8) + ' │ ' + pad(pct(totalNormal, allFlights.length), 26) + ' │');
console.log('  │ ──────────────│──────────│────────────────────────────│');
console.log('  │ TOPLAM        │ ' + rpad(String(allFlights.length), 8) + ' │ 100.0%                     │');
console.log('  └───────────────┴──────────┴────────────────────────────┘');
console.log('');
console.log('  → Tahminsel bakım panelinde toplam ' + (totalCritical + totalWarning) + ' item görünürdü.');
console.log('    (' + totalCritical + ' kritik + ' + totalWarning + ' uyarı)');

// ─── BÖLÜM B: GERÇEK ARIZA YAKALAMA ORANI ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  B) GERÇEK ARIZA YAKALAMA PERFORMANSI                               │');
console.log('│  "Gerçek arızaların kaçını yakaladık?"                              │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

const totalFaultsAnalyzed = matchResults.length;
const caughtCritical = matchResults.filter(r => r.caughtAs === 'critical');
const caughtWarning = matchResults.filter(r => r.caughtAs === 'warning');
const missed = matchResults.filter(r => r.caughtAs === 'missed');
const totalCaught = caughtCritical.length + caughtWarning.length;

console.log('  Analiz edilen arıza sayısı (uçuş verisi aralığında): ' + totalFaultsAnalyzed);
console.log('');

console.log('  ┌──────────────────────────────────────────────────────────────────┐');
console.log('  │  DİREKT YAKALAMA (arıza tarihi ±3-7 gün eşleşme)               │');
console.log('  ├───────────────────────┬──────────┬──────────┬──────────────────┤');
console.log('  │ Sonuç                  │ Sayı     │ Oran     │ Açıklama         │');
console.log('  ├───────────────────────┼──────────┼──────────┼──────────────────┤');
console.log('  │ 🔴 Kritikten yakalandı │ ' + rpad(String(caughtCritical.length), 8) + ' │ ' + rpad(pct(caughtCritical.length, totalFaultsAnalyzed), 8) + ' │ Skor ≥ 40        │');
console.log('  │ 🟡 Uyarıdan yakalandı  │ ' + rpad(String(caughtWarning.length), 8) + ' │ ' + rpad(pct(caughtWarning.length, totalFaultsAnalyzed), 8) + ' │ Skor 16-39       │');
console.log('  │ ✅ TOPLAM YAKALANAN    │ ' + rpad(String(totalCaught), 8) + ' │ ' + rpad(pct(totalCaught, totalFaultsAnalyzed), 8) + ' │                  │');
console.log('  │ ❌ KAÇIRILAN           │ ' + rpad(String(missed.length), 8) + ' │ ' + rpad(pct(missed.length, totalFaultsAnalyzed), 8) + ' │                  │');
console.log('  └───────────────────────┴──────────┴──────────┴──────────────────┘');

// ─── BÖLÜM C: TAHMİNSEL PERSPEKTİF (30/60/90 gün önceden sinyal) ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  C) TAHMİNSEL BAKIM PERSPEKTİFİ (Arıza öncesi sinyal)             │');
console.log('│  "Arızadan kaç gün önce uyarı çıkardı?"                            │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

const sig30 = matchResults.filter(r => r.anySignal30).length;
const sig60 = matchResults.filter(r => r.anySignal60).length;
const sig90 = matchResults.filter(r => r.anySignal90).length;
const crit30 = matchResults.filter(r => r.critBefore30 > 0).length;
const crit60 = matchResults.filter(r => r.critBefore60 > 0).length;
const crit90 = matchResults.filter(r => r.critBefore90 > 0).length;
const warn30 = matchResults.filter(r => r.warnBefore30 > 0 && r.critBefore30 === 0).length;
const warn60 = matchResults.filter(r => r.warnBefore60 > 0 && r.critBefore60 === 0).length;
const warn90 = matchResults.filter(r => r.warnBefore90 > 0 && r.critBefore90 === 0).length;
const noSig90 = matchResults.filter(r => !r.anySignal90).length;

console.log('  ┌───────────────────────────────────────────────────────────────────────────┐');
console.log('  │ Pencere      │ Kritikten  │ Uyarıdan   │ Herhangi    │ Sinyal yok        │');
console.log('  ├──────────────┼────────────┼────────────┼─────────────┼───────────────────┤');
console.log('  │ Son 30 gün   │ ' +
  pad(crit30 + '/' + totalFaultsAnalyzed + ' ' + pct(crit30, totalFaultsAnalyzed), 10) + ' │ ' +
  pad(warn30 + '/' + totalFaultsAnalyzed + ' ' + pct(warn30, totalFaultsAnalyzed), 10) + ' │ ' +
  pad(sig30 + '/' + totalFaultsAnalyzed + ' ' + pct(sig30, totalFaultsAnalyzed), 11) + ' │ ' +
  pad(String(totalFaultsAnalyzed - sig30), 17) + ' │');
console.log('  │ Son 60 gün   │ ' +
  pad(crit60 + '/' + totalFaultsAnalyzed + ' ' + pct(crit60, totalFaultsAnalyzed), 10) + ' │ ' +
  pad(warn60 + '/' + totalFaultsAnalyzed + ' ' + pct(warn60, totalFaultsAnalyzed), 10) + ' │ ' +
  pad(sig60 + '/' + totalFaultsAnalyzed + ' ' + pct(sig60, totalFaultsAnalyzed), 11) + ' │ ' +
  pad(String(totalFaultsAnalyzed - sig60), 17) + ' │');
console.log('  │ Son 90 gün   │ ' +
  pad(crit90 + '/' + totalFaultsAnalyzed + ' ' + pct(crit90, totalFaultsAnalyzed), 10) + ' │ ' +
  pad(warn90 + '/' + totalFaultsAnalyzed + ' ' + pct(warn90, totalFaultsAnalyzed), 10) + ' │ ' +
  pad(sig90 + '/' + totalFaultsAnalyzed + ' ' + pct(sig90, totalFaultsAnalyzed), 11) + ' │ ' +
  pad(String(noSig90), 17) + ' │');
console.log('  └──────────────┴────────────┴────────────┴─────────────┴───────────────────┘');

// Lead time istatistikleri
const withAnySig = matchResults.filter(r => r.firstAnyLeadDays > 0);
if (withAnySig.length > 0) {
  const leads = withAnySig.map(r => r.firstAnyLeadDays).sort((a, b) => a - b);
  const avgLead = leads.reduce((s, v) => s + v, 0) / leads.length;
  const medLead = leads[Math.floor(leads.length / 2)];
  console.log('');
  console.log('  İlk Sinyal → Arıza Lead Time:');
  console.log('    Min: ' + leads[0] + ' gün  |  Medyan: ' + medLead + ' gün  |  Ort: ' + avgLead.toFixed(0) + ' gün  |  Max: ' + leads[leads.length - 1] + ' gün');
}

// ─── BÖLÜM D: KAÇIRILAN ARIZALAR DETAYI ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  D) KAÇIRILAN ARIZALAR (Yakalanamayan)                              │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

if (missed.length === 0) {
  console.log('  ✅ Tüm arızalar yakalandı! Kaçırılan yok.');
} else {
  console.log('  Toplam kaçırılan: ' + missed.length + ' / ' + totalFaultsAnalyzed + ' (' + pct(missed.length, totalFaultsAnalyzed) + ')');
  console.log('');
  console.log('  ' + pad('Kuyruk', 10) + pad('Arıza Trh', 13) + pad('Uçuş#', 7) + pad('Eşleşen', 9) + pad('90g Sinyal', 12) + 'Açıklama');
  console.log('  ' + '-'.repeat(110));

  for (const r of missed) {
    const matchCount = r.exactMatchFlights.length + r.nearMatchFlights.length;
    const has90 = r.anySignal90 ? 'EVET' : 'HAYIR';
    const desc = r.fault.desc.substring(0, 55);
    console.log('  ' +
      pad(r.fault.tail, 10) +
      pad(r.fault.date, 13) +
      pad(String(r.tailFlightCount), 7) +
      pad(String(matchCount), 9) +
      pad(has90, 12) +
      desc
    );

    // Eşleşen uçuş varsa detay göster
    if (r.bestMatch) {
      const bm = r.bestMatch;
      console.log('    → En yakın uçuş: ' + bm.flightDate + ' ' + bm.takeoffAirport + '→' + bm.landingAirport +
        ' PFD:' + bm.normalizedPfd.toFixed(1) + '% Açı:' + bm.pfdTurn1Deg.toFixed(1) + '° Ratio:' + bm.durationRatio.toFixed(2) + 'x Skor:' + r.bestMatchScore);
    } else {
      console.log('    → ±7 gün içinde uçuş verisi bulunamadı');
    }
  }
}

// ─── BÖLÜM E: YAKALANAN ARIZALAR DETAYI ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  E) YAKALANAN ARIZALAR DETAYI                                       │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

const allCaught = [...caughtCritical, ...caughtWarning];
console.log('  ' + pad('Kuyruk', 10) + pad('Arıza Trh', 13) + pad('Seviye', 10) + pad('Skor', 6) + pad('Uçuş Trh', 13) + pad('PFD%', 8) + pad('Açı°', 7) + pad('Ratio', 7) + 'Sebepler');
console.log('  ' + '-'.repeat(120));

for (const r of allCaught) {
  const icon = r.caughtAs === 'critical' ? '🔴 CRIT' : '🟡 WARN';
  const bm = r.bestMatch!;
  const reasons = bm.anomalyReasons.slice(0, 2).join('; ').substring(0, 45);
  console.log('  ' +
    pad(r.fault.tail, 10) +
    pad(r.fault.date, 13) +
    pad(icon, 10) +
    rpad(String(r.bestMatchScore), 5) + ' ' +
    pad(bm.flightDate, 13) +
    rpad(bm.normalizedPfd.toFixed(1), 7) + ' ' +
    rpad(bm.pfdTurn1Deg.toFixed(1), 6) + ' ' +
    rpad(bm.durationRatio.toFixed(2), 6) + ' ' +
    reasons
  );
}

// ─── BÖLÜM F: EK UYARILAR (Arıza kaydı olmayan sinyaller) ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  F) EK UYARILAR (Gerçek arıza kaydı olmayan sinyaller)              │');
console.log('│  Bunlar ya false positive ya da kayıt dışı / erken tespit           │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

const extraByTail = new Map<string, { critical: number; warning: number }>(); 
for (const f of extraCriticals) {
  let e = extraByTail.get(f.tailNumber);
  if (!e) { e = { critical: 0, warning: 0 }; extraByTail.set(f.tailNumber, e); }
  e.critical++;
}
for (const f of extraWarnings) {
  let e = extraByTail.get(f.tailNumber);
  if (!e) { e = { critical: 0, warning: 0 }; extraByTail.set(f.tailNumber, e); }
  e.warning++;
}

console.log('  ┌────────────────────────────────────────────────────────┐');
console.log('  │ Ek Kritik uyarı (arıza kaydı yok):  ' + rpad(String(extraCriticals.length), 8) + '          │');
console.log('  │ Ek Warning uyarı (arıza kaydı yok): ' + rpad(String(extraWarnings.length), 8) + '          │');
console.log('  │ TOPLAM ek uyarı:                     ' + rpad(String(extraCriticals.length + extraWarnings.length), 8) + '          │');
console.log('  └────────────────────────────────────────────────────────┘');

if (extraByTail.size > 0) {
  console.log('');
  console.log('  Kuyruk bazlı ek uyarı dağılımı (en çok uyarı alan):');
  console.log('  ' + pad('Kuyruk', 12) + rpad('Kritik', 8) + '  ' + rpad('Uyarı', 8) + '  ' + rpad('Toplam', 8) + '  Arızalı mı?');
  console.log('  ' + '-'.repeat(55));

  const sortedExtra = Array.from(extraByTail.entries())
    .sort((a, b) => (b[1].critical + b[1].warning) - (a[1].critical + a[1].warning))
    .slice(0, 25);

  for (const [tail, counts] of sortedExtra) {
    const isFaultTail = faultTailSet.has(tail) ? '✅ Evet' : '❌ Hayır';
    console.log('  ' +
      pad(tail, 12) +
      rpad(String(counts.critical), 8) + '  ' +
      rpad(String(counts.warning), 8) + '  ' +
      rpad(String(counts.critical + counts.warning), 8) + '  ' +
      isFaultTail
    );
  }
}

// ─── BÖLÜM G: ARIZA BAZLI DETAY TABLOSU ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  G) ARIZA BAZLI DETAY TABLOSU                                       │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

console.log('  ' +
  pad('#', 4) +
  pad('Kuyruk', 10) +
  pad('Arıza Trh', 13) +
  pad('Direkt', 8) +
  pad('Skor', 6) +
  pad('C30', 5) + pad('W30', 5) +
  pad('C60', 5) + pad('W60', 5) +
  pad('C90', 5) + pad('W90', 5) +
  pad('Lead', 6) +
  'Açıklama'
);
console.log('  ' + '-'.repeat(130));

for (let i = 0; i < matchResults.length; i++) {
  const r = matchResults[i];
  const directResult = r.caughtAs === 'critical' ? '🔴CRIT' : r.caughtAs === 'warning' ? '🟡WARN' : '❌MISS';
  const leadStr = r.firstAnyLeadDays > 0 ? String(r.firstAnyLeadDays) + 'g' : '-';
  console.log('  ' +
    pad(String(i + 1), 4) +
    pad(r.fault.tail, 10) +
    pad(r.fault.date, 13) +
    pad(directResult, 8) +
    rpad(r.bestMatchScore >= 0 ? String(r.bestMatchScore) : '-', 5) + ' ' +
    rpad(String(r.critBefore30), 4) + ' ' +
    rpad(String(r.warnBefore30), 4) + ' ' +
    rpad(String(r.critBefore60), 4) + ' ' +
    rpad(String(r.warnBefore60), 4) + ' ' +
    rpad(String(r.critBefore90), 4) + ' ' +
    rpad(String(r.warnBefore90), 4) + ' ' +
    pad(leadStr, 6) +
    r.fault.desc.substring(0, 35)
  );
}

// ════════════════════════════════════════════════════════════════
// 7. NİHAİ ÖZET TABLOSU
// ════════════════════════════════════════════════════════════════

console.log('');
console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                                ║');
console.log('║                    NİHAİ ÖZET RAPORU — SPEED BRAKE SİMÜLASYONU                 ║');
console.log('║                                                                                ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                ║');
console.log('║  1️⃣  TAHMİNSEL BAKIM PANELİNDE GÖRÜNECEK TOPLAM ITEM                          ║');
console.log('║  ──────────────────────────────────────────────────────────                     ║');
console.log('║  Toplam uçuş:               ' + pad(String(allFlights.length), 10) + '                                     ║');
console.log('║  Kritik uyarı sayısı:        ' + pad(String(totalCritical) + ' (' + pct(totalCritical, allFlights.length) + ')', 20) + '                           ║');
console.log('║  Warning uyarı sayısı:       ' + pad(String(totalWarning) + ' (' + pct(totalWarning, allFlights.length) + ')', 20) + '                           ║');
console.log('║  Normal uçuş sayısı:         ' + pad(String(totalNormal) + ' (' + pct(totalNormal, allFlights.length) + ')', 20) + '                           ║');
console.log('║  TOPLAM UYARI (Crit+Warn):   ' + pad(String(totalCritical + totalWarning), 10) + '                                     ║');
console.log('║                                                                                ║');
console.log('║  2️⃣  GERÇEK ARIZA YAKALAMA PERFORMANSI                                        ║');
console.log('║  ──────────────────────────────────────────────────────────                     ║');
console.log('║  Değerlendirilen arıza:      ' + pad(String(totalFaultsAnalyzed), 10) + '                                     ║');
console.log('║  Kritikten yakalanan:        ' + pad(caughtCritical.length + ' / ' + totalFaultsAnalyzed + ' (' + pct(caughtCritical.length, totalFaultsAnalyzed) + ')', 25) + '                      ║');
console.log('║  Uyarıdan yakalanan:         ' + pad(caughtWarning.length + ' / ' + totalFaultsAnalyzed + ' (' + pct(caughtWarning.length, totalFaultsAnalyzed) + ')', 25) + '                      ║');
console.log('║  ✅ TOPLAM YAKALAMA:          ' + pad(totalCaught + ' / ' + totalFaultsAnalyzed + ' (' + pct(totalCaught, totalFaultsAnalyzed) + ')', 25) + '                      ║');
console.log('║  ❌ KAÇIRILAN:                ' + pad(missed.length + ' / ' + totalFaultsAnalyzed + ' (' + pct(missed.length, totalFaultsAnalyzed) + ')', 25) + '                      ║');
console.log('║                                                                                ║');
console.log('║  3️⃣  TAHMİNSEL SİNYAL (Arıza öncesi 90 gün penceresi)                        ║');
console.log('║  ──────────────────────────────────────────────────────────                     ║');
console.log('║  90 gün içinde herhangi sinyal: ' + pad(sig90 + ' / ' + totalFaultsAnalyzed + ' (' + pct(sig90, totalFaultsAnalyzed) + ')', 25) + '                    ║');
console.log('║  60 gün içinde herhangi sinyal: ' + pad(sig60 + ' / ' + totalFaultsAnalyzed + ' (' + pct(sig60, totalFaultsAnalyzed) + ')', 25) + '                    ║');
console.log('║  30 gün içinde herhangi sinyal: ' + pad(sig30 + ' / ' + totalFaultsAnalyzed + ' (' + pct(sig30, totalFaultsAnalyzed) + ')', 25) + '                    ║');
console.log('║  90 gün içinde sinyal yok:      ' + pad(noSig90 + ' / ' + totalFaultsAnalyzed + ' (' + pct(noSig90, totalFaultsAnalyzed) + ')', 25) + '                    ║');
console.log('║                                                                                ║');
console.log('║  4️⃣  EK UYARILAR (Arıza kaydı olmayan sinyaller)                              ║');
console.log('║  ──────────────────────────────────────────────────────────                     ║');
console.log('║  Ek kritik:                  ' + pad(String(extraCriticals.length), 10) + '                                     ║');
console.log('║  Ek uyarı:                   ' + pad(String(extraWarnings.length), 10) + '                                     ║');
console.log('║  Toplam ek sinyal:           ' + pad(String(extraCriticals.length + extraWarnings.length), 10) + '                                     ║');
console.log('║                                                                                ║');

// Değerlendirme
const catchRate = totalFaultsAnalyzed > 0 ? (totalCaught / totalFaultsAnalyzed) * 100 : 0;
let verdict = '';
if (catchRate >= 90) verdict = '🟢 MÜKEMMEL — Neredeyse tüm arızalar yakalandı';
else if (catchRate >= 70) verdict = '🟡 İYİ — Çoğu arıza yakalanıyor';
else if (catchRate >= 50) verdict = '🟠 ORTA — Eşik değerleri iyileştirilmeli';
else verdict = '🔴 DÜŞÜK — Ciddi kalibrasyon gerekli';

console.log('║  5️⃣  DEĞERLENDİRME                                                            ║');
console.log('║  ──────────────────────────────────────────────────────────                     ║');
console.log('║  Yakalama oranı: %' + catchRate.toFixed(1).padStart(5) + '                                                       ║');
console.log('║  ' + pad(verdict, 78) + '║');
console.log('║                                                                                ║');

// Kaçırılan arızaların kuyruklarını listele
if (missed.length > 0) {
  console.log('║  Kaçırılan arızaların kuyruklari:                                             ║');
  const missedTailMap = new Map<string, { count: number; dates: string[]; hasData: number }>();
  for (const m of missed) {
    let entry = missedTailMap.get(m.fault.tail);
    if (!entry) { entry = { count: 0, dates: [], hasData: 0 }; missedTailMap.set(m.fault.tail, entry); }
    entry.count++;
    entry.dates.push(m.fault.date);
    if (m.exactMatchFlights.length + m.nearMatchFlights.length > 0) entry.hasData++;
  }
  for (const [tail, info] of missedTailMap) {
    const line = '    ' + tail + ': ' + info.count + ' arıza (' + info.hasData + ' tanesi uçuş verisiyle eşleşti) → ' + info.dates.join(', ');
    console.log('║  ' + pad(line, 78) + '║');
  }
  console.log('║                                                                                ║');
}

console.log('╚══════════════════════════════════════════════════════════════════════════════════╝');

// ─── BÖLÜM H: KUYRUK BAZLI SAĞLIK SKORU ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  H) KUYRUK BAZLI SAĞLIK SKORU (Arızalı kuyruklar)                   │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

// Her arızalı kuyruk için sağlık skoru hesapla
interface TailSummary {
  tail: string;
  flights: number;
  faultCount: number;
  faultDates: string[];
  critFlights: number;
  warnFlights: number;
  avgPfd: number;
  worstPfd: number;
  healthScore: number;
  risk: string;
}

const tailSummaries: TailSummary[] = [];

// Arıza sayısını kuyruk bazlı hesapla
const faultCountByTail = new Map<string, { count: number; dates: string[] }>();
for (const f of allFaults) {
  let entry = faultCountByTail.get(f.tail);
  if (!entry) { entry = { count: 0, dates: [] }; faultCountByTail.set(f.tail, entry); }
  entry.count++;
  entry.dates.push(f.date);
}

for (const tail of faultTailSet) {
  const flights = flightsByTail.get(tail) || [];
  if (flights.length === 0) continue;

  let pfdSum = 0, pfdN = 0, worstPfd = 999;
  let crit = 0, warn = 0;

  for (const f of flights) {
    const score = computeAnomalyScore(f);
    if (score >= 40) crit++;
    else if (score >= 16) warn++;
    if (f.normalizedPfd > 0 && f.normalizedPfd <= 105) {
      pfdSum += f.normalizedPfd;
      pfdN++;
      if (f.normalizedPfd < worstPfd) worstPfd = f.normalizedPfd;
    }
  }

  const avgPfd = pfdN > 0 ? pfdSum / pfdN : 0;

  // Basit sağlık skoru
  let hs = 100;
  if (avgPfd < 95) hs -= (95 - avgPfd) * 1.5;
  if (avgPfd < 80) hs -= (80 - avgPfd) * 2;
  hs -= crit * 5;
  hs -= warn * 2;
  if (worstPfd < 999 && worstPfd < 50) hs -= 20;
  else if (worstPfd < 999 && worstPfd < 70) hs -= 10;
  else if (worstPfd < 999 && worstPfd < 80) hs -= 5;
  hs = Math.max(0, Math.min(100, hs));

  let risk = 'LOW';
  if (hs < 50) risk = 'CRITICAL';
  else if (hs < 70) risk = 'HIGH';
  else if (hs < 85) risk = 'MEDIUM';

  const fc = faultCountByTail.get(tail);
  tailSummaries.push({
    tail,
    flights: flights.length,
    faultCount: fc ? fc.count : 0,
    faultDates: fc ? fc.dates : [],
    critFlights: crit,
    warnFlights: warn,
    avgPfd: Math.round(avgPfd * 10) / 10,
    worstPfd: worstPfd === 999 ? 0 : Math.round(worstPfd * 10) / 10,
    healthScore: Math.round(hs * 10) / 10,
    risk,
  });
}

tailSummaries.sort((a, b) => a.healthScore - b.healthScore);

console.log('  ' +
  pad('Kuyruk', 10) +
  rpad('Arıza#', 7) +
  rpad('Uçuş#', 7) +
  rpad('Sağlık', 7) +
  pad('Risk', 10) +
  rpad('Crit', 6) +
  rpad('Warn', 6) +
  rpad('OrtPFD', 8) +
  rpad('EnDüşükPFD', 12) +
  'Arıza Tarihleri'
);
console.log('  ' + '-'.repeat(130));

for (const ts of tailSummaries) {
  const riskIcon = ts.risk === 'CRITICAL' ? '🔴' : ts.risk === 'HIGH' ? '🟠' : ts.risk === 'MEDIUM' ? '🟡' : '🟢';
  console.log('  ' +
    pad(ts.tail, 10) +
    rpad(String(ts.faultCount), 7) +
    rpad(String(ts.flights), 7) +
    rpad(ts.healthScore.toFixed(1), 7) +
    pad(riskIcon + ' ' + ts.risk, 10) +
    rpad(String(ts.critFlights), 6) +
    rpad(String(ts.warnFlights), 6) +
    rpad(ts.avgPfd.toFixed(1), 8) +
    rpad(ts.worstPfd.toFixed(1), 12) +
    ts.faultDates.map(d => d.substring(5)).join(', ')
  );
}

// ─── BÖLÜM I: 90 GÜN İÇİNDE SİNYAL OLMAYANLAR ANALİZİ ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  I) 90 GÜN İÇİNDE HİÇ SİNYAL ÜRETEMEDİĞİMİZ ARIZALAR            │');
console.log('│  Neden yakalanamadıklarının kök neden analizi                       │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

const noSignal90 = matchResults.filter(r => !r.anySignal90);

if (noSignal90.length === 0) {
  console.log('  ✅ Tüm arızalar için 90 gün içinde en az bir sinyal üretildi!');
} else {
  console.log('  Toplam: ' + noSignal90.length + ' arıza için 90 gün öncesinde hiç sinyal yok.');
  console.log('');

  for (const r of noSignal90) {
    const flights = flightsByTail.get(r.fault.tail) || [];
    // 90 gün öncesindeki uçuşları bul
    const before90 = flights.filter(f => {
      const diff = daysDiff(r.fault.date, f.flightDate);
      return diff > 0 && diff <= 90;
    });

    // PFD ortalaması
    let pfdSum = 0, pfdN = 0;
    for (const f of before90) {
      if (f.normalizedPfd > 0 && f.normalizedPfd <= 105) {
        pfdSum += f.normalizedPfd;
        pfdN++;
      }
    }
    const avgPfd = pfdN > 0 ? (pfdSum / pfdN).toFixed(1) : 'N/A';

    console.log('  📌 ' + r.fault.tail + ' | ' + r.fault.date);
    console.log('     Açıklama: ' + r.fault.desc.substring(0, 100));
    console.log('     90g öncesi uçuş sayısı: ' + before90.length + ' | Ort PFD: ' + avgPfd + '%');

    if (before90.length === 0) {
      console.log('     ⚠️  NEDEN: Arıza öncesi 90 gün içinde hiç uçuş verisi yok');
    } else {
      console.log('     ⚠️  NEDEN: Uçuş verileri tüm parametrelerde normal aralıkta');
      console.log('     → Ani arıza (sudden failure) veya parametrelerimizle yakalanamayan tip');
    }
    console.log('');
  }
}

// ─── BÖLÜM J: SONUÇ VE ÖNERİLER ───
console.log('');
console.log('┌──────────────────────────────────────────────────────────────────────┐');
console.log('│  J) SONUÇ VE ÖNERİLER                                              │');
console.log('└──────────────────────────────────────────────────────────────────────┘');
console.log('');

console.log('  📊 PERFORMANS ÖZETİ:');
console.log('  ─────────────────────');
console.log('  • Direkt yakalama oranı:      %' + catchRate.toFixed(1));
console.log('    - Kritikten yakalama:        %' + (totalFaultsAnalyzed > 0 ? (caughtCritical.length / totalFaultsAnalyzed * 100).toFixed(1) : '0.0'));
console.log('    - Uyarıdan yakalama:         %' + (totalFaultsAnalyzed > 0 ? (caughtWarning.length / totalFaultsAnalyzed * 100).toFixed(1) : '0.0'));
console.log('  • 90g tahminsel sinyal oranı: %' + (totalFaultsAnalyzed > 0 ? (sig90 / totalFaultsAnalyzed * 100).toFixed(1) : '0.0'));
console.log('  • Kaçırılan arıza:            ' + missed.length + ' adet (%' + (totalFaultsAnalyzed > 0 ? (missed.length / totalFaultsAnalyzed * 100).toFixed(1) : '0.0') + ')');
console.log('  • Ek uyarı (false positive/erken tespit): ' + (extraCriticals.length + extraWarnings.length) + ' adet');
console.log('');

if (missed.length > 0) {
  console.log('  🔧 İYİLEŞTİRME ÖNERİLERİ:');
  console.log('  ──────────────────────────');
  console.log('  1. Kaçırılan arızalar için eşik değerleri düşürülebilir');
  console.log('     (PFD 92-95 aralığını da hafif uyarıya dahil etmek)');
  console.log('  2. Duration ratio 2.5x üzeri için yeni bir uyarı seviyesi eklenebilir');
  console.log('  3. Extension time 7-10s aralığı da hafif sinyal olarak değerlendirilebilir');
  console.log('  4. Landing distance inversiyonunun ağırlığı düşürülebilir');
  console.log('     (sensör sorunu, speedbrake sorunu değil)');
  console.log('');
}

console.log('  📈 İSTATİSTİKLER:');
console.log('  ─────────────────');
console.log('  • Filo genelinde kritik oran: ' + pct(totalCritical, allFlights.length) + ' (' + totalCritical + '/' + allFlights.length + ')');
console.log('  • Filo genelinde uyarı oranı: ' + pct(totalWarning, allFlights.length) + ' (' + totalWarning + '/' + allFlights.length + ')');
console.log('  • Toplam alarm oranı:         ' + pct(totalCritical + totalWarning, allFlights.length) + ' (' + (totalCritical + totalWarning) + '/' + allFlights.length + ')');
console.log('');
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  Simülasyon tamamlandı. ✅');
console.log('═══════════════════════════════════════════════════════════════════════');
