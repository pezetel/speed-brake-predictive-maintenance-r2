'use client';

import { useMemo } from 'react';
import { FilterState } from '@/lib/types';
import { Filter, X } from 'lucide-react';

interface Props {
  index: {
    tails?: string[];
    airports?: string[];
    dateRange?: [string, string] | null;
    allTails?: string[];
    allAirports?: string[];
  };
  filters: FilterState;
  onFilterChange: (f: FilterState) => void;
}

export default function Filters({ index, filters, onFilterChange }: Props) {
  const tails = useMemo(() => (index.tails || index.allTails || []).slice().sort(), [index.tails, index.allTails]);
  const airports = useMemo(() => (index.airports || index.allAirports || []).slice().sort(), [index.airports, index.allAirports]);
  const dateRange = index.dateRange || null;

  const hasFilters = filters.anomalyLevel !== 'ALL' || filters.tails.length > 0 || filters.airport !== '' || filters.dateRange !== null;

  const resetFilters = () => onFilterChange({ dateRange: null, tails: [], aircraftType: 'ALL', anomalyLevel: 'ALL', airport: '' });

  return (
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <Filter className="w-4 h-4 text-slate-400" />

      <select value={filters.anomalyLevel} onChange={e => onFilterChange({ ...filters, anomalyLevel: e.target.value as any })} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-600">
        <option value="ALL">Tüm Seviyeler</option><option value="normal">Normal</option><option value="warning">Uyarı</option><option value="critical">Kritik</option>
      </select>

      <select value={filters.tails.length === 1 ? filters.tails[0] : ''} onChange={e => onFilterChange({ ...filters, tails: e.target.value ? [e.target.value] : [] })} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-600">
        <option value="">Tüm Uçaklar</option>
        {tails.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <select value={filters.airport} onChange={e => onFilterChange({ ...filters, airport: e.target.value })} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-600">
        <option value="">Tüm Havalimanları</option>
        {airports.map(a => <option key={a} value={a}>{a}</option>)}
      </select>

      {dateRange && (
        <>
          <input type="date" value={filters.dateRange?.[0] || dateRange[0]} onChange={e => onFilterChange({ ...filters, dateRange: [e.target.value, filters.dateRange?.[1] || dateRange[1]] })} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 border border-slate-600" />
          <span className="text-slate-500 text-xs">→</span>
          <input type="date" value={filters.dateRange?.[1] || dateRange[1]} onChange={e => onFilterChange({ ...filters, dateRange: [filters.dateRange?.[0] || dateRange[0], e.target.value] })} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 border border-slate-600" />
        </>
      )}

      {hasFilters && (
        <button onClick={resetFilters} className="flex items-center gap-1 px-2 py-1 bg-red-500/10 text-red-400 text-xs rounded-lg border border-red-500/20 hover:bg-red-500/20 transition-colors">
          <X className="w-3 h-3" /> Temizle
        </button>
      )}
    </div>
  );
}
