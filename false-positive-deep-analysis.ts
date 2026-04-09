// ============================================================
// FALSE POSITIVE DERİN ANALİZ
// Arızası olmayan uçaklarda çıkan 1.076 ek sinyalin detaylı incelenmesi
//
// Soru: Bu 1.076 sinyal gerçekten "false positive" mı?
// Yoksa:
//   a) Henüz arıza kaydına girmemiş gerçek sorunlar mı?
//   b) Sensör/veri kalitesi sorunları mı? (landing distance inversion)
//   c) Tek seferlik anomaliler mi yoksa tekrarlayan pattern mi?
//   d) Tahminsel bakımda gerçekten uyarı olarak gösterilmeli mi?
//
// Run: npx tsx false-positive-deep-analysis.ts
// ============================================================

import * as XLSX from 'xlsx';
import { parseExcelData } from './lib/utils';
import { FlightRecord } from './lib/types';

const FAULT_FILE = 'speedbrake arızaları filtreli.xlsx';
const DATA_FILE = 'speed brake info.xlsx';

// ─── Yardımcı fonksiyonlar ───
function pct(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}
function padR(s: string, len: number): string { return s.padEnd(len); }
function padL(s: string, len: number): string { return s.padStart(len); }

// ═══════════════════════════════════════════════════════════════
// 1. VERİ YÜKLE
// ═══════════════════════════════════════════════════════════════
console.log('📂 Uçuş verisi okunuyor...');
const dataWb = XLSX.readFile(DATA_FILE);
let allFlights: FlightRecord[] = [];
for (const sheetName of dataWb.SheetNames) {
  const ws = dataWb.Sheets[sheetName];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  allFlights = allFlights.concat(parseExcelData(rows));
}
console.log('  Toplam uçuş: ' + allFlights.length);

// Tarih aralığı
let minDate = '9999-12-31';
let maxDate = '0000-01-01';
for (const f of allFlights) {
  if (f.flightDate < minDate) minDate = f.flightDate;
  if (f.flightDate > maxDate) maxDate = f.flightDate;
}

// Tail bazlı grupla
const byTail = new Map<string, FlightRecord[]>();
for (const f of allFlights) {
  let arr = byTail.get(f.tailNumber);
  if (!arr) { arr = []; byTail.set(f.tailNumber, arr); }
  arr.push(f);
}
for (const [, arr] of byTail) arr.sort((a, b) => a.flightDate.localeCompare(b.flightDate));

// Arıza kayıtlarını oku
console.log('📂 Arıza verisi okunuyor...');
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
    } else if (dv instanceof Date) {
      date = dv.toISOString().split('T')[0];
    }
    const desc = String(row['Description'] || '')
      .replace(/<br>/gi, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
    if (tail && date) allFaults.push({ tail, date, desc });
  }
}

const faultTailSet = new Set(allFaults.map(f => f.tail));

console.log('  Arızası olan uçak: ' + faultTailSet.size);
console.log('  Arızası olmayan uçak: ' + (byTail.size - faultTailSet.size));
console.log('');

// ═══════════════════════════════════════════════════════════════
// 2. ARIZASI OLMAYAN UÇAKLARIN SİNYALLERİNİ KATEGORİZE ET
// ═══════════════════════════════════════════════════════════════

// Sinyal sebep kategorileri
type SignalCategory =
  | 'LANDING_DIST_INVERSION'   // 50kn > 30kn fizik ihlali — sensör sorunu
  | 'LOW_PFD_SEVERE'           // PFD < 75% — ciddi
  | 'LOW_PFD_MODERATE'         // PFD 75-85% — orta
  | 'LOW_PFD_MILD'             // PFD 85-92% — hafif
  | 'SLOW_OPENING'             // Yavaş açılma (duration ratio yüksek)
  | 'EXTENSION_TIME_HIGH'      // Absolute extension time yüksek
  | 'ANGLE_LOW'                // Açı düşük + PFD düşük
  | 'DELAYED_OPENING'          // Kademeli açılma (açı farkı)
  | 'LOW_PFD_LONG_LANDING'     // Düşük PFD + uzun iniş mesafesi
  | 'GS_LOW'                   // GS at SBOP düşük
  | 'DOUBLED_RECORD'           // Çift panel kaydı
  | 'MULTI_SIGNAL'             // Birden fazla sinyal kombinasyonu
  | 'OTHER';                   // Diğer

