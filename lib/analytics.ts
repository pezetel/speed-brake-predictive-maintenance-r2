// ============================================================
// B737 Speedbrake Predictive Maintenance — Analytics engine
// Optimized: single-pass aggregations, Map-based grouping
// Updated: Landing distance warning weight reduced,
//          worst-flight penalty added to health score
// ============================================================
import {
  FlightRecord,
  TailHealthScore,
  PredictiveInsight,
  LandingDistanceAnalysisRecord,
  FlightTimelineEntry,
} from './types';

// ----------------------------------------------------------------
// Tail-level health scoring — O(n) single pass grouping
// ----------------------------------------------------------------
export function computeTailHealthScores(data: FlightRecord[]): TailHealthScore[] {
  if (data.length === 0) return [];

  // Single pass to group by tail and accumulate stats
  const tailAgg = new Map<string, {
    aircraftType: 'NG' | 'MAX';
    flights: number;
    pfdSum: number; pfdCount: number;
    degSum: number; degCount: number;
    durDerivSum: number; durDerivCount: number;
    durExtSum: number; durExtCount: number;
    l30Sum: number; l30Count: number;
    l50Sum: number; l50Count: number;
    criticalCount: number; warningCount: number;
    ldOnlyWarningCount: number; // warnings caused ONLY by landing distance inversion
    drSum: number; drCount: number;
    ldAnomalyCount: number;
    firstHalfPfd: number[]; secondHalfPfd: number[];
    lastDate: string;
    sortedPfds: number[];
    worstPfd: number; // lowest normalized PFD seen
  }>();

  // First pass — accumulate
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    let agg = tailAgg.get(d.tailNumber);
    if (!agg) {
      agg = {
        aircraftType: d.aircraftType,
        flights: 0,
        pfdSum: 0, pfdCount: 0,
        degSum: 0, degCount: 0,
        durDerivSum: 0, durDerivCount: 0,
        durExtSum: 0, durExtCount: 0,
        l30Sum: 0, l30Count: 0,
        l50Sum: 0, l50Count: 0,
        criticalCount: 0, warningCount: 0,
        ldOnlyWarningCount: 0,
        drSum: 0, drCount: 0,
        ldAnomalyCount: 0,
        firstHalfPfd: [], secondHalfPfd: [],
        lastDate: '',
        sortedPfds: [],
        worstPfd: 999,
      };
      tailAgg.set(d.tailNumber, agg);
    }

    agg.flights++;
    if (d.normalizedPfd > 0 && d.normalizedPfd <= 105) {
      agg.pfdSum += d.normalizedPfd;
      agg.pfdCount++;
      agg.sortedPfds.push(d.normalizedPfd);
      if (d.normalizedPfd < agg.worstPfd) agg.worstPfd = d.normalizedPfd;
    }
    if (d.pfdTurn1Deg > 0 && d.pfdTurn1Deg < 100) { agg.degSum += d.pfdTurn1Deg; agg.degCount++; }
    if (d.durationDerivative > 0) { agg.durDerivSum += d.durationDerivative; agg.durDerivCount++; }
    if (d.durationExtTo99 > 0) { agg.durExtSum += d.durationExtTo99; agg.durExtCount++; }
    if (d.landingDist30kn > 0) { agg.l30Sum += d.landingDist30kn; agg.l30Count++; }
    if (d.landingDist50kn > 0) { agg.l50Sum += d.landingDist50kn; agg.l50Count++; }
    if (d.anomalyLevel === 'critical') agg.criticalCount++;
    if (d.anomalyLevel === 'warning') {
      agg.warningCount++;
      // Check if this warning is ONLY from landing distance inversion
      // A warning with score 16-39 where landing distance contributes 30 pts
      // means without LD the score would be < 16 → not a real speedbrake warning
      const isLdAnomaly = d.landingDistAnomaly;
      const hasSpeedbrakeIssue = d.normalizedPfd < 92 ||
        (d.durationRatio > 3 && d.durationExtTo99 > 4) ||
        (d.pfdTurn1Deg > 0 && d.pfdTurn1Deg < 25 && d.normalizedPfd < 80);
      if (isLdAnomaly && !hasSpeedbrakeIssue) {
        agg.ldOnlyWarningCount++;
      }
    }
    if (d.durationRatio > 0 && d.durationRatio < 50) { agg.drSum += d.durationRatio; agg.drCount++; }
    if (d.landingDistAnomaly) agg.ldAnomalyCount++;
    if (d.flightDate > agg.lastDate) agg.lastDate = d.flightDate;
  }

  const scores: TailHealthScore[] = [];

  tailAgg.forEach((agg, tailNumber) => {
    const avgPfd = agg.pfdCount > 0 ? agg.pfdSum / agg.pfdCount : 0;
    const avgDeg = agg.degCount > 0 ? agg.degSum / agg.degCount : 0;
    const avgDurationDeriv = agg.durDerivCount > 0 ? agg.durDerivSum / agg.durDerivCount : 0;
    const avgDurationExt = agg.durExtCount > 0 ? agg.durExtSum / agg.durExtCount : 0;
    const avgLanding30 = agg.l30Count > 0 ? agg.l30Sum / agg.l30Count : 0;
    const avgLanding50 = agg.l50Count > 0 ? agg.l50Sum / agg.l50Count : 0;
    const durationRatioAvg = agg.drCount > 0 ? agg.drSum / agg.drCount : 0;
    const landingDistAnomalyRate = agg.ldAnomalyCount / Math.max(agg.flights, 1);
    const worstPfd = agg.worstPfd === 999 ? 0 : agg.worstPfd;

    // Separate warning counts
    const realWarningCount = agg.warningCount - agg.ldOnlyWarningCount;
    const ldOnlyWarningCount = agg.ldOnlyWarningCount;

    // ============================================================
    // Health score 0–100
    // UPDATED: Landing distance warnings weighted less,
    //          worst-flight penalty added
    // ============================================================
    let hs = 100;

    // Average PFD penalty
    if (avgPfd < 95) hs -= (95 - avgPfd) * 1.5;
    if (avgPfd < 80) hs -= (80 - avgPfd) * 2;

    // Critical flights: -5 each
    hs -= agg.criticalCount * 5;

    // Warnings: differentiate by type
    // Real speedbrake warnings (PFD/angle/duration issues): full weight
    hs -= realWarningCount * 2;
    // Landing-distance-only warnings (sensor/data quality): reduced weight
    hs -= ldOnlyWarningCount * 0.5;

    // Duration ratio penalty
    if (durationRatioAvg > 2) hs -= (durationRatioAvg - 2) * 5;

    // Landing distance anomaly rate: reduced from 20 to 10
    hs -= landingDistAnomalyRate * 10;

    // Low average angle
    if (avgDeg < 40) hs -= (40 - avgDeg) * 0.5;

    // NEW: Worst single flight penalty
    // Even one very bad flight is a strong signal of intermittent failure
    if (worstPfd > 0 && worstPfd < 50) hs -= 20;
    else if (worstPfd > 0 && worstPfd < 70) hs -= 10;
    else if (worstPfd > 0 && worstPfd < 80) hs -= 5;

    hs = Math.max(0, Math.min(100, hs));

    let riskLevel: TailHealthScore['riskLevel'] = 'LOW';
    if (hs < 50) riskLevel = 'CRITICAL';
    else if (hs < 70) riskLevel = 'HIGH';
    else if (hs < 85) riskLevel = 'MEDIUM';

    // Trend from PFD values
    const pfds = agg.sortedPfds;
    const mid = Math.floor(pfds.length / 2) || 1;
    let fp = 0, sp = 0;
    if (pfds.length >= 4) {
      let fpSum = 0, spSum = 0;
      for (let k = 0; k < mid; k++) fpSum += pfds[k];
      for (let k = mid; k < pfds.length; k++) spSum += pfds[k];
      fp = fpSum / mid;
      sp = spSum / (pfds.length - mid);
    }
    const degradationRate = fp - sp;
    let trend: TailHealthScore['trend'] = 'stable';
    if (degradationRate > 3) trend = 'degrading';
    else if (degradationRate < -3) trend = 'improving';

    scores.push({
      tailNumber,
      aircraftType: agg.aircraftType,
      totalFlights: agg.flights,
      avgPfd,
      avgDeg,
      avgDurationDeriv: avgDurationDeriv,
      avgDurationExt: avgDurationExt,
      avgLanding30: avgLanding30,
      avgLanding50: avgLanding50,
      criticalCount: agg.criticalCount,
      warningCount: agg.warningCount,
      healthScore: Math.round(hs * 10) / 10,
      riskLevel,
      trend,
      durationRatioAvg,
      landingDistAnomalyRate,
      lastFlightDate: agg.lastDate,
      degradationRate,
    });
  });

  return scores.sort((a, b) => a.healthScore - b.healthScore);
}

