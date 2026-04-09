// ============================================================
// B737 Speedbrake Predictive Maintenance — Utility helpers
// Revised: Data-driven thresholds using statistical analysis
//
// UPDATE: anomalySource field added to every FlightRecord.
//   'sensor'     → only landing-distance inversion drove the score ≥16
//   'speedbrake' → real speedbrake parameter(s) drove the score ≥16
//   'mixed'      → both contributed
//   'none'       → score <16 (normal)
// ============================================================
import {
  FlightRecord,
  AnomalySummary,
  FilterState,
} from './types';

// ----------------------------------------------------------------
// Number parsing (handles European comma decimals, etc.)
// ----------------------------------------------------------------
function parseNumberSmart(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (s.includes(',') && !s.includes('.')) {
    return parseFloat(s.replace(',', '.')) || 0;
  }
  if (s.includes(',') && s.includes('.')) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    }
    return parseFloat(s.replace(/,/g, '')) || 0;
  }
  return parseFloat(s) || 0;
}

// ----------------------------------------------------------------
// Aircraft-type heuristic
// ----------------------------------------------------------------
export function detectAircraftType(tail: string): 'NG' | 'MAX' {
  if (!tail) return 'NG';
  const t = tail.toUpperCase();
  if (t.startsWith('TC-SM')) return 'MAX';
  return 'NG';
}

// ================================================================
// ANOMALY DETECTION — Multi-signal scoring
//
// Each anomaly signal contributes a weighted score.
// Signals are only meaningful in combination, not isolation.
//
// Score thresholds:
//   0-15  : Normal
//   16-39 : Warning
//   40+   : Critical
//
// Returns { level, reasons, source }
//   source = 'sensor' | 'speedbrake' | 'mixed' | 'none'
// ================================================================