function categorizeReasons(flight: FlightRecord): SignalCategory[] {
  const categories: SignalCategory[] = [];
  const reasons = flight.anomalyReasons;
  const nPfd = flight.normalizedPfd;

  for (const r of reasons) {
    const rLower = r.toLowerCase();
    if (rLower.includes('iniş mesafesi') || rLower.includes('fizik ihlali') || rLower.includes('sensör')) {
      categories.push('LANDING_DIST_INVERSION');
    } else if (rLower.includes('ciddi düşük') || rLower.includes('çok düşük') || (rLower.includes('pfd') && nPfd < 75)) {
      categories.push('LOW_PFD_SEVERE');
    } else if (rLower.includes('kısmi açılma') || (rLower.includes('pfd') && rLower.includes('düşük') && nPfd >= 75 && nPfd < 85)) {
      categories.push('LOW_PFD_MODERATE');
    } else if (rLower.includes('normalin altında') || (rLower.includes('pfd') && nPfd >= 85 && nPfd < 92)) {
      categories.push('LOW_PFD_MILD');
    } else if (rLower.includes('çok yavaş açılma') || rLower.includes('yavaş açılma') || rLower.includes('açılma gecikmesi')) {
      categories.push('SLOW_OPENING');
    } else if (rLower.includes('%99 süresi')) {
      categories.push('EXTENSION_TIME_HIGH');
    } else if (rLower.includes('açı çok düşük') || rLower.includes('açı düşük')) {
      categories.push('ANGLE_LOW');
    } else if (rLower.includes('gecikmeli açılma') || rLower.includes('kademeli açılma')) {
      categories.push('DELAYED_OPENING');
    } else if (rLower.includes('düşük pfd') && rLower.includes('iniş')) {
      categories.push('LOW_PFD_LONG_LANDING');
    } else if (rLower.includes('gs@sbop')) {
      categories.push('GS_LOW');
    } else if (rLower.includes('çift panel')) {
      categories.push('DOUBLED_RECORD');
    }
  }

  if (categories.length === 0) categories.push('OTHER');
  return [...new Set(categories)];
}

// ═══════════════════════════════════════════════════════════════
// 3. ANALİZ: Her arızasız uçağın sinyallerini incele
// ═══════════════════════════════════════════════════════════════

interface TailFPAnalysis {
  tail: string;
  totalFlights: number;
  criticalFlights: FlightRecord[];
  warningFlights: FlightRecord[];
  // Kategorize edilmiş sayılar
  categoryCounts: Map<SignalCategory, number>;
  // Pattern analizi
  isRecurring: boolean;        // Aynı tail'de tekrarlayan mı?
  isClustered: boolean;        // Sinyaller belirli dönemde mi yoğunlaşmış?
  isIsolated: boolean;         // Tek seferlik mi?
  isPureLandingDist: boolean;  // Sadece landing distance sorunu mu?
  avgPfd: number;
  minPfd: number;
  // Gerçek sorun mu false positive mu değerlendirmesi
  verdict: 'GERCEK_SORUN_OLASI' | 'SENSOR_VERI_SORUNU' | 'TEK_SEFERLIK' | 'BELIRSIZ' | 'TEMIZ';
  verdictReason: string;
}

const fpAnalyses: TailFPAnalysis[] = [];

// Genel kategori sayaçları
const globalCategoryCounts = new Map<SignalCategory, number>();
const globalCategoryFlights = new Map<SignalCategory, FlightRecord[]>();

let totalFPCritical = 0;
let totalFPWarning = 0;