// ----------------------------------------------------------------
// Predictive insights generation — uses pre-computed health scores
// No per-flight scanning per tail (avoids O(n*tails))
// ----------------------------------------------------------------
export function generatePredictiveInsights(
  data: FlightRecord[],
  healthScores: TailHealthScore[],
): PredictiveInsight[] {
  const insights: PredictiveInsight[] = [];
  let id = 0;

  // Pre-group flights by tail for evidence lookup (lazy - only access when needed)
  let tailFlightsMap: Map<string, FlightRecord[]> | null = null;
  function getTailFlights(tail: string): FlightRecord[] {
    if (!tailFlightsMap) {
      tailFlightsMap = new Map();
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        let arr = tailFlightsMap.get(d.tailNumber);
        if (!arr) { arr = []; tailFlightsMap.set(d.tailNumber, arr); }
        arr.push(d);
      }
    }
    return tailFlightsMap.get(tail) || [];
  }

  for (const h of healthScores) {
    // Skip healthy tails entirely for performance
    if (h.healthScore > 90 && h.criticalCount === 0 && h.warningCount < 2) continue;

    const flights = getTailFlights(h.tailNumber);

    // 1. Hydraulic resistance
    if (h.durationRatioAvg > 2.5) {
      const hiRatio = flights.filter((f) => f.durationRatio > 3);
      if (hiRatio.length >= 2) {
        insights.push({
          id: `ins-${++id}`,
          tailNumber: h.tailNumber,
          category: 'hydraulic',
          severity: hiRatio.length >= 4 ? 'critical' : 'warning',
          title: `Hidrolik Direnç Şüphesi — ${h.tailNumber}`,
          description: `Speedbrake %99'a ulaşma süresi, türev süresinin ${h.durationRatioAvg.toFixed(1)}x katı. Hidrolik sistemde artan direnç veya basınç düşüşü.`,
          evidence: hiRatio.slice(0, 5).map(
            (f) =>
              `${f.flightDate} ${f.takeoffAirport}→${f.landingAirport}: Ratio ${f.durationRatio.toFixed(1)}x`,
          ),
          recommendation:
            'Hidrolik aktuatör basıncını kontrol edin. Hidrolik sıvı seviyesi ve kalitesini test edin. PCU muayenesi önerilir.',
          relatedFlights: hiRatio.length,
          confidence: Math.min(95, 60 + hiRatio.length * 8),
        });
      }
    }

    // 2. Mechanical failure
    if (h.avgPfd < 80 || h.criticalCount > 0) {
      const mechFail = flights.filter((f) => f.normalizedPfd < 75 && f.pfdTurn1Deg < 30);
      if (mechFail.length >= 1) {
        insights.push({
          id: `ins-${++id}`,
          tailNumber: h.tailNumber,
          category: 'mechanical',
          severity: mechFail.length >= 2 ? 'critical' : 'warning',
          title: `Mekanik Arıza Tespiti — ${h.tailNumber}`,
          description: `Speedbrake fiziksel olarak tam açılamıyor. PFD ${mechFail[0].normalizedPfd.toFixed(1)}%, açı sadece ${mechFail[0].pfdTurn1Deg.toFixed(1)}°.`,
          evidence: mechFail.slice(0, 5).map(
            (f) =>
              `${f.flightDate} ${f.takeoffAirport}→${f.landingAirport}: PFD=${f.pfdTurn1.toFixed(1)}, DEG=${f.pfdTurn1Deg.toFixed(1)}°`,
          ),
          recommendation:
            'Speedbrake mekanik bağlantılarını, rulmanları ve actuator linkage\'ı kontrol edin.',
          relatedFlights: mechFail.length,
          confidence: Math.min(95, 70 + mechFail.length * 10),
        });
      }
    }

    // 3. Slow/delayed opening
    if (h.avgPfd < 92) {
      const slow = flights.filter((f) => f.pfeTo99Deg - f.pfdTurn1Deg > 8 && f.normalizedPfd < 90);
      if (slow.length >= 2) {
        insights.push({
          id: `ins-${++id}`,
          tailNumber: h.tailNumber,
          category: 'actuator',
          severity: 'warning',
          title: `Yavaş / Gecikmeli Açılma — ${h.tailNumber}`,
          description: `Speedbrake başlangıçta eksik açılıyor, zamanla %99'a ulaşıyor.`,
          evidence: slow.slice(0, 5).map(
            (f) =>
              `${f.flightDate}: ${f.pfdTurn1Deg.toFixed(1)}° → ${f.pfeTo99Deg.toFixed(1)}° (Δ${(f.pfeTo99Deg - f.pfdTurn1Deg).toFixed(1)}°)`,
          ),
          recommendation:
            'Actuator hız ayarını kontrol edin. Speedbrake hinge noktalarında sürtünme olup olmadığını inceleyin.',
          relatedFlights: slow.length,
          confidence: Math.min(90, 55 + slow.length * 7),
        });
      }
    }

    // 4. Landing-distance anomaly
    if (h.landingDistAnomalyRate > 0.02) {
      const ldAnom = flights.filter((f) => f.landingDistAnomaly);
      if (ldAnom.length >= 2) {
        insights.push({
          id: `ins-${++id}`,
          tailNumber: h.tailNumber,
          category: 'operational',
          severity: ldAnom.length >= 4 ? 'critical' : 'warning',
          title: `İniş Mesafesi Anomalisi — ${h.tailNumber}`,
          description: `${ldAnom.length} uçuşta 50kn iniş mesafesi > 30kn iniş mesafesi. Sensör veya fren sistemi sorunu olabilir.`,
          evidence: ldAnom.slice(0, 5).map(
            (f) =>
              `${f.flightDate} ${f.takeoffAirport}→${f.landingAirport}: 30kn=${f.landingDist30kn.toFixed(0)}m, 50kn=${f.landingDist50kn.toFixed(0)}m`,
          ),
          recommendation:
            'Wheel speed sensörlerini kalibre edin. Fren sistemi performansını test edin.',
          relatedFlights: ldAnom.length,
          confidence: Math.min(90, 65 + ldAnom.length * 5),
        });
      }
    }

    // 5. Performance degradation trend
    if (h.trend === 'degrading' && h.degradationRate > 5) {
      insights.push({
        id: `ins-${++id}`,
        tailNumber: h.tailNumber,
        category: 'sensor',
        severity: h.degradationRate > 10 ? 'critical' : 'warning',
        title: `Performans Degradasyonu — ${h.tailNumber}`,
        description: `Son uçuşlarda PFD değeri ortalama ${h.degradationRate.toFixed(1)} puan düşmüş. Speedbrake performansı kötüleşiyor.`,
        evidence: [
          `İlk yarı ort. PFD: ${(h.avgPfd + h.degradationRate / 2).toFixed(1)}`,
          `İkinci yarı ort. PFD: ${(h.avgPfd - h.degradationRate / 2).toFixed(1)}`,
          `Degradasyon hızı: ${h.degradationRate.toFixed(1)} puan`,
          `Son uçuş: ${h.lastFlightDate}`,
        ],
        recommendation:
          'Speedbrake sisteminin tüm bileşenlerini kapsamlı şekilde inceleyin. Preventif bakım zamanlaması öne alınmalıdır.',
        relatedFlights: h.totalFlights,
        confidence: Math.min(85, 50 + h.degradationRate * 3),
      });
    }
  }

  return insights.sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 };
    return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2) || b.confidence - a.confidence;
  });
}

