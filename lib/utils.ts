// ============================================================
// B737 Speedbrake Predictive Maintenance — Utility helpers
// Revised: Data-driven thresholds using statistical analysis
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
// ANOMALY DETECTION — Revised with data-driven approach
//
// Problem with old approach:
//   - Fixed thresholds (PFD<95 = warning) caused massive false positives
//   - TC-SPB data: 53 flights, 85% are clearly normal but many were
//     flagged as anomalies due to overly sensitive rules
//   - Duration ExtTo99 > 5s flagged as warning but some aircraft
//     routinely show 5-7s with no real issue
//   - Angle thresholds didn't account for NG vs MAX differences
//     or single-panel vs dual-panel operation modes
//
// New approach — Multi-signal scoring:
//   1. Each anomaly signal contributes a weighted score (0-100)
//   2. Signals are only meaningful in combination, not isolation
//   3. Thresholds are based on actual data distribution:
//      - TC-SPB normal PFD: 96-100% (median ~99%)
//      - TC-SPB normal Deg: 33-47° (varies with mode)
//      - TC-SPB normal Duration: 0.5-4.5s derivative, 0.5-4.5s ext
//      - Duration ratio normally 0.5-1.5x
//   4. Only flag as anomaly when MULTIPLE signals agree
//   5. Distinguish between sensor/data issues vs real mechanical
// ================================================================