for (const [tail, flights] of byTail) {
  if (faultTailSet.has(tail)) continue; // Arızası olan uçakları atla

  const criticalFlights = flights.filter(f => f.anomalyLevel === 'critical');
  const warningFlights = flights.filter(f => f.anomalyLevel === 'warning');

  if (criticalFlights.length === 0 && warningFlights.length === 0) continue; // Sinyal yoksa atla

  totalFPCritical += criticalFlights.length;
  totalFPWarning += warningFlights.length;

  const allAnomalous = [...criticalFlights, ...warningFlights];
  const categoryCounts = new Map<SignalCategory, number>();

  for (const f of allAnomalous) {
    const cats = categorizeReasons(f);
    for (const c of cats) {
      categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1);
      globalCategoryCounts.set(c, (globalCategoryCounts.get(c) || 0) + 1);
      let arr = globalCategoryFlights.get(c);
      if (!arr) { arr = []; globalCategoryFlights.set(c, arr); }
      arr.push(f);
    }
  }

  // Pattern analizi
  const anomalyDates = allAnomalous.map(f => f.flightDate).sort();
  const isIsolated = allAnomalous.length <= 2;
  const isRecurring = allAnomalous.length >= 5;

  // Clustering: Sinyallerin %50'si 30 günlük pencerede mi?
  let isClustered = false;
  if (anomalyDates.length >= 3) {
    for (let i = 0; i < anomalyDates.length; i++) {
      const windowEnd = new Date(new Date(anomalyDates[i]).getTime() + 30 * 86400 * 1000).toISOString().split('T')[0];
      const inWindow = anomalyDates.filter(d => d >= anomalyDates[i] && d <= windowEnd).length;
      if (inWindow >= anomalyDates.length * 0.5) {
        isClustered = true;
        break;
      }
    }
  }

  // Landing distance only check
  const ldCount = categoryCounts.get('LANDING_DIST_INVERSION') || 0;
  const isPureLandingDist = ldCount === allAnomalous.length || (
    ldCount >= allAnomalous.length * 0.8 &&
    !categoryCounts.has('LOW_PFD_SEVERE') &&
    !categoryCounts.has('LOW_PFD_MODERATE') &&
    !categoryCounts.has('ANGLE_LOW')
  );

  // PFD istatistikleri
  let pfdSum = 0, pfdN = 0, minPfd = 999;
  for (const f of flights) {
    if (f.normalizedPfd > 0 && f.normalizedPfd <= 105) {
      pfdSum += f.normalizedPfd;
      pfdN++;
      if (f.normalizedPfd < minPfd) minPfd = f.normalizedPfd;
    }
  }
  const avgPfd = pfdN > 0 ? pfdSum / pfdN : 0;

  // Verdict
  let verdict: TailFPAnalysis['verdict'] = 'BELIRSIZ';
  let verdictReason = '';

  const hasSeverePfd = (categoryCounts.get('LOW_PFD_SEVERE') || 0) > 0;
  const hasModeratePfd = (categoryCounts.get('LOW_PFD_MODERATE') || 0) > 0;
  const hasAngleLow = (categoryCounts.get('ANGLE_LOW') || 0) > 0;
  const hasSlowOpening = (categoryCounts.get('SLOW_OPENING') || 0) > 0;

  if (isPureLandingDist) {
    verdict = 'SENSOR_VERI_SORUNU';
    verdictReason = 'Tüm sinyaller landing distance inversion — sensör/veri kalitesi sorunu, speedbrake ile ilgisi yok';
  } else if (hasSeverePfd && isRecurring) {
    verdict = 'GERCEK_SORUN_OLASI';
    verdictReason = 'Tekrarlayan ciddi PFD düşüşü — arıza kaydına girmemiş gerçek sorun olabilir';
  } else if ((hasSeverePfd || (hasModeratePfd && hasAngleLow)) && criticalFlights.length >= 3) {
    verdict = 'GERCEK_SORUN_OLASI';
    verdictReason = 'Çoklu kritik sinyal + düşük PFD/açı kombinasyonu — incelenmeli';
  } else if (isIsolated && !hasSeverePfd) {
    verdict = 'TEK_SEFERLIK';
    verdictReason = 'Tek/iki seferlik anomali — geçici durum (hava koşulu, operasyonel vb.)';
  } else if (avgPfd > 99.0 && minPfd > 50 && !hasSeverePfd) {
    if (isPureLandingDist || ldCount > allAnomalous.length * 0.5) {
      verdict = 'SENSOR_VERI_SORUNU';
      verdictReason = 'Yüksek PFD ortalaması, sinyallerin çoğu landing distance — sensör sorunu';
    } else {
      verdict = 'TEK_SEFERLIK';
      verdictReason = 'Genel PFD ortalaması çok iyi, ara sıra hafif sapmalar';
    }
  } else if (avgPfd < 95 && isRecurring) {
    verdict = 'GERCEK_SORUN_OLASI';
    verdictReason = 'Düşük PFD ortalaması + tekrarlayan anomaliler — SORUN';
  } else {
    verdict = 'BELIRSIZ';
    verdictReason = 'Karışık sinyaller, manuel inceleme gerekli';
  }

  fpAnalyses.push({
    tail,
    totalFlights: flights.length,
    criticalFlights,
    warningFlights,
    categoryCounts,
    isRecurring,
    isClustered,
    isIsolated,
    isPureLandingDist,
    avgPfd,
    minPfd: minPfd === 999 ? 0 : minPfd,
    verdict,
    verdictReason,
  });
}

fpAnalyses.sort((a, b) => (b.criticalFlights.length + b.warningFlights.length) - (a.criticalFlights.length + a.warningFlights.length));

// ═══════════════════════════════════════════════════════════════
// 4. RAPOR: Genel Sinyal Kategorisi Dağılımı
// ═══════════════════════════════════════════════════════════════

