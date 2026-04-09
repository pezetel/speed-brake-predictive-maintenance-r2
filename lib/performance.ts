// ============================================================
// B737 Speedbrake — Performance utilities for large datasets
// Heavy optimization for 50k+ rows
// ============================================================
import { FlightRecord } from './types';

/**
 * Downsample an array for chart rendering.
 * Uses LTTB-like reservoir sampling to keep visual fidelity.
 */
export function downsample<T>(
  data: T[],
  maxPoints: number,
  valueFn?: (d: T) => number,
): T[] {
  if (data.length <= maxPoints) return data;

  const result: T[] = [data[0]];
  const step = (data.length - 2) / (maxPoints - 2);

  for (let i = 1; i < maxPoints - 1; i++) {
    const idx = Math.round(1 + i * step);
    result.push(data[Math.min(idx, data.length - 1)]);
  }
  result.push(data[data.length - 1]);
  return result;
}

/**
 * Stratified sample: keep ALL anomalies, sample normals.
 * Critical for not losing important data points in charts.
 */
export function stratifiedSample(
  data: FlightRecord[],
  maxTotal: number,
): FlightRecord[] {
  if (data.length <= maxTotal) return data;

  const criticals: FlightRecord[] = [];
  const warnings: FlightRecord[] = [];
  const normals: FlightRecord[] = [];

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (d.anomalyLevel === 'critical') criticals.push(d);
    else if (d.anomalyLevel === 'warning') warnings.push(d);
    else normals.push(d);
  }

  const kept = [...criticals, ...warnings];
  const remaining = maxTotal - kept.length;

  if (remaining > 0 && normals.length > 0) {
    const sampled = reservoirSample(normals, Math.max(remaining, 0));
    kept.push(...sampled);
  }

  return kept.slice(0, maxTotal);
}

/** Reservoir sampling — O(n) uniform random sample */
export function reservoirSample<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return arr.slice();
  const reservoir = arr.slice(0, k);
  for (let i = k; i < arr.length; i++) {
    const j = Math.floor(Math.random() * (i + 1));
    if (j < k) reservoir[j] = arr[i];
  }
  return reservoir;
}

/**
 * Batch-process an array in chunks to avoid blocking the main thread.
 * Yields control back to the browser between chunks.
 */
export function processInChunks<T, R>(
  items: T[],
  processor: (item: T) => R,
  chunkSize = 5000,
): Promise<R[]> {
  return new Promise((resolve) => {
    const results: R[] = new Array(items.length);
    let index = 0;

    function nextChunk() {
      const end = Math.min(index + chunkSize, items.length);
      for (let i = index; i < end; i++) {
        results[i] = processor(items[i]);
      }
      index = end;
      if (index < items.length) {
        setTimeout(nextChunk, 0);
      } else {
        resolve(results);
      }
    }

    nextChunk();
  });
}

/**
 * Debounce helper for filter changes
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

/**
 * Simple LRU-ish memoization by key string
 */
const memoCache = new Map<string, { value: any; ts: number }>();
const MEMO_MAX = 100;

export function memoized<T>(key: string, compute: () => T, ttlMs = 60000): T {
  const cached = memoCache.get(key);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.value as T;

  const value = compute();
  if (memoCache.size >= MEMO_MAX) {
    const oldest = memoCache.keys().next().value;
    if (oldest !== undefined) memoCache.delete(oldest);
  }
  memoCache.set(key, { value, ts: Date.now() });
  return value;
}

export function clearMemoCache() {
  memoCache.clear();
}

/** Aggregate numeric field stats in a single pass — O(n) */
export function quickStats(values: number[]): {
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
  count: number;
} {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, min: 0, max: 0, median: 0, count: 0 };

  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < n; i++) {
    const v = values[i];
    sum += v;
    sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));

  // Approximate median with sampling for very large arrays
  let median: number;
  if (n > 10000) {
    const sample = reservoirSample(values, 1000).sort((a, b) => a - b);
    median = sample[Math.floor(sample.length / 2)];
  } else {
    const sorted = [...values].sort((a, b) => a - b);
    median =
      n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
  }

  return { mean, std, min, max, median, count: n };
}

/**
 * Pre-build indexes for fast filtering on large datasets.
 * Returns a lookup object keyed by tail, date, aircraftType, anomalyLevel.
 */
export interface DataIndex {
  byTail: Map<string, number[]>;
  byAircraftType: Map<string, number[]>;
  byAnomalyLevel: Map<string, number[]>;
  byAirport: Map<string, number[]>;
  allTails: string[];
  allAirports: string[];
  allDates: string[];
  dateRange: [string, string];
}