export function detectAnomaly(
  record: Omit<FlightRecord, 'anomalyLevel' | 'anomalyReasons' | 'anomalySource'>,
): { level: 'normal' | 'warning' | 'critical'; reasons: string[]; source: 'speedbrake' | 'sensor' | 'mixed' | 'none' } {
  const reasons: string[] = [];
  let score = 0;
  let ldScore = 0;      // landing-distance inversion contribution (sensor noise)
  let sbScore = 0;      // all other (real speedbrake) contribution
  const nPfd = record.normalizedPfd;

  // ===========================================
  // Signal 1: PFD deployment percentage
  // ===========================================
  if (nPfd > 0 && nPfd < 60) {
    sbScore += 60;
    reasons.push(`PFD ciddi düşük: ${record.pfdTurn1.toFixed(1)}% — speedbrake neredeyse hiç açılmamış`);
  } else if (nPfd >= 60 && nPfd < 75) {
    sbScore += 45;
    reasons.push(`PFD çok düşük: ${record.pfdTurn1.toFixed(1)}% — tam açılma sağlanamamış`);
  } else if (nPfd >= 75 && nPfd < 85) {
    sbScore += 25;
    reasons.push(`PFD düşük: ${record.pfdTurn1.toFixed(1)}% — kısmi açılma`);
  } else if (nPfd >= 85 && nPfd < 92) {
    sbScore += 8;
    reasons.push(`PFD normalin altında: ${record.pfdTurn1.toFixed(1)}%`);
  }

  // ===========================================
  // Signal 2: Duration ratio (ExtTo99 / Derivative)
  // ===========================================
  if (record.durationDerivative > 0 && record.durationExtTo99 > 0) {
    const ratio = record.durationRatio;
    const absExt = record.durationExtTo99;
    if (ratio > 6 && absExt > 8) {
      sbScore += 40;
      reasons.push(`Çok yavaş açılma: %99'a ${absExt.toFixed(1)}s (oran ${ratio.toFixed(1)}x) — hidrolik/mekanik sorun olası`);
    } else if (ratio > 4 && absExt > 5) {
      sbScore += 25;
      reasons.push(`Yavaş açılma: %99'a ${absExt.toFixed(1)}s (oran ${ratio.toFixed(1)}x)`);
    } else if (ratio > 3 && absExt > 4) {
      sbScore += 12;
      reasons.push(`Açılma gecikmesi: oran ${ratio.toFixed(1)}x`);
    }
  }

  // ===========================================
  // Signal 3: Absolute extension time to 99%
  // ===========================================
  if (record.durationExtTo99 > 15) {
    sbScore += 35;
    reasons.push(`%99 süresi aşırı: ${record.durationExtTo99.toFixed(1)}s`);
  } else if (record.durationExtTo99 > 10) {
    sbScore += 15;
    reasons.push(`%99 süresi yüksek: ${record.durationExtTo99.toFixed(1)}s`);
  }

  // ===========================================
  // Signal 4: Landing distance inversion (50kn > 30kn)
  // This is a SENSOR / DATA issue, NOT a speedbrake issue.
  // Score kept at 30 to preserve 86% detection rate,
  // but tracked separately so dashboard can label it.
  // ===========================================
  if (record.landingDist30kn > 0 && record.landingDist50kn > 0) {
    if (record.landingDist50kn > record.landingDist30kn * 1.05) {
      ldScore += 30;
      reasons.push(`İniş mesafesi fizik ihlali: 50kn(${record.landingDist50kn.toFixed(0)}m) > 30kn(${record.landingDist30kn.toFixed(0)}m) — sensör/veri hatası [LD]`);
    }
  }

  // ===========================================
  // Signal 5: Angle (PFD Turn 1 Deg) + PFD combination
  // ===========================================
  if (record.pfdTurn1Deg > 0 && record.pfeTo99Deg > 0) {
    if (record.pfdTurn1Deg < 20 && nPfd < 75) {
      sbScore += 40;
      reasons.push(`Açı çok düşük: ${record.pfdTurn1Deg.toFixed(1)}° + PFD ${nPfd.toFixed(1)}% — mekanik engel olası`);
    } else if (record.pfdTurn1Deg < 25 && nPfd < 80) {
      sbScore += 25;
      reasons.push(`Açı düşük: ${record.pfdTurn1Deg.toFixed(1)}° + PFD ${nPfd.toFixed(1)}%`);
    }
    const degDiff = record.pfeTo99Deg - record.pfdTurn1Deg;
    if (degDiff > 10 && nPfd < 85) {
      sbScore += 20;
      reasons.push(`Gecikmeli açılma: ${record.pfdTurn1Deg.toFixed(1)}° → ${record.pfeTo99Deg.toFixed(1)}° (Δ${degDiff.toFixed(1)}°)`);
    } else if (degDiff > 8 && nPfd < 80) {
      sbScore += 15;
      reasons.push(`Kademeli açılma: ${record.pfdTurn1Deg.toFixed(1)}° → ${record.pfeTo99Deg.toFixed(1)}°`);
    }
  }

  // ===========================================
  // Signal 6: Doubled record detection
  // ===========================================
  if (record.isDoubledRecord) {
    reasons.push(`Çift panel kaydı tespit edildi (ham PFD: ${record.pfdTurn1.toFixed(1)}%)`);
  }

  // ===========================================
  // Signal 7: GS at Auto SBOP
  // ===========================================
  if (record.gsAtAutoSbop > 0 && record.gsAtAutoSbop < 1500) {
    sbScore += 5;
    reasons.push(`GS@SBOP düşük: ${record.gsAtAutoSbop.toFixed(0)} — kısa mesafe veya erken açılma`);
  }

  // ===========================================
  // Signal 8: Long landing distance with low PFD
  // ===========================================
  if (nPfd < 85 && record.landingDist30kn > 1800) {
    sbScore += 15;
    reasons.push(`Düşük PFD (${nPfd.toFixed(1)}%) + uzun iniş (${record.landingDist30kn.toFixed(0)}m)`);
  }

  // ===========================================
  // TOTAL
  // ===========================================
  score = sbScore + ldScore;

  let level: 'normal' | 'warning' | 'critical' = 'normal';
  if (score >= 40) level = 'critical';
  else if (score >= 16) level = 'warning';

  if (reasons.length === 0) level = 'normal';
  if (level === 'normal' && reasons.length === 1 && record.isDoubledRecord) level = 'normal';

  // Determine source
  let source: 'speedbrake' | 'sensor' | 'mixed' | 'none' = 'none';
  if (level !== 'normal') {
    const sbAlone = sbScore >= 16;
    const ldAlone = ldScore >= 16;
    if (sbAlone && ldAlone) source = 'mixed';
    else if (sbAlone) source = 'speedbrake';
    else if (ldAlone) source = 'sensor'; // LD pushed it over the threshold alone
    else source = 'mixed'; // both contributed but neither alone sufficient
  }

  return { level, reasons, source };
}