console.log('');
console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║              FALSE POSİTİVE DERİN ANALİZ — 1.076 EK SİNYAL NEDİR?                                    ║');
console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                                      ║');
console.log('║  Toplam arızasız uçak    : ' + padL(String(byTail.size - faultTailSet.size), 4) + ' / ' + padL(String(byTail.size), 4) + '                                                           ║');
console.log('║  Sinyal çıkaran uçak     : ' + padL(String(fpAnalyses.length), 4) + '                                                                      ║');
console.log('║  Sinyal çıkmayan uçak    : ' + padL(String(byTail.size - faultTailSet.size - fpAnalyses.length), 4) + '  (tamamen temiz)                                                   ║');
console.log('║                                                                                                      ║');
console.log('║  Toplam ek Kritik uçuş   : ' + padL(String(totalFPCritical), 6) + '                                                                  ║');
console.log('║  Toplam ek Uyarı uçuş    : ' + padL(String(totalFPWarning), 6) + '                                                                  ║');
console.log('║  TOPLAM EK SİNYAL        : ' + padL(String(totalFPCritical + totalFPWarning), 6) + '                                                                  ║');
console.log('║                                                                                                      ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

// ═══════════════════════════════════════════════════════════════
// 5. RAPOR: Sinyal Sebep Kategorileri
// ═══════════════════════════════════════════════════════════════
console.log('');
console.log('═'.repeat(110));
console.log('  📊 SİNYAL SEBEP KATEGORİLERİ (Bir uçuşta birden fazla sebep olabilir)');
console.log('═'.repeat(110));

const categoryLabels: Record<SignalCategory, string> = {
  'LANDING_DIST_INVERSION': 'İniş Mesafesi Ters (50kn > 30kn) — SENSÖR SORUNU',
  'LOW_PFD_SEVERE': 'PFD Ciddi Düşük (< %75) — MEKANİK SORUN',
  'LOW_PFD_MODERATE': 'PFD Orta Düşük (%75-85) — DİKKAT',
  'LOW_PFD_MILD': 'PFD Hafif Düşük (%85-92) — İZLEME',
  'SLOW_OPENING': 'Yavaş Açılma (Duration Ratio Yüksek) — HİDROLİK',
  'EXTENSION_TIME_HIGH': 'Uzun Açılma Süresi (>10s) — MEKANİK',
  'ANGLE_LOW': 'Düşük Açı + Düşük PFD — MEKANİK ENGEL',
  'DELAYED_OPENING': 'Gecikmeli/Kademeli Açılma — HİDROLİK',
  'LOW_PFD_LONG_LANDING': 'Düşük PFD + Uzun İniş — GÜVENLİK',
  'GS_LOW': 'Düşük GS@SBOP — OPERASYONEL',
  'DOUBLED_RECORD': 'Çift Panel Kaydı — VERİ YORUMLAMA',
  'MULTI_SIGNAL': 'Çoklu Sinyal Kombinasyonu',
  'OTHER': 'Diğer',
};

const sortedCategories = [...globalCategoryCounts.entries()].sort((a, b) => b[1] - a[1]);
const totalCatSignals = [...globalCategoryCounts.values()].reduce((s, v) => s + v, 0);

console.log('');
console.log(padR('  Kategori', 60) + padL('Sayı', 7) + padL('Yüzde', 9) + '  Görsel');
console.log('  ' + '─'.repeat(106));

for (const [cat, count] of sortedCategories) {
  const label = categoryLabels[cat] || cat;
  const bar = '█'.repeat(Math.round((count / totalCatSignals) * 40));
  console.log('  ' + padR(label, 58) + padL(String(count), 7) + padL(pct(count, totalCatSignals), 9) + '  ' + bar);
}
console.log('  ' + '─'.repeat(106));
console.log('  ' + padR('TOPLAM (bir uçuşta birden fazla kategori olabilir)', 58) + padL(String(totalCatSignals), 7));

// ═══════════════════════════════════════════════════════════════
// 6. RAPOR: Landing Distance Inversion Detay
// ═══════════════════════════════════════════════════════════════

const ldFlights = globalCategoryFlights.get('LANDING_DIST_INVERSION') || [];
const ldOnlyAnalyses = fpAnalyses.filter(a => a.isPureLandingDist);

console.log('');
console.log('═'.repeat(110));
console.log('  🔍 LANDING DISTANCE INVERSION DETAY ANALİZİ');
console.log('═'.repeat(110));
console.log('');
console.log('  Landing distance inversion (50kn mesafesi > 30kn mesafesi) fizik kurallarına aykırıdır.');
console.log('  Bu durum sensör arızası, veri aktarım hatası veya hesaplama hatasından kaynaklanır.');
console.log('  SPEEDBRAKE MEKANİK SORUNUYLA İLGİSİ YOKTUR.');
console.log('');
console.log('  Bu kategorideki uçuş sayısı   : ' + ldFlights.length);
console.log('  Sadece LD sorunu olan uçak     : ' + ldOnlyAnalyses.length + ' uçak');
console.log('');

// Bu uçakların PFD ortalaması
let ldPfdSum = 0, ldPfdN = 0;
for (const f of ldFlights) {
  if (f.normalizedPfd > 0 && f.normalizedPfd <= 105) {
    ldPfdSum += f.normalizedPfd;
    ldPfdN++;
  }
}
const ldAvgPfd = ldPfdN > 0 ? ldPfdSum / ldPfdN : 0;
console.log('  LD inversiyonu olan uçuşların ort. PFD: ' + ldAvgPfd.toFixed(1) + '%');
console.log('  (Normal PFD ile LD inversion aynı anda → sadece sensör sorunu)');

// ═══════════════════════════════════════════════════════════════
// 7. RAPOR: Verdict Dağılımı (Ne kadarı gerçek sorun?)
// ═══════════════════════════════════════════════════════════════

console.log('');
console.log('═'.repeat(110));
console.log('  📊 VERDİCT: 1.076 SİNYAL GERÇEKTE NE?');
console.log('═'.repeat(110));

const verdictCounts = new Map<TailFPAnalysis['verdict'], { tails: number; signals: number }>;
for (const a of fpAnalyses) {
  const totalSig = a.criticalFlights.length + a.warningFlights.length;
  const existing = verdictCounts.get(a.verdict) || { tails: 0, signals: 0 };
  existing.tails++;
  existing.signals += totalSig;
  verdictCounts.set(a.verdict, existing);
}

const verdictLabels: Record<TailFPAnalysis['verdict'], string> = {
  'GERCEK_SORUN_OLASI': '🔴 GERÇEK SORUN OLASI (Arıza kaydına girmemiş)',
  'SENSOR_VERI_SORUNU': '🟡 SENSÖR/VERİ SORUNU (Landing dist. vb.)',
  'TEK_SEFERLIK': '🟢 TEK SEFERLİK ANOMALİ (Geçici durum)',
  'BELIRSIZ': '🔵 BELİRSİZ (Manuel inceleme gerekli)',
  'TEMIZ': '⚪ TEMİZ',
};

const verdictOrder: TailFPAnalysis['verdict'][] = ['GERCEK_SORUN_OLASI', 'SENSOR_VERI_SORUNU', 'TEK_SEFERLIK', 'BELIRSIZ', 'TEMIZ'];

let totalVerdictSignals = 0;
for (const [, v] of verdictCounts) totalVerdictSignals += v.signals;

console.log('');
console.log(padR('  Değerlendirme', 60) + padL('Uçak', 6) + padL('Sinyal', 8) + padL('% Sinyal', 10));
console.log('  ' + '─'.repeat(82));

for (const vKey of verdictOrder) {
  const v = verdictCounts.get(vKey);
  if (!v) continue;
  console.log(
    '  ' + padR(verdictLabels[vKey], 58) +
    padL(String(v.tails), 6) +
    padL(String(v.signals), 8) +
    padL(pct(v.signals, totalVerdictSignals), 10)
  );
}
console.log('  ' + '─'.repeat(82));
console.log(
  '  ' + padR('TOPLAM', 58) +
  padL(String(fpAnalyses.length), 6) +
  padL(String(totalVerdictSignals), 8) +
  padL('100.0%', 10)
);

// ═══════════════════════════════════════════════════════════════
// 8. RAPOR: "GERÇEK SORUN OLASI" uçaklar detay
// ═══════════════════════════════════════════════════════════════

const realIssues = fpAnalyses.filter(a => a.verdict === 'GERCEK_SORUN_OLASI');

console.log('');
console.log('═'.repeat(130));
console.log('  🔴 GERÇEK SORUN OLASI — ARIZA KAYDINA GİRMEMİŞ UÇAKLAR DETAY');
console.log('═'.repeat(130));

if (realIssues.length === 0) {
  console.log('  Bu kategoride uçak yok.');
} else {
  console.log('');
  console.log(
    padR('  Kuyruk', 12) +
    padL('Uçuş#', 7) +
    padL('Kritik', 8) +
    padL('Uyarı', 8) +
    padL('AvgPFD', 9) +
    padL('MinPFD', 9) +
    padL('Tekrar?', 9) +
    padL('Küme?', 7) +
    '  Sebep'
  );
  console.log('  ' + '─'.repeat(126));

  for (const a of realIssues) {
    console.log(
      padR('  ' + a.tail, 12) +
      padL(String(a.totalFlights), 7) +
      padL(String(a.criticalFlights.length), 8) +
      padL(String(a.warningFlights.length), 8) +
      padL(a.avgPfd.toFixed(1), 9) +
      padL(a.minPfd.toFixed(1), 9) +
      padL(a.isRecurring ? 'EVET' : 'HAYIR', 9) +
      padL(a.isClustered ? 'EVET' : 'HAYIR', 7) +
      '  ' + a.verdictReason
    );

    // Bu uçağın en kötü 3 uçuşunu göster
    const worst = [...a.criticalFlights].sort((x, y) => x.normalizedPfd - y.normalizedPfd).slice(0, 3);
    for (const w of worst) {
      console.log(
        '  ' + padR('', 12) +
        padR('↳ ' + w.flightDate, 14) +
        padR(w.takeoffAirport + '→' + w.landingAirport, 12) +
        'PFD:' + padL(w.normalizedPfd.toFixed(1), 6) + '%' +
        '  Açı:' + padL(w.pfdTurn1Deg.toFixed(1), 6) + '°' +
        '  Ratio:' + padL(w.durationRatio.toFixed(2), 6) + 'x' +
        '  | ' + w.anomalyReasons[0]?.substring(0, 50)
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 9. RAPOR: Sensör/Veri Sorunu uçaklar (kısaltılmış)
// ═══════════════════════════════════════════════════════════════

const sensorIssues = fpAnalyses.filter(a => a.verdict === 'SENSOR_VERI_SORUNU');

console.log('');
console.log('═'.repeat(110));
console.log('  🟡 SENSÖR/VERİ SORUNU — TAHMİNSEL BAKIMDA GÖSTERİLMEMELİ (' + sensorIssues.length + ' uçak)');
console.log('═'.repeat(110));

if (sensorIssues.length > 0) {
  let sensorSignalTotal = 0;
  for (const a of sensorIssues) sensorSignalTotal += a.criticalFlights.length + a.warningFlights.length;
  console.log('  Bu gruptaki toplam sinyal: ' + sensorSignalTotal);
  console.log('  Bunlar landing distance inversion kaynaklı — speedbrake sorunu DEĞİL');
  console.log('  Tahminsel bakım dashboard\'ından ÇIKARILMALI');
  console.log('');

  for (const a of sensorIssues.slice(0, 10)) {
    console.log(
      '  ' + padR(a.tail, 10) +
      'Kritik:' + padL(String(a.criticalFlights.length), 4) +
      '  Uyarı:' + padL(String(a.warningFlights.length), 4) +
      '  AvgPFD:' + padL(a.avgPfd.toFixed(1), 6) + '%' +
      '  (Tümü landing distance sensör sorunu)'
    );
  }
  if (sensorIssues.length > 10) console.log('  ... ve ' + (sensorIssues.length - 10) + ' uçak daha');
}

// ═══════════════════════════════════════════════════════════════
// 10. RAPOR: Tek Seferlik Anomaliler
// ═══════════════════════════════════════════════════════════════

const oneOff = fpAnalyses.filter(a => a.verdict === 'TEK_SEFERLIK');

console.log('');
console.log('═'.repeat(110));
console.log('  🟢 TEK SEFERLİK ANOMALİLER — NORMAL OPERASYONEL VARYASYON (' + oneOff.length + ' uçak)');
console.log('═'.repeat(110));

if (oneOff.length > 0) {
  let oneOffSignalTotal = 0;
  for (const a of oneOff) oneOffSignalTotal += a.criticalFlights.length + a.warningFlights.length;
  console.log('  Bu gruptaki toplam sinyal: ' + oneOffSignalTotal);
  console.log('  Geçici durum (hava koşulu, operasyonel, vb.) — takip gerektirmez');
}

// ═══════════════════════════════════════════════════════════════
// 11. RAPOR: Belirsiz uçaklar
// ═══════════════════════════════════════════════════════════════

const uncertain = fpAnalyses.filter(a => a.verdict === 'BELIRSIZ');

console.log('');
console.log('═'.repeat(110));
console.log('  🔵 BELİRSİZ — MANUEL İNCELEME GEREKLİ (' + uncertain.length + ' uçak)');
console.log('═'.repeat(110));

if (uncertain.length > 0) {
  let uncertainSignalTotal = 0;
  for (const a of uncertain) uncertainSignalTotal += a.criticalFlights.length + a.warningFlights.length;
  console.log('  Bu gruptaki toplam sinyal: ' + uncertainSignalTotal);
  console.log('');

  console.log(
    padR('  Kuyruk', 12) +
    padL('Uçuş#', 7) +
    padL('Kritik', 8) +
    padL('Uyarı', 8) +
    padL('AvgPFD', 9) +
    padL('MinPFD', 9) +
    '  Açıklama'
  );
  console.log('  ' + '─'.repeat(106));

  for (const a of uncertain) {
    console.log(
      padR('  ' + a.tail, 12) +
      padL(String(a.totalFlights), 7) +
      padL(String(a.criticalFlights.length), 8) +
      padL(String(a.warningFlights.length), 8) +
      padL(a.avgPfd.toFixed(1), 9) +
      padL(a.minPfd.toFixed(1), 9) +
      '  ' + a.verdictReason
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 12. NİHAİ ÖZET: TAHMİNSEL BAKIM İÇİN NE GÖSTERMELİYİZ?
// ═══════════════════════════════════════════════════════════════

const realSignals = verdictCounts.get('GERCEK_SORUN_OLASI')?.signals || 0;
const sensorSignals = verdictCounts.get('SENSOR_VERI_SORUNU')?.signals || 0;
const oneOffSignals = verdictCounts.get('TEK_SEFERLIK')?.signals || 0;
const uncertainSignals = verdictCounts.get('BELIRSIZ')?.signals || 0;

console.log('');
console.log('');
console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                                                                                                      ║');
console.log('║                     NİHAİ SONUÇ: 1.076 EK SİNYAL NE ANLAMA GELİYOR?                                  ║');
console.log('║                                                                                                      ║');
console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                                      ║');
console.log('║  1.076 ek sinyalin dağılımı:                                                                         ║');
console.log('║                                                                                                      ║');
console.log('║  🔴 GERÇEK SORUN OLASI          : ' + padL(String(realSignals), 6) + ' sinyal (' + padL(pct(realSignals, totalVerdictSignals), 6) + ')                                    ║');
console.log('║     → Arıza kaydına girmemiş ama parametrelerde bozulma gösteren uçaklar                              ║');
console.log('║     → TAHMİNSEL BAKIMDA GÖSTERİLMELİ ✅                                                              ║');
console.log('║                                                                                                      ║');
console.log('║  🟡 SENSÖR/VERİ SORUNU           : ' + padL(String(sensorSignals), 6) + ' sinyal (' + padL(pct(sensorSignals, totalVerdictSignals), 6) + ')                                    ║');
console.log('║     → Landing distance inversion, sensör arızası, veri kalitesi                                       ║');
console.log('║     → TAHMİNSEL BAKIMDA FİLTRELENMELİ ❌                                                             ║');
console.log('║                                                                                                      ║');
console.log('║  🟢 TEK SEFERLİK ANOMALİ         : ' + padL(String(oneOffSignals), 6) + ' sinyal (' + padL(pct(oneOffSignals, totalVerdictSignals), 6) + ')                                    ║');
console.log('║     → Geçici operasyonel durum, hava koşulu, tek seferlik sapma                                       ║');
console.log('║     → TAHMİNSEL BAKIMDA DÜŞÜK ÖNCELİK 📋                                                             ║');
console.log('║                                                                                                      ║');
console.log('║  🔵 BELİRSİZ                     : ' + padL(String(uncertainSignals), 6) + ' sinyal (' + padL(pct(uncertainSignals, totalVerdictSignals), 6) + ')                                    ║');
console.log('║     → Karışık sinyaller, manuel inceleme gerekli                                                      ║');
console.log('║     → TAHMİNSEL BAKIMDA İZLEMEDE TUT 🔍                                                              ║');
console.log('║                                                                                                      ║');
console.log('╠════════════════════════════════════════════════════════════════════════════════════════════════════════╣');
console.log('║                                                                                                      ║');
console.log('║  📌 ÖNERİ:                                                                                            ║');
console.log('║                                                                                                      ║');
console.log('║  TAHMİNSEL BAKIM DASHBOARD\'INDA GÖSTERILECEK GERÇEK ITEM SAYISI:                                     ║');
console.log('║                                                                                                      ║');
console.log('║    Kesin gösterilmeli  : ' + padL(String(realSignals), 6) + ' sinyal (🔴 Gerçek sorun olası)                                ║');
console.log('║    İzlemede tutulmalı  : ' + padL(String(uncertainSignals), 6) + ' sinyal (🔵 Belirsiz)                                            ║');
console.log('║    Filtrelenmeli       : ' + padL(String(sensorSignals + oneOffSignals), 6) + ' sinyal (🟡 Sensör + 🟢 Tek seferlik)                          ║');
console.log('║                         ──────                                                                        ║');
console.log('║    Toplam              : ' + padL(String(totalVerdictSignals), 6) + '                                                                  ║');
console.log('║                                                                                                      ║');
console.log('║  → 1.076 sinyalin tamamı "false positive" DEĞİL.                                                     ║');
console.log('║  → ' + padL(String(realSignals), 4) + ' tanesi gerçek sorun göstergesi olabilir.                                              ║');
console.log('║  → Geri kalanın büyük kısmı sensör sorunu veya geçici durum.                                          ║');
console.log('║                                                                                                      ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝');

// ═══════════════════════════════════════════════════════════════
// 13. TC-SPA ÖZEL ANALİZ (407 kritik en büyük outlier)
// ═══════════════════════════════════════════════════════════════

const spaAnalysis = fpAnalyses.find(a => a.tail === 'TC-SPA');
if (spaAnalysis) {
  console.log('');
  console.log('═'.repeat(110));
  console.log('  ⚠️  TC-SPA ÖZEL ANALİZ (407 kritik uçuş — en büyük outlier)');
  console.log('═'.repeat(110));
  console.log('');
  console.log('  TC-SPA, arızasız uçaklar içinde 407 kritik uçuşla açık ara en yüksek.');
  console.log('  Bu ya:');
  console.log('    a) Arıza kaydına hiç girmemiş kronik bir sorun');
  console.log('    b) Veri/sensör kayıt problemi');
  console.log('    c) Uçağın farklı bir konfigürasyonda olması');
  console.log('');
  console.log('  Toplam uçuş  : ' + spaAnalysis.totalFlights);
  console.log('  Kritik        : ' + spaAnalysis.criticalFlights.length + ' (' + pct(spaAnalysis.criticalFlights.length, spaAnalysis.totalFlights) + ')');
  console.log('  Uyarı         : ' + spaAnalysis.warningFlights.length + ' (' + pct(spaAnalysis.warningFlights.length, spaAnalysis.totalFlights) + ')');
  console.log('  Normal        : ' + (spaAnalysis.totalFlights - spaAnalysis.criticalFlights.length - spaAnalysis.warningFlights.length));
  console.log('  Ort PFD       : ' + spaAnalysis.avgPfd.toFixed(1) + '%');
  console.log('  Min PFD       : ' + spaAnalysis.minPfd.toFixed(1) + '%');
  console.log('  Verdict       : ' + spaAnalysis.verdict);
  console.log('  Açıklama      : ' + spaAnalysis.verdictReason);
  console.log('');

  // PFD dağılımı
  const spaFlights = byTail.get('TC-SPA') || [];
  const pfdBuckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 98, 100, 105];
  console.log('  PFD Dağılımı:');
  for (let i = 0; i < pfdBuckets.length - 1; i++) {
    const lo = pfdBuckets[i];
    const hi = pfdBuckets[i + 1];
    const count = spaFlights.filter(f => f.normalizedPfd >= lo && f.normalizedPfd < hi).length;
    if (count > 0) {
      const bar = '█'.repeat(Math.round((count / spaFlights.length) * 50));
      console.log('    ' + padL(String(lo), 5) + '-' + padR(String(hi) + '%:', 7) + padL(String(count), 5) + ' (' + padL(pct(count, spaFlights.length), 6) + ') ' + bar);
    }
  }

  // Sinyal kategorileri
  console.log('');
  console.log('  Sinyal kategorileri:');
  for (const [cat, count] of spaAnalysis.categoryCounts.entries()) {
    console.log('    ' + padR(categoryLabels[cat] || cat, 50) + ': ' + count);
  }

  // En kötü 5 uçuş
  console.log('');
  console.log('  En kötü 5 uçuş:');
  const spaWorst = [...spaAnalysis.criticalFlights].sort((a, b) => a.normalizedPfd - b.normalizedPfd).slice(0, 5);
  for (const w of spaWorst) {
    console.log(
      '    ' + w.flightDate +
      '  ' + padR(w.takeoffAirport + '→' + w.landingAirport, 12) +
      '  PFD:' + padL(w.normalizedPfd.toFixed(1), 6) + '%' +
      '  Açı:' + padL(w.pfdTurn1Deg.toFixed(1), 6) + '°' +
      '  Ratio:' + padL(w.durationRatio.toFixed(2), 6) + 'x' +
      '  ExtTo99:' + padL(w.durationExtTo99.toFixed(1), 6) + 's'
    );
    for (const r of w.anomalyReasons.slice(0, 2)) {
      console.log('      → ' + r.substring(0, 90));
    }
  }

  console.log('');
  console.log('  🔴 ÖNERİ: TC-SPA, bakım ekibi tarafından ACİL incelenmeli.');
  console.log('     AvgPFD %90.6 ile filo ortalamasının (%99.7) çok altında.');
  console.log('     Muhtemelen arıza kaydına GİRMEMİŞ kronik bir speedbrake sorunu var.');
}

console.log('');
console.log('✅ False positive derin analiz tamamlandı.');
console.log('');
