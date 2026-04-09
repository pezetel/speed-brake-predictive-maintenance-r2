// ============================================================
// SPEEDBRAKE ARIZA EŞLEŞTİRME ANALİZİ
// speed brake info.xlsx (tüm uçuş verisi) vs speedbrake arızaları filtreli.xlsx (gerçek arızalar)
//
// Amaç: Arama kriterlerimiz gerçek arızaların yüzde kaçını yakalıyor?
//   - Kritikten yakalanan %
//   - Uyarıdan yakalanan %
//   - Yakalanmayan arızalar ve %
//   - Arızalar haricinde kaç ek uyarı/kritik çıkıyor (false positive)
//
// Run: npx tsx fault-match-analysis.ts
// ============================================================

import * as XLSX from 'xlsx';
import { parseExcelData } from './lib/utils';
import { FlightRecord } from './lib/types';

const FAULT_FILE = 'speedbrake arızaları filtreli.xlsx';
const DATA_FILE = 'speed brake info.xlsx';

// ─── Yardımcı fonksiyonlar ───
function daysDiff(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

function padR(s: string, len: number): string { return s.padEnd(len); }
function padL(s: string, len: number): string { return s.padStart(len); }

// ═══════════════════════════════════════════════════════════════
// 1. UÇUŞ VERİSİNİ OKU (speed brake info.xlsx)
// ═══════════════════════════════════════════════════════════════
console.log('📂 Uçuş verisi okunuyor: ' + DATA_FILE);
const dataWb = XLSX.readFile(DATA_FILE);
let allFlights: FlightRecord[] = [];
for (const sheetName of dataWb.SheetNames) {
  const ws = dataWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  allFlights = allFlights.concat(parseExcelData(rows));
}
console.log('  Toplam uçuş: ' + allFlights.length);

// Tarih aralığını bul
let minDate = '9999-12-31';
let maxDate = '0000-01-01';
for (const f of allFlights) {
  if (f.flightDate < minDate) minDate = f.flightDate;
  if (f.flightDate > maxDate) maxDate = f.flightDate;
}
console.log('  Tarih aralığı: ' + minDate + ' → ' + maxDate);

// Tail bazlı grupla
const byTail = new Map<string, FlightRecord[]>();
for (const f of allFlights) {
  let arr = byTail.get(f.tailNumber);
  if (!arr) { arr = []; byTail.set(f.tailNumber, arr); }
  arr.push(f);
}
for (const [, arr] of byTail) arr.sort((a, b) => a.flightDate.localeCompare(b.flightDate));

console.log('  Benzersiz kuyruk sayısı: ' + byTail.size);

// ═══════════════════════════════════════════════════════════════
// 2. ARIZA KAYITLARINI OKU (speedbrake arızaları filtreli.xlsx)
// ═══════════════════════════════════════════════════════════════
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
  console.log('  Sheet "' + sheetName + '": ' + rows.length + ' satır');

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

allFaults.sort((a, b) => a.date.localeCompare(b.date));
console.log('  Toplam arıza kaydı: ' + allFaults.length);

// ═══════════════════════════════════════════════════════════════
// 3. UÇUŞ VERİSİ ARALIGINA DÜŞEN ARIZALARI FİLTRELE
// ═══════════════════════════════════════════════════════════════
const faultsInRange = allFaults.filter(f => f.date >= minDate && f.date <= maxDate);
const faultsBeforeRange = allFaults.filter(f => f.date < minDate);
const faultsAfterRange = allFaults.filter(f => f.date > maxDate);

console.log('');
console.log('┌─────────────────────────────────────────────────────────┐');
console.log('│  ARIZA DAĞILIMI vs UÇUŞ VERİSİ ARALIĞI                 │');
console.log('├─────────────────────────────────────────────────────────┤');
console.log('│  Uçuş verisi aralığı : ' + minDate + ' → ' + maxDate + '       │');
console.log('│  Toplam arıza         : ' + padL(String(allFaults.length), 4) + '                             │');
console.log('│  Aralık içinde        : ' + padL(String(faultsInRange.length), 4) + '  (eşleştirme yapılacak)    │');
console.log('│  Aralık öncesi        : ' + padL(String(faultsBeforeRange.length), 4) + '  (veri öncesi, hariç)      │');
console.log('│  Aralık sonrası       : ' + padL(String(faultsAfterRange.length), 4) + '  (veri sonrası, hariç)     │');
console.log('└─────────────────────────────────────────────────────────┘');

// ═══════════════════════════════════════════════════════════════
// 4. HER ARIZA İÇİN TESPİT ANALİZİ (30/60/90 gün penceresi)
// ═══════════════════════════════════════════════════════════════

interface FaultMatchResult {
  fault: FaultRecord;
  tailFlights: number;
  // Arızadan önceki sinyal sayıları (30/60/90 gün)
  crit30: number; warn30: number;
  crit60: number; warn60: number;
  crit90: number; warn90: number;
  // Boolean: herhangi bir sinyal var mı?
  anyCrit90: boolean;
  anyWarn90: boolean;
  anySignal90: boolean;
  // Yakalama yöntemi
  detectedBy: 'KRİTİK' | 'UYARI' | 'YAKALANAMADI';
  // Arıza sonrasında da devam eden sinyal var mı?
  critAfter30: number;
  warnAfter30: number;
  // En yakın kritik/uyarı sinyalin arızadan kaç gün önce olduğu
  closestCritDays: number | null;
  closestWarnDays: number | null;
}

const matchResults: FaultMatchResult[] = [];

for (const fault of faultsInRange) {
  const flights = byTail.get(fault.tail) || [];

  let c30 = 0, c60 = 0, c90 = 0;
  let w30 = 0, w60 = 0, w90 = 0;
  let cA30 = 0, wA30 = 0;
  let closestCrit: number | null = null;
  let closestWarn: number | null = null;

  for (const f of flights) {
    const diff = daysDiff(fault.date, f.flightDate); // pozitif = uçuş arızadan ÖNCE

    if (diff > 0 && diff <= 90) {
      if (f.anomalyLevel === 'critical') {
        c90++;
        if (diff <= 60) c60++;
        if (diff <= 30) c30++;
        if (closestCrit === null || diff < closestCrit) closestCrit = diff;
      } else if (f.anomalyLevel === 'warning') {
        w90++;
        if (diff <= 60) w60++;
        if (diff <= 30) w30++;
        if (closestWarn === null || diff < closestWarn) closestWarn = diff;
      }
    } else if (diff < 0 && diff >= -30) {
      // Arızadan SONRA 30 gün
      if (f.anomalyLevel === 'critical') cA30++;
      if (f.anomalyLevel === 'warning') wA30++;
    }
  }

  const anyCrit90 = c90 > 0;
  const anyWarn90 = w90 > 0;
  const anySignal90 = c90 + w90 > 0;

  let detectedBy: FaultMatchResult['detectedBy'] = 'YAKALANAMADI';
  if (anyCrit90) detectedBy = 'KRİTİK';
  else if (anyWarn90) detectedBy = 'UYARI';

  matchResults.push({
    fault,
    tailFlights: flights.length,
    crit30: c30, warn30: w30,
    crit60: c60, warn60: w60,
    crit90: c90, warn90: w90,
    anyCrit90, anyWarn90, anySignal90,
    detectedBy,
    critAfter30: cA30,
    warnAfter30: wA30,
    closestCritDays: closestCrit,
    closestWarnDays: closestWarn,
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. SONUÇLARI HESAPLA
// ═══════════════════════════════════════════════════════════════
const total = matchResults.length;
const detectedByCritical = matchResults.filter(r => r.detectedBy === 'KRİTİK');
const detectedByWarning = matchResults.filter(r => r.detectedBy === 'UYARI');
const notDetected = matchResults.filter(r => r.detectedBy === 'YAKALANAMADI');
const detectedAny = matchResults.filter(r => r.anySignal90);

// Arıza olan tail'ler
const faultTailSet = new Set(allFaults.map(f => f.tail));

// Arızası olmayan tail'lerdeki sinyal sayısı (false positive)
let fpCriticalFlights = 0;
let fpWarningFlights = 0;
let fpCriticalTails = new Set<string>();
let fpWarningTails = new Set<string>();

// Arızası OLAN tail'lerdeki toplam sinyal sayısı
let tpCriticalFlights = 0;
let tpWarningFlights = 0;

for (const [tail, flights] of byTail) {
  const isFaultyTail = faultTailSet.has(tail);
  for (const f of flights) {
    if (f.anomalyLevel === 'critical') {
      if (isFaultyTail) {
        tpCriticalFlights++;
      } else {
        fpCriticalFlights++;
        fpCriticalTails.add(tail);
      }
    } else if (f.anomalyLevel === 'warning') {
      if (isFaultyTail) {
        tpWarningFlights++;
      } else {
        fpWarningFlights++;
        fpWarningTails.add(tail);
      }
    }
  }
}

// Toplam filo istatistikleri
let totalNormal = 0, totalWarning = 0, totalCritical = 0;
for (const f of allFlights) {
  if (f.anomalyLevel === 'critical') totalCritical++;
  else if (f.anomalyLevel === 'warning') totalWarning++;
  else totalNormal++;
}

// ═══════════════════════════════════════════════════════════════
// 6. ANA RAPOR TABLOSU
// ═══════════════════════════════════════════════════════════════
console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                   SPEEDBRAKE ARIZA TESPİT PERFORMANSI RAPORU                            ║');
console.log('║                   Analiz Tarihi: ' + new Date().toISOString().split('T')[0] + '                                           ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                        ║');
console.log('║  Uçuş Verisi     : ' + padR(String(allFlights.length) + ' uçuş (' + byTail.size + ' uçak)', 50) + '           ║');
console.log('║  Tarih Aralığı   : ' + padR(minDate + ' → ' + maxDate, 50) + '           ║');
console.log('║  Eşleşen Arıza   : ' + padR(String(faultsInRange.length) + ' arıza kaydı (aralık içinde)', 50) + '           ║');
console.log('║                                                                                        ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                        ║');
console.log('║  📊 TESPİT ORANI (90 gün penceresi)                                                    ║');
console.log('║  ────────────────────────────────────                                                   ║');
console.log('║                                                                                        ║');
console.log('║  ✅ KRİTİK ile yakalanan  : ' + padR(padL(String(detectedByCritical.length), 3) + ' / ' + total + '  →  ' + padL(pct(detectedByCritical.length, total), 6), 43) + '           ║');
console.log('║  ⚠️  UYARI ile yakalanan   : ' + padR(padL(String(detectedByWarning.length), 3) + ' / ' + total + '  →  ' + padL(pct(detectedByWarning.length, total), 6), 43) + '          ║');
console.log('║  ─────────────────────────────────────────────────────                                   ║');
console.log('║  ✅ TOPLAM YAKALANAN      : ' + padR(padL(String(detectedAny.length), 3) + ' / ' + total + '  →  ' + padL(pct(detectedAny.length, total), 6), 43) + '           ║');
console.log('║  ❌ YAKALANAMAYAN          : ' + padR(padL(String(notDetected.length), 3) + ' / ' + total + '  →  ' + padL(pct(notDetected.length, total), 6), 43) + '           ║');
console.log('║                                                                                        ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                        ║');
console.log('║  📊 PENCERE BAZLI TESPİT DETAYI                                                        ║');
console.log('║  ────────────────────────────────                                                       ║');

const det30Crit = matchResults.filter(r => r.crit30 > 0).length;
const det30Warn = matchResults.filter(r => r.warn30 > 0 && r.crit30 === 0).length;
const det30Any = matchResults.filter(r => r.crit30 + r.warn30 > 0).length;

const det60Crit = matchResults.filter(r => r.crit60 > 0).length;
const det60Warn = matchResults.filter(r => r.warn60 > 0 && r.crit60 === 0).length;
const det60Any = matchResults.filter(r => r.crit60 + r.warn60 > 0).length;

const det90Crit = matchResults.filter(r => r.crit90 > 0).length;
const det90Warn = matchResults.filter(r => r.warn90 > 0 && r.crit90 === 0).length;
const det90Any = matchResults.filter(r => r.crit90 + r.warn90 > 0).length;

console.log('║                                                                                        ║');
console.log('║  Pencere    │ Kritik ile │  Uyarı ile │  Toplam    │  Yakalanma %                       ║');
console.log('║  ─────────  │ ────────── │  ────────  │  ─────────  │ ────────────                      ║');
console.log('║  Son 30 gün │ ' + padL(String(det30Crit), 5) + padR('', 5) + '│  ' + padL(String(det30Warn), 5) + padR('', 4) + '│  ' + padL(String(det30Any), 5) + padR('', 5) + '│  ' + padL(pct(det30Any, total), 6) + '                              ║');
console.log('║  Son 60 gün │ ' + padL(String(det60Crit), 5) + padR('', 5) + '│  ' + padL(String(det60Warn), 5) + padR('', 4) + '│  ' + padL(String(det60Any), 5) + padR('', 5) + '│  ' + padL(pct(det60Any, total), 6) + '                              ║');
console.log('║  Son 90 gün │ ' + padL(String(det90Crit), 5) + padR('', 5) + '│  ' + padL(String(det90Warn), 5) + padR('', 4) + '│  ' + padL(String(det90Any), 5) + padR('', 5) + '│  ' + padL(pct(det90Any, total), 6) + '                              ║');
console.log('║                                                                                        ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                        ║');
console.log('║  📊 ARIZALAR HARİCİNDE ÇIKAN EK SİNYALLER (False Positive Analizi)                     ║');
console.log('║  ────────────────────────────────────────────────────────                                ║');
console.log('║                                                                                        ║');
console.log('║  Arızası OLMAYAN uçak sayısı : ' + padL(String(byTail.size - faultTailSet.size), 4) + ' / ' + padL(String(byTail.size), 4) + ' uçak                           ║');
console.log('║                                                                                        ║');
console.log('║  Bu uçaklarda çıkan sinyaller:                                                         ║');
console.log('║    Kritik uçuş sayısı : ' + padL(String(fpCriticalFlights), 6) + '  (' + padL(String(fpCriticalTails.size), 3) + ' farklı uçak)                            ║');
console.log('║    Uyarı uçuş sayısı  : ' + padL(String(fpWarningFlights), 6) + '  (' + padL(String(fpWarningTails.size), 3) + ' farklı uçak)                            ║');
console.log('║    Toplam ek sinyal   : ' + padL(String(fpCriticalFlights + fpWarningFlights), 6) + ' uçuş                                        ║');
console.log('║                                                                                        ║');
console.log('║  Arızası OLAN uçaklarda sinyaller:                                                      ║');
console.log('║    Kritik uçuş sayısı : ' + padL(String(tpCriticalFlights), 6) + '                                                   ║');
console.log('║    Uyarı uçuş sayısı  : ' + padL(String(tpWarningFlights), 6) + '                                                   ║');
console.log('║                                                                                        ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                        ║');
console.log('║  📊 FİLO GENELİ SİNYAL DAĞILIMI                                                        ║');
console.log('║  ─────────────────────────────────                                                      ║');
console.log('║                                                                                        ║');
console.log('║    Normal   : ' + padL(String(totalNormal), 7) + '  (' + padL(pct(totalNormal, allFlights.length), 6) + ')                                       ║');
console.log('║    Uyarı    : ' + padL(String(totalWarning), 7) + '  (' + padL(pct(totalWarning, allFlights.length), 6) + ')                                       ║');
console.log('║    Kritik   : ' + padL(String(totalCritical), 7) + '  (' + padL(pct(totalCritical, allFlights.length), 6) + ')                                       ║');
console.log('║    TOPLAM   : ' + padL(String(allFlights.length), 7) + '                                                        ║');
console.log('║                                                                                        ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════════════════╝');

// ═══════════════════════════════════════════════════════════════
// 7. YAKALANAN ARIZALAR DETAY TABLOSU
// ═══════════════════════════════════════════════════════════════
console.log('');
console.log('═'.repeat(140));
console.log('  ✅ YAKALANAN ARIZALAR DETAYI (' + detectedAny.length + ' arıza)');
console.log('═'.repeat(140));
console.log(
  padR('Kuyruk', 10) +
  padR('Arıza Trh', 13) +
  padR('Tespit', 12) +
  padL('C<30g', 6) +
  padL('W<30g', 6) +
  padL('C<60g', 6) +
  padL('W<60g', 6) +
  padL('C<90g', 6) +
  padL('W<90g', 6) +
  padR('  En Yakın Sinyal', 20) +
  '  Açıklama'
);
console.log('─'.repeat(140));

const detected = matchResults.filter(r => r.anySignal90);
detected.sort((a, b) => a.fault.date.localeCompare(b.fault.date));

for (const r of detected) {
  const closestStr = r.closestCritDays !== null
    ? 'Kritik ' + r.closestCritDays + 'g önce'
    : r.closestWarnDays !== null
      ? 'Uyarı ' + r.closestWarnDays + 'g önce'
      : '-';

  console.log(
    padR(r.fault.tail, 10) +
    padR(r.fault.date, 13) +
    padR(r.detectedBy, 12) +
    padL(String(r.crit30), 6) +
    padL(String(r.warn30), 6) +
    padL(String(r.crit60), 6) +
    padL(String(r.warn60), 6) +
    padL(String(r.crit90), 6) +
    padL(String(r.warn90), 6) +
    '  ' + padR(closestStr, 18) +
    '  ' + r.fault.desc.substring(0, 50)
  );
}

// ═══════════════════════════════════════════════════════════════
// 8. YAKALANAMAYAN ARIZALAR DETAY TABLOSU
// ═══════════════════════════════════════════════════════════════
console.log('');
console.log('═'.repeat(140));
console.log('  ❌ YAKALANAMAYAN ARIZALAR DETAYI (' + notDetected.length + ' arıza)');
console.log('═'.repeat(140));

if (notDetected.length === 0) {
  console.log('  Tüm arızalar en az bir sinyal ile yakalanmış! 🎉');
} else {
  console.log(
    padR('Kuyruk', 10) +
    padR('Arıza Trh', 13) +
    padL('Uçuş#', 7) +
    padL('SonraCrit', 11) +
    padL('SonraWarn', 11) +
    '  Açıklama'
  );
  console.log('─'.repeat(140));

  for (const r of notDetected) {
    console.log(
      padR(r.fault.tail, 10) +
      padR(r.fault.date, 13) +
      padL(String(r.tailFlights), 7) +
      padL(String(r.critAfter30), 11) +
      padL(String(r.warnAfter30), 11) +
      '  ' + r.fault.desc.substring(0, 80)
    );
  }

  // Neden yakalanmadığını analiz et
  console.log('');
  console.log('  Yakalanmama nedenleri analizi:');
  const noFlightData = notDetected.filter(r => r.tailFlights === 0);
  const hasFlightsButNoSignal = notDetected.filter(r => r.tailFlights > 0);
  const postSignal = notDetected.filter(r => r.critAfter30 > 0 || r.warnAfter30 > 0);

  console.log('    Hiç uçuş verisi yok          : ' + noFlightData.length);
  console.log('    Uçuş verisi var, sinyal yok   : ' + hasFlightsButNoSignal.length);
  console.log('    Arıza sonrası sinyal var      : ' + postSignal.length + ' (sorun devam etmiş olabilir)');
}

// ═══════════════════════════════════════════════════════════════
// 9. ARIZA DIŞI EK SİNYALLER — Detay (False Positive Tail'ler)
// ═══════════════════════════════════════════════════════════════
console.log('');
console.log('═'.repeat(140));
console.log('  📋 ARIZASI OLMAYAN UÇAKLARDA ÇIKAN SİNYALLER (False Positive Detay)');
console.log('═'.repeat(140));

if (fpCriticalTails.size + fpWarningTails.size === 0) {
  console.log('  Arızası olmayan uçaklarda hiç sinyal çıkmamış.');
} else {
  const fpAllTails = new Set([...fpCriticalTails, ...fpWarningTails]);

  console.log(
    padR('Kuyruk', 10) +
    padL('Uçuş#', 7) +
    padL('Kritik', 8) +
    padL('Uyarı', 8) +
    padL('Normal', 8) +
    padL('AvgPFD', 9) +
    padL('MinPFD', 9) +
    '  Durum'
  );
  console.log('─'.repeat(100));

  const fpTailEntries: { tail: string; critCount: number; warnCount: number; normCount: number; avgPfd: number; minPfd: number; totalFlights: number }[] = [];

  for (const tail of fpAllTails) {
    const flights = byTail.get(tail) || [];
    let crit = 0, warn = 0, norm = 0, pfdSum = 0, pfdN = 0, minPfd = 999;
    for (const f of flights) {
      if (f.anomalyLevel === 'critical') crit++;
      else if (f.anomalyLevel === 'warning') warn++;
      else norm++;
      if (f.normalizedPfd > 0 && f.normalizedPfd <= 105) {
        pfdSum += f.normalizedPfd;
        pfdN++;
        if (f.normalizedPfd < minPfd) minPfd = f.normalizedPfd;
      }
    }
    const avgPfd = pfdN > 0 ? pfdSum / pfdN : 0;
    fpTailEntries.push({ tail, critCount: crit, warnCount: warn, normCount: norm, avgPfd, minPfd: minPfd === 999 ? 0 : minPfd, totalFlights: flights.length });
  }

  fpTailEntries.sort((a, b) => (b.critCount + b.warnCount) - (a.critCount + a.warnCount));

  for (const e of fpTailEntries.slice(0, 30)) {
    const status = e.critCount > 2 ? '⚠️ Potansiyel sorun?'
                 : e.critCount > 0 ? '🔍 İncelenmeli'
                 : '📋 Sadece uyarı';
    console.log(
      padR(e.tail, 10) +
      padL(String(e.totalFlights), 7) +
      padL(String(e.critCount), 8) +
      padL(String(e.warnCount), 8) +
      padL(String(e.normCount), 8) +
      padL(e.avgPfd.toFixed(1), 9) +
      padL(e.minPfd.toFixed(1), 9) +
      '  ' + status
    );
  }
  if (fpTailEntries.length > 30) {
    console.log('  ... ve ' + (fpTailEntries.length - 30) + ' uçak daha');
  }
}

// ═══════════════════════════════════════════════════════════════
// 10. LEAD TIME ANALİZİ (Yakalanan arızalarda ne kadar erken?)
// ═══════════════════════════════════════════════════════════════
console.log('');
console.log('═'.repeat(100));
console.log('  ⏱️  LEAD TIME ANALİZİ (Arıza öncesi en erken sinyal)');
console.log('═'.repeat(100));

const withCritLead = detected.filter(r => r.closestCritDays !== null);
const withWarnLead = detected.filter(r => r.closestWarnDays !== null);

if (withCritLead.length > 0) {
  const critLeads = withCritLead.map(r => r.closestCritDays!).sort((a, b) => a - b);
  const avg = critLeads.reduce((s, v) => s + v, 0) / critLeads.length;
  const median = critLeads[Math.floor(critLeads.length / 2)];
  console.log('');
  console.log('  Kritik sinyal → Arıza arası süre:');
  console.log('    Min: ' + critLeads[0] + ' gün | Medyan: ' + median + ' gün | Ortalama: ' + avg.toFixed(1) + ' gün | Maks: ' + critLeads[critLeads.length - 1] + ' gün');

  console.log('    Dağılım:');
  for (const window of [7, 14, 30, 60, 90]) {
    const count = critLeads.filter(d => d <= window).length;
    const bar = '█'.repeat(Math.round((count / critLeads.length) * 30));
    console.log('      <=' + padL(String(window), 3) + 'g: ' + padL(String(count), 3) + '/' + critLeads.length + ' (' + padL(pct(count, critLeads.length), 6) + ') ' + bar);
  }
}

if (withWarnLead.length > 0) {
  const warnLeads = withWarnLead.map(r => r.closestWarnDays!).sort((a, b) => a - b);
  const avg = warnLeads.reduce((s, v) => s + v, 0) / warnLeads.length;
  const median = warnLeads[Math.floor(warnLeads.length / 2)];
  console.log('');
  console.log('  Uyarı sinyal → Arıza arası süre:');
  console.log('    Min: ' + warnLeads[0] + ' gün | Medyan: ' + median + ' gün | Ortalama: ' + avg.toFixed(1) + ' gün | Maks: ' + warnLeads[warnLeads.length - 1] + ' gün');
}

// ═══════════════════════════════════════════════════════════════
// 11. NİHAİ ÖZET TABLOSU
// ═══════════════════════════════════════════════════════════════
console.log('');
console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║                         NİHAİ ÖZET TABLOSU                                  ║');
console.log('╠══════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                             ║');
console.log('║  KATEGORİ                          │ SAYI      │ YÜZDE                      ║');
console.log('║  ─────────────────────────────────  │ ───────── │ ─────────                  ║');
console.log('║                                     │           │                            ║');
console.log('║  Toplam Eşleşen Arıza               │ ' + padL(String(total), 6) + '    │                            ║');
console.log('║                                     │           │                            ║');
console.log('║  KRİTİK ile yakalanan               │ ' + padL(String(detectedByCritical.length), 6) + '    │ ' + padL(pct(detectedByCritical.length, total), 6) + '                     ║');
console.log('║  UYARI ile yakalanan                 │ ' + padL(String(detectedByWarning.length), 6) + '    │ ' + padL(pct(detectedByWarning.length, total), 6) + '                     ║');
console.log('║  TOPLAM YAKALANAN                   │ ' + padL(String(detectedAny.length), 6) + '    │ ' + padL(pct(detectedAny.length, total), 6) + '                     ║');
console.log('║  YAKALANAMAYAN                      │ ' + padL(String(notDetected.length), 6) + '    │ ' + padL(pct(notDetected.length, total), 6) + '                     ║');
console.log('║                                     │           │                            ║');
console.log('║  ─────────────────────────────────  │ ───────── │ ─────────                  ║');
console.log('║  Arıza dışı ek KRİTİK uçuş         │ ' + padL(String(fpCriticalFlights), 6) + '    │ (' + padL(String(fpCriticalTails.size), 3) + ' uçak)                ║');
console.log('║  Arıza dışı ek UYARI uçuş           │ ' + padL(String(fpWarningFlights), 6) + '    │ (' + padL(String(fpWarningTails.size), 3) + ' uçak)                ║');
console.log('║  Arıza dışı TOPLAM ek sinyal         │ ' + padL(String(fpCriticalFlights + fpWarningFlights), 6) + '    │                            ║');
console.log('║                                     │           │                            ║');
console.log('║  ─────────────────────────────────  │ ───────── │ ─────────                  ║');
console.log('║  Filo Toplam Uçuş                   │ ' + padL(String(allFlights.length), 6) + '    │ 100.0%                     ║');
console.log('║  Filo Normal                        │ ' + padL(String(totalNormal), 6) + '    │ ' + padL(pct(totalNormal, allFlights.length), 6) + '                     ║');
console.log('║  Filo Uyarı                          │ ' + padL(String(totalWarning), 6) + '    │ ' + padL(pct(totalWarning, allFlights.length), 6) + '                     ║');
console.log('║  Filo Kritik                        │ ' + padL(String(totalCritical), 6) + '    │ ' + padL(pct(totalCritical, allFlights.length), 6) + '                     ║');
console.log('║                                     │           │                            ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

console.log('');
console.log('✅ Analiz tamamlandı.');
console.log('');