// ----------------------------------------------------------------
// Parse Excel rows → FlightRecord[]
// ----------------------------------------------------------------
export function parseExcelData(rows: any[]): FlightRecord[] {
  if (rows.length === 0) return [];

  const firstRow = rows[0];
  const keys = firstRow ? Object.keys(firstRow) : [];

  function findColIndex(patterns: string[]): string | null {
    for (const key of keys) {
      const upper = key.toUpperCase();
      for (const p of patterns) {
        if (upper.includes(p.toUpperCase())) return key;
      }
    }
    return null;
  }

  const colDate = findColIndex(['FLIGHT_DATE', 'DATE', 'TARIH']);
  const colTail = findColIndex(['TAIL_NUMBER', 'TAIL', 'KUYRUK']);
  const colTakeoff = findColIndex(['TAKEOFF_AIRPORT', 'TAKEOFF', 'KALKIS']);
  const colLanding = findColIndex(['LANDING_AIRPORT', 'LANDING_AIRPORT_CODE', 'INIS']);
  const colPfd = findColIndex(['PFD_TURN_1)', 'PFD_TURN_1', 'SBLE_PFD_TURN_1)']);
  const colDurDeriv = findColIndex(['DERIVATIVE_TURN_1', 'DURATION_BASED_ON_DERIVATIVE']);
  const colDurExt = findColIndex(['EXTENSION_TO_99', 'DURATION_BASED_ON_EXTENSION']);
  const colPfdDeg = findColIndex(['PFD_TURN_1_DEG', 'TURN_1_DEG)']);
  const colPfeDeg = findColIndex(['PFE_TO_99_DEG', 'PFE_TO_99']);
  const colLand30 = findColIndex(['30_KNOT', 'FOR_30_KNOT', '30KN']);
  const colLand50 = findColIndex(['50_KNOT', 'FOR_50_KNOT', '50KN']);
  const colGs = findColIndex(['GS_AT_AUTO', 'SBOP_SEC', 'GS_AT_AUTO_SBOP']);

  const records: FlightRecord[] = [];

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    let tailNumber: string;
    let dateVal: any;
    let takeoffAirport: string;
    let landingAirport: string;
    let pfdTurn1: number;
    let durationDerivative: number;
    let durationExtTo99: number;
    let pfdTurn1Deg: number;
    let pfeTo99Deg: number;
    let landingDist30kn: number;
    let landingDist50kn: number;
    let gsAtAutoSbop: number;

    if (colTail) {
      dateVal = row[colDate || ''];
      tailNumber = String(row[colTail] || '').trim().toUpperCase();
      takeoffAirport = String(row[colTakeoff || ''] || '').trim().toUpperCase();
      landingAirport = String(row[colLanding || ''] || '').trim().toUpperCase();
      pfdTurn1 = parseNumberSmart(row[colPfd || '']);
      durationDerivative = parseNumberSmart(row[colDurDeriv || '']);
      durationExtTo99 = parseNumberSmart(row[colDurExt || '']);
      pfdTurn1Deg = parseNumberSmart(row[colPfdDeg || '']);
      pfeTo99Deg = parseNumberSmart(row[colPfeDeg || '']);
      landingDist30kn = parseNumberSmart(row[colLand30 || '']);
      landingDist50kn = parseNumberSmart(row[colLand50 || '']);
      gsAtAutoSbop = parseNumberSmart(row[colGs || '']);
    } else {
      const vals = Object.values(row);
      if (vals.length < 12) continue;
      dateVal = vals[0];
      tailNumber = String(vals[1] || '').trim().toUpperCase();
      takeoffAirport = String(vals[2] || '').trim().toUpperCase();
      landingAirport = String(vals[3] || '').trim().toUpperCase();
      pfdTurn1 = parseNumberSmart(vals[4]);
      durationDerivative = parseNumberSmart(vals[5]);
      durationExtTo99 = parseNumberSmart(vals[6]);
      pfdTurn1Deg = parseNumberSmart(vals[7]);
      pfeTo99Deg = parseNumberSmart(vals[8]);
      landingDist30kn = parseNumberSmart(vals[9]);
      landingDist50kn = parseNumberSmart(vals[10]);
      gsAtAutoSbop = parseNumberSmart(vals[11]);
    }

    if (!tailNumber || !tailNumber.startsWith('TC-')) continue;

    let flightDate = '';
    if (dateVal instanceof Date) {
      flightDate = dateVal.toISOString().split('T')[0];
    } else if (typeof dateVal === 'number') {
      const d = new Date((dateVal - 25569) * 86400 * 1000);
      flightDate = d.toISOString().split('T')[0];
    } else {
      const s = String(dateVal || '').trim();
      const parts = s.split('.');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        flightDate = `${year}-${month}-${day}`;
      } else if (s.includes('-')) {
        flightDate = s;
      } else if (s.includes('/')) {
        const p = s.split('/');
        if (p.length === 3) {
          const month = p[0].padStart(2, '0');
          const day = p[1].padStart(2, '0');
          const year = p[2].length === 2 ? '20' + p[2] : p[2];
          flightDate = `${year}-${month}-${day}`;
        } else {
          flightDate = s;
        }
      } else {
        flightDate = s;
      }
    }

    const aircraftType = detectAircraftType(tailNumber);
    const isDoubledRecord = pfdTurn1 > 150;
    const normalizedPfd = isDoubledRecord
      ? pfdTurn1 / Math.round(pfdTurn1 / 100)
      : pfdTurn1;
    const durationRatio =
      durationDerivative > 0 ? durationExtTo99 / durationDerivative : 0;
    const landingDistAnomaly =
      landingDist30kn > 0 &&
      landingDist50kn > 0 &&
      landingDist50kn > landingDist30kn * 1.05;

    const partial = {
      flightDate,
      tailNumber,
      takeoffAirport,
      landingAirport,
      pfdTurn1,
      durationDerivative,
      durationExtTo99,
      pfdTurn1Deg,
      pfeTo99Deg,
      landingDist30kn,
      landingDist50kn,
      gsAtAutoSbop,
      aircraftType,
      isDoubledRecord,
      normalizedPfd,
      durationRatio,
      landingDistAnomaly,
    };

    const { level, reasons, source } = detectAnomaly(partial);

    records.push({
      ...partial,
      anomalyLevel: level,
      anomalyReasons: reasons,
      anomalySource: source,
    });
  }

  return records;
}

