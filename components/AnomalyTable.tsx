'use client';

import React, { useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FlightRecord } from '@/lib/types';
import { AlertTriangle, AlertCircle, ChevronDown, ChevronUp, Search } from 'lucide-react';

interface Props {
  data: FlightRecord[];
  maxRows?: number;
}

const ROW_HEIGHT = 44;

export default function AnomalyTable({ data, maxRows }: Props) {
  const [sortField, setSortField] = useState<string>('pfdTurn1');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const parentRef = useRef<HTMLDivElement>(null);

  const anomalies = useMemo(() => {
    let filtered = data.filter(d => d.anomalyLevel !== 'normal');

    if (search) {
      const q = search.toUpperCase();
      filtered = filtered.filter(d =>
        d.tailNumber.includes(q) ||
        d.takeoffAirport.includes(q) ||
        d.landingAirport.includes(q) ||
        d.flightDate.includes(q)
      );
    }

    filtered.sort((a, b) => {
      if (sortField === 'anomalyLevel') {
        const order = { critical: 0, warning: 1, normal: 2 };
        return sortDir === 'asc'
          ? order[a.anomalyLevel] - order[b.anomalyLevel]
          : order[b.anomalyLevel] - order[a.anomalyLevel];
      }
      const aVal = a[sortField as keyof FlightRecord];
      const bVal = b[sortField as keyof FlightRecord];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    return filtered;
  }, [data, search, sortField, sortDir]);

  const displayedRows = maxRows ? anomalies.slice(0, maxRows) : anomalies;
  const useVirtual = !maxRows && displayedRows.length > 100;

  const virtualizer = useVirtualizer({
    count: useVirtual ? displayedRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const columns = [
    { key: 'anomalyLevel', label: 'Seviye', w: 'w-20' },
    { key: 'flightDate', label: 'Tarih', w: 'w-24' },
    { key: 'tailNumber', label: 'Kuyruk No', w: 'w-24' },
    { key: 'takeoffAirport', label: 'Rota', w: 'w-28' },
    { key: 'pfdTurn1', label: 'PFD', w: 'w-20' },
    { key: 'pfdTurn1Deg', label: 'PFD°', w: 'w-16' },
    { key: 'pfeTo99Deg', label: 'PFE°', w: 'w-16' },
    { key: 'durationDerivative', label: 'Dur(D)', w: 'w-16' },
    { key: 'durationExtTo99', label: 'Dur(99)', w: 'w-16' },
    { key: 'landingDist30kn', label: 'Dist 30kn', w: 'w-24' },
    { key: 'landingDist50kn', label: 'Dist 50kn', w: 'w-24' },
  ];

  const renderRow = (row: FlightRecord, i: number) => (
    <tr
      key={i}
      className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
        row.anomalyLevel === 'critical' ? 'bg-red-500/5' : ''
      }`}
      style={useVirtual ? { height: ROW_HEIGHT } : undefined}
    >
      <td className="px-2 py-2">
        {row.anomalyLevel === 'critical' ? (
          <span className="badge-danger flex items-center gap-1 w-fit">
            <AlertTriangle className="w-3 h-3" /> Kritik
          </span>
        ) : (
          <span className="badge-warning flex items-center gap-1 w-fit">
            <AlertCircle className="w-3 h-3" /> Uyarı
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-slate-300">{row.flightDate}</td>
      <td className="px-2 py-2 font-mono font-bold text-white">{row.tailNumber}</td>
      <td className="px-2 py-2 text-slate-300">{row.takeoffAirport}→{row.landingAirport}</td>
      <td className={`px-2 py-2 font-mono font-bold ${
        row.pfdTurn1 < 80 ? 'text-red-400' : row.pfdTurn1 < 95 ? 'text-amber-400' : 'text-slate-200'
      }`}>
        {row.pfdTurn1.toFixed(1)}
      </td>
      <td className="px-2 py-2 text-slate-300">{row.pfdTurn1Deg.toFixed(1)}</td>
      <td className="px-2 py-2 text-slate-300">{row.pfeTo99Deg.toFixed(1)}</td>
      <td className="px-2 py-2 text-slate-300">{row.durationDerivative.toFixed(2)}</td>
      <td className={`px-2 py-2 font-mono ${
        row.durationExtTo99 > 5 ? 'text-red-400 font-bold' : row.durationExtTo99 > 3 ? 'text-amber-400' : 'text-slate-300'
      }`}>
        {row.durationExtTo99.toFixed(2)}
      </td>
      <td className="px-2 py-2 text-slate-300">{row.landingDist30kn.toFixed(0)}</td>
      <td className="px-2 py-2 text-slate-300">{row.landingDist50kn.toFixed(0)}</td>
    </tr>
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="card-header mb-0 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          Anomali Listesi
          <span className="badge-danger">{anomalies.length.toLocaleString()}</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Ara... (tail, airport, tarih)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-200 w-48 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div
        ref={parentRef}
        className="overflow-x-auto"
        style={useVirtual ? { maxHeight: '70vh', overflowY: 'auto' } : undefined}
      >
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-slate-800">
            <tr className="border-b border-slate-700">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`${col.w} px-2 py-2 text-left text-slate-400 font-medium cursor-pointer hover:text-slate-200 select-none`}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    <SortIcon field={col.key} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {useVirtual ? (
              <>
                {/* spacer top */}
                {virtualizer.getVirtualItems().length > 0 && (
                  <tr style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                    <td colSpan={columns.length} />
                  </tr>
                )}
                {virtualizer.getVirtualItems().map(vRow => {
                  const row = displayedRows[vRow.index];
                  return renderRow(row, vRow.index);
                })}
                {/* spacer bottom */}
                <tr style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0) }}>
                  <td colSpan={columns.length} />
                </tr>
              </>
            ) : (
              displayedRows.map((row, i) => renderRow(row, i))
            )}
          </tbody>
        </table>
      </div>

      {anomalies.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">
          Filtrelere uygun anomali bulunamadı
        </div>
      )}
    </div>
  );
}