export function buildDataIndex(data: FlightRecord[]): DataIndex {
  const byTail = new Map<string, number[]>();
  const byAircraftType = new Map<string, number[]>();
  const byAnomalyLevel = new Map<string, number[]>();
  const byAirport = new Map<string, number[]>();
  const tailSet = new Set<string>();
  const airportSet = new Set<string>();
  const dateSet = new Set<string>();

  for (let i = 0; i < data.length; i++) {
    const d = data[i];

    // Tail index
    if (!byTail.has(d.tailNumber)) byTail.set(d.tailNumber, []);
    byTail.get(d.tailNumber)!.push(i);
    tailSet.add(d.tailNumber);

    // Aircraft type index
    if (!byAircraftType.has(d.aircraftType)) byAircraftType.set(d.aircraftType, []);
    byAircraftType.get(d.aircraftType)!.push(i);

    // Anomaly level index
    if (!byAnomalyLevel.has(d.anomalyLevel)) byAnomalyLevel.set(d.anomalyLevel, []);
    byAnomalyLevel.get(d.anomalyLevel)!.push(i);

    // Airport index
    if (d.takeoffAirport && d.takeoffAirport !== 'UNKNOWN') {
      if (!byAirport.has(d.takeoffAirport)) byAirport.set(d.takeoffAirport, []);
      byAirport.get(d.takeoffAirport)!.push(i);
      airportSet.add(d.takeoffAirport);
    }
    if (d.landingAirport && d.landingAirport !== 'UNKNOWN') {
      if (!byAirport.has(d.landingAirport)) byAirport.set(d.landingAirport, []);
      byAirport.get(d.landingAirport)!.push(i);
      airportSet.add(d.landingAirport);
    }

    dateSet.add(d.flightDate);
  }

  const allTails = Array.from(tailSet).sort();
  const allAirports = Array.from(airportSet).sort();
  const allDates = Array.from(dateSet).sort();

  return {
    byTail,
    byAircraftType,
    byAnomalyLevel,
    byAirport,
    allTails,
    allAirports,
    allDates,
    dateRange: [allDates[0] || '', allDates[allDates.length - 1] || ''],
  };
}

/**
 * Fast filter using pre-built indexes — avoids scanning all 50k records.
 * When multiple filters are active, uses the smallest index as a starting set.
 */
import { FilterState } from './types';

export function applyFiltersIndexed(
  data: FlightRecord[],
  filters: FilterState,
  index: DataIndex,
): FlightRecord[] {
  // If no filters, return all
  const hasType = filters.aircraftType !== 'ALL';
  const hasLevel = filters.anomalyLevel !== 'ALL';
  const hasTail = filters.tails.length > 0;
  const hasAirport = !!filters.airport;
  const hasDate = !!filters.dateRange;

  if (!hasType && !hasLevel && !hasTail && !hasAirport && !hasDate) {
    return data;
  }

  // Collect candidate index sets
  const candidateSets: Set<number>[] = [];

  if (hasTail) {
    const idxSet = new Set<number>();
    for (const t of filters.tails) {
      const indices = index.byTail.get(t);
      if (indices) for (const idx of indices) idxSet.add(idx);
    }
    candidateSets.push(idxSet);
  }

  if (hasType) {
    const indices = index.byAircraftType.get(filters.aircraftType);
    if (indices) candidateSets.push(new Set(indices));
    else return []; // no match
  }

  if (hasLevel) {
    const indices = index.byAnomalyLevel.get(filters.anomalyLevel);
    if (indices) candidateSets.push(new Set(indices));
    else return [];
  }

  if (hasAirport) {
    const ap = filters.airport.toUpperCase();
    const indices = index.byAirport.get(ap);
    if (indices) candidateSets.push(new Set(indices));
    else return [];
  }

  // Intersect all candidate sets
  let resultIndices: Set<number>;
  if (candidateSets.length === 0) {
    // Only date filter — must scan
    resultIndices = new Set(data.map((_, i) => i));
  } else if (candidateSets.length === 1) {
    resultIndices = candidateSets[0];
  } else {
    // Start from smallest set for performance
    candidateSets.sort((a, b) => a.size - b.size);
    resultIndices = new Set<number>();
    const smallest = candidateSets[0];
    for (const idx of smallest) {
      let inAll = true;
      for (let s = 1; s < candidateSets.length; s++) {
        if (!candidateSets[s].has(idx)) { inAll = false; break; }
      }
      if (inAll) resultIndices.add(idx);
    }
  }

  // Apply date filter on the remaining set
  const results: FlightRecord[] = [];
  for (const idx of resultIndices) {
    const d = data[idx];
    if (hasDate) {
      if (d.flightDate < filters.dateRange![0] || d.flightDate > filters.dateRange![1]) continue;
    }
    results.push(d);
  }

  return results;
}
