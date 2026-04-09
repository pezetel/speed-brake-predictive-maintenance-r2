'use client';

import React, { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FlightRecord } from '@/lib/types';
import { buildFlightTimeline } from '@/lib/analytics';
import { stratifiedSample } from '@/lib/performance';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';
import { Clock, AlertTriangle, Search, ChevronDown, ChevronUp, Plane, Activity, TrendingDown } from 'lucide-react';

interface Props {
  data: FlightRecord[];
}

const ROW_H = 40;
const MAX_CHART_POINTS = 2000;

export default function FlightTimeline({ data }: Props) {
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [sortField, setSortField] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const parentRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo(() => buildFlightTimeline(data), [data]);

  const filteredTimeline = useMemo(() => {
    let result = [...timeline];
    if (filterLevel !== 'ALL') result = result.filter(t => t.anomalyLevel === filterLevel);
    if (selectedDate) result = result.filter(t => t.date === selectedDate);
    if (search) {
      const q = search.toUpperCase();
      result = result.filter(t =>
        t.tailNumber.includes(q) || t.route.includes(q) || t.date.includes(q)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date': cmp = a.date.localeCompare(b.date); break;
        case 'tail': cmp = a.tailNumber.localeCompare(b.tailNumber); break;
        case 'pfd': cmp = a.pfd - b.pfd; break;
        case 'deg': cmp = a.deg - b.deg; break;
        case 'durationRatio': cmp = a.durationRatio - b.durationRatio; break;
        case 'landing30': cmp = a.landingDist30 - b.landingDist30; break;
        default: cmp = a.date.localeCompare(b.date);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [timeline, filterLevel, selectedDate, search, sortField, sortDir]);

  // Virtualized table
  const virtualizer = useVirtualizer({
    count: filteredTimeline.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 30,
  });

  // Daily stats — cheap aggregation
  const dailyStats = useMemo(() => {
    const dateMap = new Map<string, { date: string; total: number; critical: number; warning: number; normal: number; pfdSum: number; avgPfd: number }>();
    timeline.forEach(t => {
      let d = dateMap.get(t.date);
      if (!d) { d = { date: t.date, total: 0, critical: 0, warning: 0, normal: 0, pfdSum: 0, avgPfd: 0 }; dateMap.set(t.date, d); }
      d.total++;
      d[t.anomalyLevel]++;
      if (t.pfd > 0 && t.pfd <= 105) d.pfdSum += t.pfd;
    });
    return Array.from(dateMap.values())
      .map(d => ({ ...d, avgPfd: d.total > 0 ? d.pfdSum / d.total : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [timeline]);

  // Sampled scatter
  const durationScatter = useMemo(() => {
    const filtered = data.filter(t => t.durationRatio > 0 && t.durationRatio < 50 && t.normalizedPfd > 0 && t.normalizedPfd <= 105);
    const sampled = stratifiedSample(filtered, MAX_CHART_POINTS);
    return sampled.map(t => ({
      x: t.normalizedPfd,
      y: t.durationRatio,
      tail: t.tailNumber,
      route: `${t.takeoffAirport}→${t.landingAirport}`,
      date: t.flightDate,
      anomaly: t.anomalyLevel,
    }));
  }, [data]);

  const dates = useMemo(() => {
    const set = new Set(timeline.map(t => t.date));
    return Array.from(set).sort();
  }, [timeline]);

  const totalFlights = timeline.length;
  const criticalFlights = timeline.filter(t => t.anomalyLevel === 'critical').length;
  const warningFlights = timeline.filter(t => t.anomalyLevel === 'warning').length;
  const avgPfd = (() => { const v = timeline.filter(t => t.pfd > 0 && t.pfd <= 105); return v.length > 0 ? v.reduce((s, t) => s + t.pfd, 0) / v.length : 0; })();

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card border-blue-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase tracking-wider">Toplam Uçuş</span><Clock className="w-4 h-4 text-blue-400" /></div>
          <div className="text-2xl font-bold text-blue-400">{totalFlights.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500">{dates.length} farklı gün</div>
        </div>
        <div className="card border-red-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase tracking-wider">Kritik</span><AlertTriangle className="w-4 h-4 text-red-400" /></div>
          <div className="text-2xl font-bold text-red-400">{criticalFlights.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500">{(criticalFlights / Math.max(totalFlights, 1) * 100).toFixed(1)}%</div>
        </div>
        <div className="card border-amber-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase tracking-wider">Uyarı</span><Activity className="w-4 h-4 text-amber-400" /></div>
          <div className="text-2xl font-bold text-amber-400">{warningFlights.toLocaleString()}</div>
          <div className="text-[10px] text-slate-500">{(warningFlights / Math.max(totalFlights, 1) * 100).toFixed(1)}%</div>
        </div>
        <div className="card border-cyan-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase tracking-wider">Ort. PFD</span><Plane className="w-4 h-4 text-cyan-400" /></div>
          <div className="text-2xl font-bold text-cyan-400">{avgPfd.toFixed(1)}%</div>
          <div className="text-[10px] text-slate-500">Normalize edilmiş</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header flex items-center gap-2"><Clock className="w-4 h-4 text-blue-400" />Günlük Uçuş & Anomali</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyStats} margin={{ top: 10, right: 10, bottom: 30, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '11px' }} />
                <Bar dataKey="critical" stackId="a" fill="#ef4444" name="Kritik" />
                <Bar dataKey="warning" stackId="a" fill="#f59e0b" name="Uyarı" />
                <Bar dataKey="normal" stackId="a" fill="#22c55e" name="Normal" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-header flex items-center gap-2"><TrendingDown className="w-4 h-4 text-purple-400" />PFD vs Süre Oranı</div>
          <p className="text-[10px] text-slate-500 mb-2">Sağ alt köşe: Düşük PFD + yüksek süre → ciddi problem</p>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="x" type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'PFD (%)', position: 'bottom', fill: '#94a3b8', fontSize: 10, dy: 20 }} />
                <YAxis dataKey="y" type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'Süre Oranı', angle: -90, position: 'left', fill: '#94a3b8', fontSize: 10, dx: -10 }} />
                <ZAxis range={[20, 50]} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '11px' }} />
                <ReferenceLine y={2} stroke="#f59e0b" strokeDasharray="5 5" />
                <ReferenceLine y={4} stroke="#ef4444" strokeDasharray="5 5" />
                <Scatter data={durationScatter.filter(d => d.anomaly === 'normal')} fill="#22c55e" fillOpacity={0.4} />
                <Scatter data={durationScatter.filter(d => d.anomaly === 'warning')} fill="#f59e0b" fillOpacity={0.6} />
                <Scatter data={durationScatter.filter(d => d.anomaly === 'critical')} fill="#ef4444" fillOpacity={0.8} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Daily PFD trend */}
      <div className="card">
        <div className="card-header flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" />Günlük Ort. PFD Trendi</div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyStats} margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '11px' }} />
              <ReferenceLine y={100} stroke="#22c55e" strokeDasharray="5 5" />
              <ReferenceLine y={95} stroke="#f59e0b" strokeDasharray="5 5" />
              <Line type="monotone" dataKey="avgPfd" stroke="#06b6d4" strokeWidth={2} dot={false} name="Ort. PFD" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Virtualized Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="card-header mb-0 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" />
            Uçuş Zaman Çizelgesi
            <span className="badge-info">{filteredTimeline.length.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-600">
              <option value="ALL">Tüm Seviyeler</option>
              <option value="critical">🔴 Kritik</option>
              <option value="warning">🟡 Uyarı</option>
              <option value="normal">🟢 Normal</option>
            </select>
            <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-600">
              <option value="">Tüm Tarihler</option>
              {dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="text" placeholder="Ara..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 pr-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-200 w-44 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        </div>

        <div ref={parentRef} className="overflow-auto" style={{ maxHeight: '60vh' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-800">
              <tr className="border-b border-slate-700">
                {[
                  { f: 'date', l: 'Tarih' }, { f: 'tail', l: 'Kuyruk' }, { f: '', l: 'Rota' },
                  { f: 'pfd', l: 'PFD%' }, { f: 'deg', l: 'Açı°' }, { f: 'durationRatio', l: 'Süre Oranı' },
                  { f: 'landing30', l: 'İniş 30kn' }, { f: '', l: 'İniş 50kn' }, { f: '', l: 'Seviye' },
                ].map((c, ci) => (
                  <th key={ci} onClick={() => c.f && toggleSort(c.f)} className={`px-2 py-2 text-left text-slate-400 font-medium ${c.f ? 'cursor-pointer hover:text-slate-200' : ''} select-none`}>
                    <div className="flex items-center gap-1">{c.l}{c.f && <SortIcon field={c.f} />}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {virtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}><td colSpan={9} /></tr>
              )}
              {virtualizer.getVirtualItems().map(vRow => {
                const row = filteredTimeline[vRow.index];
                const landingAnomaly = row.landingDist50 > row.landingDist30 * 1.05 && row.landingDist30 > 0;
                return (
                  <tr
                    key={vRow.index}
                    className={`border-b border-slate-700/30 hover:bg-slate-700/20 cursor-pointer transition-colors ${
                      row.anomalyLevel === 'critical' ? 'bg-red-500/5' : row.anomalyLevel === 'warning' ? 'bg-amber-500/5' : ''
                    }`}
                    style={{ height: ROW_H }}
                    onClick={() => setExpandedRow(expandedRow === vRow.index ? null : vRow.index)}
                  >
                    <td className="px-2 py-1 text-slate-300">{row.date}</td>
                    <td className="px-2 py-1 font-mono font-bold text-white">{row.tailNumber}</td>
                    <td className="px-2 py-1 text-slate-300">{row.route}</td>
                    <td className={`px-2 py-1 font-mono font-bold ${row.pfd < 80 ? 'text-red-400' : row.pfd < 95 ? 'text-amber-400' : 'text-slate-200'}`}>{row.pfd.toFixed(1)}</td>
                    <td className={`px-2 py-1 font-mono ${row.deg < 30 ? 'text-red-400' : row.deg < 40 ? 'text-amber-400' : 'text-slate-300'}`}>{row.deg.toFixed(1)}</td>
                    <td className={`px-2 py-1 font-mono ${row.durationRatio > 4 ? 'text-red-400 font-bold' : row.durationRatio > 2 ? 'text-amber-400' : 'text-slate-300'}`}>{row.durationRatio > 0 ? row.durationRatio.toFixed(2) + 'x' : '—'}</td>
                    <td className="px-2 py-1 font-mono text-slate-300">{row.landingDist30 > 0 ? row.landingDist30.toFixed(0) : '—'}</td>
                    <td className={`px-2 py-1 font-mono ${landingAnomaly ? 'text-red-400 font-bold' : 'text-slate-300'}`}>{row.landingDist50 > 0 ? row.landingDist50.toFixed(0) : '—'}{landingAnomaly && ' 🔴'}</td>
                    <td className="px-2 py-1 text-center">
                      {row.anomalyLevel === 'critical' ? <span className="badge-danger text-[10px]">Kritik</span> : row.anomalyLevel === 'warning' ? <span className="badge-warning text-[10px]">Uyarı</span> : <span className="badge-success text-[10px]">Normal</span>}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0) }}><td colSpan={9} /></tr>
            </tbody>
          </table>
        </div>

        {filteredTimeline.length === 0 && (
          <div className="text-center py-10 text-slate-500 text-sm"><Clock className="w-8 h-8 mx-auto mb-2 text-slate-600" />Filtrelere uygun kayıt bulunamadı.</div>
        )}
      </div>
    </div>
  );
}