export function detectAnomaly(
  record: Omit<FlightRecord, 'anomalyLevel' | 'anomalyReasons'>,
): { level: 'normal' | 'warning' | 'critical'; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0; // Accumulate anomaly evidence score (0 = perfect, 100+ = critical)
  const nPfd = record.normalizedPfd;

  // ===========================================
  // Signal 1: PFD deployment percentage
  // Normal range: 95-101% (100% = full deployment)
  // Below 75% is genuinely problematic regardless of other signals
  // 75-85% is concerning, 85-92% is mild
  // ===========================================
  if (nPfd > 0 && nPfd < 60) {
    score += 60;
    reasons.push(`PFD ciddi düşük: ${record.pfdTurn1.toFixed(1)}% — speedbrake neredeyse hiç açılmamış`);
  } else if (nPfd >= 60 && nPfd < 75) {
    score += 45;
    reasons.push(`PFD çok düşük: ${record.pfdTurn1.toFixed(1)}% — tam açılma sağlanamamış`);
  } else if (nPfd >= 75 && nPfd < 85) {
    score += 25;
    reasons.push(`PFD düşük: ${record.pfdTurn1.toFixed(1)}% — kısmi açılma`);
  } else if (nPfd >= 85 && nPfd < 92) {
    // Only mildly suspicious — needs corroboration from other signals
    score += 8;
    reasons.push(`PFD normalin altında: ${record.pfdTurn1.toFixed(1)}%`);
  }
  // 92-95% is within normal variation — NOT flagged
  // 95-100% is perfectly normal
  // >100% could be doubled record, handled separately

  // ===========================================
  // Signal 2: Duration ratio (ExtTo99 / Derivative)
  // What it means: How much longer does it take to reach 99% vs
  // the initial derivative-predicted time?
  //
  // Normal: 0.5x - 2.0x (derivative and ext are similar)
  // Suspicious: 3.0x+ (ext takes 3x longer than derivative predicts)
  // Critical: 5.0x+ (clear hydraulic resistance or mechanical block)
  //
  // NOTE: Very small derivative values (0.5-1.5s) can cause
  // inflated ratios even with moderate ext times. Weight this
  // signal more when absolute ext time is also high.
  // ===========================================
  if (record.durationDerivative > 0 && record.durationExtTo99 > 0) {
    const ratio = record.durationRatio;
    const absExt = record.durationExtTo99;

    if (ratio > 6 && absExt > 8) {
      // Both ratio AND absolute time are extreme → strong signal
      score += 40;
      reasons.push(`Çok yavaş açılma: %99'a ${absExt.toFixed(1)}s (oran ${ratio.toFixed(1)}x) — hidrolik/mekanik sorun olası`);
    } else if (ratio > 4 && absExt > 5) {
      score += 25;
      reasons.push(`Yavaş açılma: %99'a ${absExt.toFixed(1)}s (oran ${ratio.toFixed(1)}x)`);
    } else if (ratio > 3 && absExt > 4) {
      score += 12;
      reasons.push(`Açılma gecikmesi: oran ${ratio.toFixed(1)}x`);
    }
    // ratio > 2.5 with low absolute time is NORMAL variation
  }

  // ===========================================
  // Signal 3: Absolute extension time to 99%
  // Only flag when genuinely extreme AND corroborated
  // Normal: 0.5-5s (varies by aircraft config)
  // 5-8s: normal for some configs, suspicious for others
  // >10s: almost always problematic
  // >15s: definitely a problem
  // ===========================================
  if (record.durationExtTo99 > 15) {
    score += 35;
    reasons.push(`%99 süresi aşırı: ${record.durationExtTo99.toFixed(1)}s`);
  } else if (record.durationExtTo99 > 10) {
    score += 15;
    reasons.push(`%99 süresi yüksek: ${record.durationExtTo99.toFixed(1)}s`);
  }
  // 5-10s alone is NOT an anomaly — many normal flights show this

  // ===========================================
  // Signal 4: Landing distance inversion (50kn > 30kn)
  // Physics: distance to 30kn MUST be > distance to 50kn
  // If 50kn distance > 30kn distance × 1.05 → sensor fault
  // This is always a data quality issue, not a speedbrake issue
  // ===========================================
  if (record.landingDist30kn > 0 && record.landingDist50kn > 0) {
    if (record.landingDist50kn > record.landingDist30kn * 1.05) {
      score += 30;
      reasons.push(`İniş mesafesi fizik ihlali: 50kn(${record.landingDist50kn.toFixed(0)}m) > 30kn(${record.landingDist30kn.toFixed(0)}m) — sensör/veri hatası`);
    }
  }

  // ===========================================
  // Signal 5: Angle (PFD Turn 1 Deg)
  // This is tricky — NG aircraft show TWO operating modes:
  //   Mode A: ~33-35° (single panel, common)
  //   Mode B: ~42-47° (full deployment, common)
  // MAX aircraft: ~46-48° consistently
  // Doubled records: ~79-80° (two panels summed)
  //
  // Only genuinely low angles WITH low PFD matter:
  //   - <20° with PFD<75% → mechanical failure
  //   - <25° with PFD<80% → partial blockage
  //   - 30-35° with PFD 95%+ → just a different operating mode!
  //
  // OLD BUG: Flagged 30-35° angles as "düşük" even when PFD was 97%+
  // ===========================================
  if (record.pfdTurn1Deg > 0 && record.pfeTo99Deg > 0) {
    if (record.pfdTurn1Deg < 20 && nPfd < 75) {
      score += 40;
      reasons.push(`Açı çok düşük: ${record.pfdTurn1Deg.toFixed(1)}° + PFD ${nPfd.toFixed(1)}% — mekanik engel olası`);
    } else if (record.pfdTurn1Deg < 25 && nPfd < 80) {
      score += 25;
      reasons.push(`Açı düşük: ${record.pfdTurn1Deg.toFixed(1)}° + PFD ${nPfd.toFixed(1)}%`);
    }
    // 30-35° with normal PFD (95%+) is NOT an anomaly — it's single-panel mode

    // Delayed opening: initial angle much lower than final angle
    // Only meaningful if PFD is also below normal
    const degDiff = record.pfeTo99Deg - record.pfdTurn1Deg;
    if (degDiff > 10 && nPfd < 85) {
      score += 20;
      reasons.push(`Gecikmeli açılma: ${record.pfdTurn1Deg.toFixed(1)}° → ${record.pfeTo99Deg.toFixed(1)}° (Δ${degDiff.toFixed(1)}°)`);
    } else if (degDiff > 8 && nPfd < 80) {
      score += 15;
      reasons.push(`Kademeli açılma: ${record.pfdTurn1Deg.toFixed(1)}° → ${record.pfeTo99Deg.toFixed(1)}°`);
    }
  }

  // ===========================================
  // Signal 6: Doubled record detection
  // PFD > 150% means two panels were summed
  // This is an informational flag, not necessarily an anomaly
  // ===========================================
  if (record.isDoubledRecord) {
    // Don't add to score — this is a data interpretation issue
    reasons.push(`Çift panel kaydı tespit edildi (ham PFD: ${record.pfdTurn1.toFixed(1)}%)`);
  }

  // ===========================================
  // Signal 7: GS at Auto SBOP
  // Very low values might indicate early deployment
  // But this heavily depends on flight distance
  // Only flag truly extreme values
  // ===========================================
  if (record.gsAtAutoSbop > 0 && record.gsAtAutoSbop < 1500) {
    score += 5;
    reasons.push(`GS@SBOP düşük: ${record.gsAtAutoSbop.toFixed(0)} — kısa mesafe veya erken açılma`);
  }

  // ===========================================
  // Signal 8: Long landing distance with low PFD
  // This is the actual safety-relevant combination:
  // low speedbrake effectiveness → longer stopping distance
  // ===========================================
  if (nPfd < 85 && record.landingDist30kn > 1800) {
    score += 15;
    reasons.push(`Düşük PFD (${nPfd.toFixed(1)}%) + uzun iniş (${record.landingDist30kn.toFixed(0)}m)`);
  }

  // ===========================================
  // FINAL CLASSIFICATION based on accumulated score
  //
  // The key insight: a single mildly off-normal parameter
  // should NOT trigger an alert. Multiple corroborating
  // signals are needed.
  //
  // Score thresholds:
  //   0-15:  Normal — single mild deviations are expected
  //   16-39: Warning — multiple signals agree something is off
  //   40+:   Critical — strong evidence of a real problem
  // ===========================================
  let level: 'normal' | 'warning' | 'critical' = 'normal';

  if (score >= 40) {
    level = 'critical';
  } else if (score >= 16) {
    level = 'warning';
  }

  // Clean up: if no reasons accumulated, ensure level stays normal
  if (reasons.length === 0) {
    level = 'normal';
  }

  // For doubled records that otherwise look fine, downgrade to normal
  if (level === 'normal' && reasons.length === 1 && record.isDoubledRecord) {
    // Just an informational note, not a real anomaly
    level = 'normal';
  }

  return { level, reasons };
}