// ----------------------------------------------------------------
// Landing-distance analysis rows
// ----------------------------------------------------------------
export function analyzeLandingDistances(data: FlightRecord[]): LandingDistanceAnalysisRecord[] {
  const results: LandingDistanceAnalysisRecord[] = [];

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (d.landingDist30kn <= 0 || d.landingDist50kn <= 0) continue;

    let anomalyType: LandingDistanceAnalysisRecord['anomalyType'] = 'normal';
    let risk = 0;

    if (d.landingDist50kn > d.landingDist30kn * 1.05) {
      anomalyType = '50kn_exceeds_30kn';
      risk += 40;
    }
    if (d.landingDist30kn > 2000) {
      if (anomalyType === 'normal') anomalyType = 'excessive_distance';
      risk += 20;
    }
    if (d.normalizedPfd < 85 && d.landingDist30kn > 1800) {
      if (anomalyType === 'normal') anomalyType = 'pfd_correlation';
      risk += 30;
    }
    if (d.normalizedPfd < 70) risk += 20;
    if (d.durationRatio > 3) risk += 10;

    results.push({
      tailNumber: d.tailNumber,
      route: `${d.takeoffAirport}→${d.landingAirport}`,
      date: d.flightDate,
      dist30kn: d.landingDist30kn,
      dist50kn: d.landingDist50kn,
      pfd: d.normalizedPfd,
      deg: d.pfdTurn1Deg,
      anomalyType,
      riskScore: Math.min(100, risk),
    });
  }

  results.sort((a, b) => b.riskScore - a.riskScore);
  return results;
}

// ----------------------------------------------------------------
// Flight timeline entries — light transform, no heavy sort needed
// ----------------------------------------------------------------
export function buildFlightTimeline(data: FlightRecord[]): FlightTimelineEntry[] {
  const entries: FlightTimelineEntry[] = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    entries[i] = {
      date: d.flightDate,
      tailNumber: d.tailNumber,
      route: `${d.takeoffAirport}→${d.landingAirport}`,
      pfd: d.normalizedPfd,
      deg: d.pfdTurn1Deg,
      durationRatio: d.durationRatio,
      anomalyLevel: d.anomalyLevel,
      reasons: d.anomalyReasons,
      landingDist30: d.landingDist30kn,
      landingDist50: d.landingDist50kn,
      gsAtSbop: d.gsAtAutoSbop,
    };
  }
  return entries;
}
