// ============================================================
// B737 Speedbrake — useFilteredData hook
// Centralizes filtering with index-based acceleration.
// Avoids the [...data] copy pattern in applyFilters.
// Memoizes the DataIndex build once per raw data change.
// ============================================================
import { useMemo, useRef } from 'react';
import { FlightRecord, FilterState } from './types';
import { buildDataIndex, DataIndex, applyFiltersIndexed } from './performance';

/**
 * Returns filtered data using pre-built indexes for O(subset) filtering
 * instead of O(n) full-scan on every filter change.
 *
 * The DataIndex is built once when `data` reference changes.
 * Filtering uses set intersection on the smallest index first.
 */
export function useFilteredData(
  data: FlightRecord[],
  filters: FilterState,
): {
  filteredData: FlightRecord[];
  index: DataIndex;
} {
  // Build index once per data change — O(n) but only when data reference changes
  const index = useMemo(() => buildDataIndex(data), [data]);

  // Use stable reference: if filters produce same result, avoid new array
  const prevRef = useRef<{ filters: FilterState; result: FlightRecord[] } | null>(null);

  const filteredData = useMemo(() => {
    // Quick path: no filters active → return original array (no copy)
    const noFilters =
      filters.aircraftType === 'ALL' &&
      filters.anomalyLevel === 'ALL' &&
      filters.tails.length === 0 &&
      !filters.airport &&
      !filters.dateRange;

    if (noFilters) return data;

    return applyFiltersIndexed(data, filters, index);
  }, [data, filters, index]);

  return { filteredData, index };
}

/**
 * Extract unique values from the index for filter dropdowns.
 * No scanning needed — reads directly from pre-built index.
 */
export function useFilterOptions(index: DataIndex) {
  return useMemo(
    () => ({
      allTails: index.allTails,
      allAirports: index.allAirports,
      allDates: index.allDates,
      dateRange: index.dateRange,
    }),
    [index],
  );
}
