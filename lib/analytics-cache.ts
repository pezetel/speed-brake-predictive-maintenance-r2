// ============================================================
// B737 Speedbrake — Analytics Cache Layer
// Caches heavy computations keyed by data identity + filters.
// Avoids recomputing tail health / insights / landing analysis
// on every render when inputs haven't changed.
// ============================================================
import { FlightRecord, AnomalySummary, FilterState } from './types';
import {
  TailHealthScore,
  PredictiveInsight,
  LandingDistanceAnalysisRecord,
  FlightTimelineEntry,
} from './types';
import { computeSummary } from './utils';
import {
  computeTailHealthScores,
  generatePredictiveInsights,
  analyzeLandingDistances,
  buildFlightTimeline,
} from './analytics';

// ----------------------------------------------------------------
// Simple identity-based cache: stores last input reference + result
// This is cheaper than hashing 50K records — referential equality
// is sufficient because we produce new arrays on filter change.
// ----------------------------------------------------------------

interface CacheEntry<T> {
  dataRef: FlightRecord[];
  extraKey: string;
  result: T;
}

function makeCache<T>() {
  let entry: CacheEntry<T> | null = null;

  return {
    get(data: FlightRecord[], extraKey: string = ''): T | null {
      if (
        entry &&
        entry.dataRef === data &&
        entry.extraKey === extraKey
      ) {
        return entry.result;
      }
      return null;
    },
    set(data: FlightRecord[], result: T, extraKey: string = ''): void {
      entry = { dataRef: data, extraKey, result };
    },
    clear(): void {
      entry = null;
    },
  };
}

// Create typed caches
const summaryCache = makeCache<AnomalySummary>();
const healthScoresCache = makeCache<TailHealthScore[]>();
const insightsCache = makeCache<PredictiveInsight[]>();
const landingAnalysisCache = makeCache<LandingDistanceAnalysisRecord[]>();
const timelineCache = makeCache<FlightTimelineEntry[]>();

// ----------------------------------------------------------------
// Cached computation functions
// ----------------------------------------------------------------

export function getCachedSummary(data: FlightRecord[]): AnomalySummary {
  const cached = summaryCache.get(data);
  if (cached) return cached;
  const result = computeSummary(data);
  summaryCache.set(data, result);
  return result;
}

export function getCachedHealthScores(data: FlightRecord[]): TailHealthScore[] {
  const cached = healthScoresCache.get(data);
  if (cached) return cached;
  const result = computeTailHealthScores(data);
  healthScoresCache.set(data, result);
  return result;
}

export function getCachedInsights(
  data: FlightRecord[],
  healthScores: TailHealthScore[],
): PredictiveInsight[] {
  // Use healthScores length as extra key to invalidate when scores change
  const extra = String(healthScores.length) + ':' + (healthScores[0]?.healthScore ?? '');
  const cached = insightsCache.get(data, extra);
  if (cached) return cached;
  const result = generatePredictiveInsights(data, healthScores);
  insightsCache.set(data, result, extra);
  return result;
}

export function getCachedLandingAnalysis(
  data: FlightRecord[],
): LandingDistanceAnalysisRecord[] {
  const cached = landingAnalysisCache.get(data);
  if (cached) return cached;
  const result = analyzeLandingDistances(data);
  landingAnalysisCache.set(data, result);
  return result;
}

export function getCachedTimeline(
  data: FlightRecord[],
): FlightTimelineEntry[] {
  const cached = timelineCache.get(data);
  if (cached) return cached;
  const result = buildFlightTimeline(data);
  timelineCache.set(data, result);
  return result;
}

/**
 * Clear all analytics caches (e.g., on new file upload)
 */
export function clearAllCaches(): void {
  summaryCache.clear();
  healthScoresCache.clear();
  insightsCache.clear();
  landingAnalysisCache.clear();
  timelineCache.clear();
}