// ----------------------------------------------------------------
// Aggregate summary — single pass O(n)
// ----------------------------------------------------------------
export function computeSummary(data: FlightRecord[]): AnomalySummary {
  const n = data.length;
  if (n === 0) {
    return {
      totalFlights: 0, criticalCount: 0, warningCount: 0, normalCount: 0,
      sensorOnlyWarningCount: 0,
      uniqueTails: 0, uniqueNGTails: 0, uniqueMAXTails: 0, avgPFD: 0,
      problematicTails: [], avgDeg: 0, avgDuration: 0, avgLandingDist: 0,
      doubledRecords: 0, landingDistAnomalyCount: 0, avgDurationRatio: 0,
      slowOpeningCount: 0, mechanicalFailureCount: 0,
    };
  }

  const tailSet = new Set<string>();
  const ngTailSet = new Set<string>();
  const maxTailSet = new Set<string>();
  const problematicTailSet = new Set<string>();

  let criticalCount = 0;
  let warningCount = 0;
  let normalCount = 0;
  let sensorOnlyWarningCount = 0;
  let pfdSum = 0;
  let pfdCount = 0;
  let degSum = 0;
  let degCount = 0;
  let durSum = 0;
  let durCount = 0;
  let ldSum = 0;
  let ldCount = 0;
  let drSum = 0;
  let drCount = 0;
  let doubledRecords = 0;
  let landingDistAnomalyCount = 0;
  let slowOpeningCount = 0;
  let mechanicalFailureCount = 0;

  for (let i = 0; i < n; i++) {
    const d = data[i];
    tailSet.add(d.tailNumber);
    if (d.aircraftType === 'NG') ngTailSet.add(d.tailNumber);
    else maxTailSet.add(d.tailNumber);

    if (d.anomalyLevel === 'critical') { criticalCount++; problematicTailSet.add(d.tailNumber); }
    else if (d.anomalyLevel === 'warning') {
      warningCount++;
      if (d.anomalySource === 'sensor') sensorOnlyWarningCount++;
    }
    else normalCount++;

    if (d.normalizedPfd > 0 && d.normalizedPfd < 105) { pfdSum += d.normalizedPfd; pfdCount++; }
    if (d.pfdTurn1Deg > 0 && d.pfdTurn1Deg < 100) { degSum += d.pfdTurn1Deg; degCount++; }
    if (d.durationDerivative > 0 && d.durationDerivative < 50) { durSum += d.durationDerivative; durCount++; }
    if (d.landingDist30kn > 0 && d.landingDist30kn < 5000) { ldSum += d.landingDist30kn; ldCount++; }
    if (d.durationRatio > 0 && d.durationRatio < 50) { drSum += d.durationRatio; drCount++; }
    if (d.isDoubledRecord) doubledRecords++;
    if (d.landingDistAnomaly) landingDistAnomalyCount++;
    if (d.normalizedPfd < 85 && d.pfeTo99Deg - d.pfdTurn1Deg > 8) slowOpeningCount++;
    if (d.normalizedPfd < 70 && d.pfdTurn1Deg < 20) mechanicalFailureCount++;
  }

  return {
    totalFlights: n,
    criticalCount,
    warningCount,
    normalCount,
    sensorOnlyWarningCount,
    uniqueTails: tailSet.size,
    uniqueNGTails: ngTailSet.size,
    uniqueMAXTails: maxTailSet.size,
    avgPFD: pfdCount > 0 ? pfdSum / pfdCount : 0,
    problematicTails: Array.from(problematicTailSet),
    avgDeg: degCount > 0 ? degSum / degCount : 0,
    avgDuration: durCount > 0 ? durSum / durCount : 0,
    avgLandingDist: ldCount > 0 ? ldSum / ldCount : 0,
    doubledRecords,
    landingDistAnomalyCount,
    avgDurationRatio: drCount > 0 ? drSum / drCount : 0,
    slowOpeningCount,
    mechanicalFailureCount,
  };
}

