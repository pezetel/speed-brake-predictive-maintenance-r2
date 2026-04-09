// ============================================================
// Indexed data store for 50k+ record performance
// Centralizes data + indexes to avoid redundant computations
// ============================================================
import { FlightRecord, FilterState, AnomalySummary } from './types';
import { buildDataIndex, DataIndex, applyFiltersIndexed } from './performance';
import { computeSummary } from './utils';

export interface DataStore {
  allData: FlightRecord[];
  index: DataIndex;
}

export function createDataStore(data: FlightRecord[]): DataStore {
  return {
    allData: data,
    index: buildDataIndex(data),
  };
}

export function filterFromStore(
  store: DataStore,
  filters: FilterState,
): FlightRecord[] {
  return applyFiltersIndexed(store.allData, filters, store.index);
}

/**
 * Pre-compute per-tail flight map for fast lookups.
 * Returns a Map<tailNumber, FlightRecord[]>
 */
export function buildTailFlightMap(data: FlightRecord[]): Map<string, FlightRecord[]> {
  const map = new Map<string, FlightRecord[]>();
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    let arr = map.get(d.tailNumber);
    if (!arr) {
      arr = [];
      map.set(d.tailNumber, arr);
    }
    arr.push(d);
  }
  return map;
}