// ----------------------------------------------------------------
// Parse Excel rows → FlightRecord[]
// Optimized: batch column detection, pre-allocated array
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

    const { level, reasons } = detectAnomaly(partial);

    records.push({
      ...partial,
      anomalyLevel: level,
      anomalyReasons: reasons,
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
    else if (d.anomalyLevel === 'warning') warningCount++;
    else normalCount++;

    if (d.normalizedPfd > 0 && d.normalizedPfd < 105) { pfdSum += d.normalizedPfd; pfdCount++; }
    if (d.pfdTurn1Deg > 0 && d.pfdTurn1Deg < 100) { degSum += d.pfdTurn1Deg; degCount++; }
    if (d.durationDerivative > 0 && d.durationDerivative < 50) { durSum += d.durationDerivative; durCount++; }
    if (d.landingDist30kn > 0 && d.landingDist30kn < 5000) { ldSum += d.landingDist30kn; ldCount++; }
    if (d.durationRatio > 0 && d.durationRatio < 50) { drSum += d.durationRatio; drCount++; }
    if (d.isDoubledRecord) doubledRecords++;
    if (d.landingDistAnomaly) landingDistAnomalyCount++;
    // Slow opening: requires BOTH low PFD AND significant angle difference
    if (d.normalizedPfd < 85 && d.pfeTo99Deg - d.pfdTurn1Deg > 8) slowOpeningCount++;
    // Mechanical failure: requires BOTH very low PFD AND very low angle
    if (d.normalizedPfd < 70 && d.pfdTurn1Deg < 20) mechanicalFailureCount++;
  }

  return {
    totalFlights: n,
    criticalCount,
    warningCount,
    normalCount,
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
// Filtering (legacy — non-indexed fallback)
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
// Pearson correlation — single pass
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