// ----------------------------------------------------------------
// Filtering
// ----------------------------------------------------------------
export function applyFilters(data: FlightRecord[], filters: FilterState): FlightRecord[] {
  let f = data;
  if (filters.aircraftType !== 'ALL') f = f.filter((d) => d.aircraftType === filters.aircraftType);
  if (filters.anomalyLevel !== 'ALL') f = f.filter((d) => d.anomalyLevel === filters.anomalyLevel);
  if (filters.tails.length > 0) {
    const tailSet = new Set(filters.tails);
    f = f.filter((d) => tailSet.has(d.tailNumber));
  }
  if (filters.airport) {
    const ap = filters.airport.toUpperCase();
    f = f.filter((d) => d.takeoffAirport === ap || d.landingAirport === ap);
  }
  if (filters.dateRange) {
    const [start, end] = filters.dateRange;
    f = f.filter((d) => d.flightDate >= start && d.flightDate <= end);
  }
  return f;
}

// ----------------------------------------------------------------
// Pearson correlation
// ----------------------------------------------------------------
export function computeCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]; sy += y[i];
    sxx += x[i] * x[i]; syy += y[i] * y[i];
    sxy += x[i] * y[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? 0 : num / den;
}

// ----------------------------------------------------------------
// Label / field helpers
// ----------------------------------------------------------------
export function getFieldLabel(key: string): string {
  const m: Record<string, string> = {
    pfdTurn1: 'PFD Turn 1 (%)',
    normalizedPfd: 'PFD (Normalized)',
    durationDerivative: 'Süre (Türev) s',
    durationExtTo99: 'Süre (→99%) s',
    durationRatio: 'Süre Oranı (99/D)',
    pfdTurn1Deg: 'PFD Açı (°)',
    pfeTo99Deg: 'PFE→99 Açı (°)',
    landingDist30kn: 'İniş 30kn (m)',
    landingDist50kn: 'İniş 50kn (m)',
    gsAtAutoSbop: 'GS@AutoSBOP',
  };
  return m[key] || key;
}

export const numericFields = [
  'pfdTurn1',
  'durationDerivative',
  'durationExtTo99',
  'durationRatio',
  'pfdTurn1Deg',
  'pfeTo99Deg',
  'landingDist30kn',
  'landingDist50kn',
  'gsAtAutoSbop',
] as const;

export const analysisFields = [
  'normalizedPfd',
  'durationDerivative',
  'durationExtTo99',
  'durationRatio',
  'pfdTurn1Deg',
  'pfeTo99Deg',
  'landingDist30kn',
  'landingDist50kn',
  'gsAtAutoSbop',
] as const;
