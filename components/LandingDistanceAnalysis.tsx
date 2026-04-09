'use client';

import React, { useMemo, useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FlightRecord } from '@/lib/types';
import { analyzeLandingDistances } from '@/lib/analytics';
import { stratifiedSample } from '@/lib/performance';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis, BarChart, Bar, Cell } from 'recharts';
import { Ruler, AlertTriangle, TrendingUp, Search } from 'lucide-react';

interface Props {
  data: FlightRecord[];
}

const MAX_SCATTER = 2000;
const ROW_H = 36;

export default function LandingDistanceAnalysisView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const parentRef = useRef<HTMLDivElement>(null);

  const analysis = useMemo(() => analyzeLandingDistances(data), [data]);

  const filteredAnalysis = useMemo(() => {
    let result = [...analysis];
    if (filterType !== 'ALL') result = result.filter(a => a.anomalyType === filterType);
    if (search) {
      const q = search.toUpperCase();
      result = result.filter(a => a.tailNumber.includes(q) || a.route.includes(q) || a.date.includes(q));
    }
    return result;
  }, [analysis, filterType, search]);

  const virtualizer = useVirtualizer({
    count: filteredAnalysis.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 25,
  });

  // Sampled scatter data
  const scatterData = useMemo(() => {
    const valid = data.filter(d => d.landingDist30kn > 0 && d.landingDist50kn > 0 && d.landingDist30kn < 5000 && d.landingDist50kn < 5000);
    const sampled = stratifiedSample(valid, MAX_SCATTER);
    return sampled.map(d => ({
      x: d.landingDist30kn, y: d.landingDist50kn, tail: d.tailNumber,
      route: `${d.takeoffAirport}→${d.landingAirport}`, date: d.flightDate,
      pfd: d.normalizedPfd, isAnomaly: d.landingDist50kn > d.landingDist30kn * 1.05, type: d.aircraftType,
    }));
  }, [data]);

  const pfdVsLanding = useMemo(() => {
    const valid = data.filter(d => d.normalizedPfd > 0 && d.normalizedPfd <= 105 && d.landingDist30kn > 0 && d.landingDist30kn < 5000);
    const sampled = stratifiedSample(valid, MAX_SCATTER);
    return sampled.map(d => ({
      x: d.normalizedPfd, y: d.landingDist30kn, tail: d.tailNumber,
      route: `${d.takeoffAirport}→${d.landingAirport}`, date: d.flightDate, anomaly: d.anomalyLevel,
    }));
  }, [data]);

  const anomalyTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    analysis.forEach(a => { counts[a.anomalyType] = (counts[a.anomalyType] || 0) + 1; });
    return [
      { name: 'Normal', count: counts['normal'] || 0, fill: '#22c55e' },
      { name: '50kn > 30kn', count: counts['50kn_exceeds_30kn'] || 0, fill: '#ef4444' },
      { name: 'Aşırı Mesafe', count: counts['excessive_distance'] || 0, fill: '#f59e0b' },
      { name: 'PFD Korelasyon', count: counts['pfd_correlation'] || 0, fill: '#a855f7' },
    ].filter(c => c.count > 0);
  }, [analysis]);

  const totalAnomalies = analysis.filter(a => a.anomalyType !== 'normal').length;
  const critical5050 = analysis.filter(a => a.anomalyType === '50kn_exceeds_30kn').length;

  const ScatterTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl">
        <p className="font-bold text-white">{d.tail}</p>
        <p className="text-slate-400">{d.date} · {d.route}</p>
        <p className="text-blue-400">30kn: {d.x?.toFixed(0)}m</p>
        <p className="text-cyan-400">50kn: {d.y?.toFixed(0)}m</p>
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card border-blue-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase">Toplam Kayıt</span><Ruler className="w-4 h-4 text-blue-400" /></div>
          <div className="text-2xl font-bold text-blue-400">{analysis.length.toLocaleString()}</div>
        </div>
        <div className="card border-red-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase">Mesafe Anomalisi</span><AlertTriangle className="w-4 h-4 text-red-400" /></div>
          <div className="text-2xl font-bold text-red-400">{totalAnomalies.toLocaleString()}</div>
        </div>
        <div className="card border-orange-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase">50kn &gt; 30kn</span><AlertTriangle className="w-4 h-4 text-orange-400" /></div>
          <div className="text-2xl font-bold text-orange-400">{critical5050.toLocaleString()}</div>
        </div>
        <div className="card border-emerald-500/20">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] text-slate-400 uppercase">Ort. 30kn</span><TrendingUp className="w-4 h-4 text-emerald-400" /></div>
          <div className="text-2xl font-bold text-emerald-400">{analysis.length > 0 ? (analysis.reduce((s, a) => s + a.dist30kn, 0) / analysis.length).toFixed(0) : 0}m</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header">İniş Mesafesi: 30kn vs 50kn</div>
          <p className="text-[10px] text-slate-500 mb-3">Çapraz çizginin üstü anomali (50kn &gt; 30kn)</p>
          <div className="h-[330px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="x" type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: '30kn (m)', position: 'bottom', fill: '#94a3b8', fontSize: 10, dy: 20 }} />
                <YAxis dataKey="y" type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: '50kn (m)', angle: -90, position: 'left', fill: '#94a3b8', fontSize: 10, dx: -10 }} />
                <ZAxis range={[20, 50]} />
                <Tooltip content={<ScatterTooltip />} />
                <ReferenceLine segment={[{ x: 500, y: 500 }, { x: 3500, y: 3500 }]} stroke="#f59e0b" strokeDasharray="5 5" />
                <Scatter data={scatterData.filter(d => !d.isAnomaly)} fill="#22c55e" fillOpacity={0.4} isAnimationActive={false} />
                <Scatter data={scatterData.filter(d => d.isAnomaly)} fill="#ef4444" fillOpacity={0.8} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-header">PFD vs İniş Mesafesi (30kn)</div>
          <div className="h-[330px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="x" type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'PFD (%)', position: 'bottom', fill: '#94a3b8', fontSize: 10, dy: 20 }} />
                <YAxis dataKey="y" type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: '30kn (m)', angle: -90, position: 'left', fill: '#94a3b8', fontSize: 10, dx: -10 }} />
                <ZAxis range={[20, 50]} />
                <Tooltip content={<ScatterTooltip />} />
                <ReferenceLine x={95} stroke="#f59e0b" strokeDasharray="5 5" />
                <ReferenceLine x={80} stroke="#ef4444" strokeDasharray="5 5" />
                <Scatter data={pfdVsLanding.filter(d => d.anomaly === 'normal')} fill="#22c55e" fillOpacity={0.4} isAnimationActive={false} />
                <Scatter data={pfdVsLanding.filter(d => d.anomaly === 'warning')} fill="#f59e0b" fillOpacity={0.6} isAnimationActive={false} />
                <Scatter data={pfdVsLanding.filter(d => d.anomaly === 'critical')} fill="#ef4444" fillOpacity={0.8} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Anomaly Type Bar */}
      <div className="card">
        <div className="card-header">Anomali Tipi Dağılımı</div>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={anomalyTypeCounts} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '12px' }} />
              <Bar dataKey="count" name="Kayıt" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {anomalyTypeCounts.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Virtualized Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="card-header mb-0 flex items-center gap-2">
            <Ruler className="w-4 h-4 text-blue-400" /> İniş Mesafesi Detay
            <span className="badge-info">{filteredAnalysis.length.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 border border-slate-600">
              <option value="ALL">Tüm Tipler</option>
              <option value="50kn_exceeds_30kn">🔴 50kn &gt; 30kn</option>
              <option value="excessive_distance">🟡 Aşırı Mesafe</option>
              <option value="pfd_correlation">🟣 PFD Korelasyon</option>
              <option value="normal">🟢 Normal</option>
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="text" placeholder="Ara..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 pr-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-200 w-40 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
        </div>
        <div ref={parentRef} className="overflow-auto" style={{ maxHeight: '55vh' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-800">
              <tr className="border-b border-slate-700">
                <th className="px-2 py-2 text-left text-slate-400">Risk</th>
                <th className="px-2 py-2 text-left text-slate-400">Tarih</th>
                <th className="px-2 py-2 text-left text-slate-400">Kuyruk</th>
                <th className="px-2 py-2 text-left text-slate-400">Rota</th>
                <th className="px-2 py-2 text-right text-slate-400">30kn</th>
                <th className="px-2 py-2 text-right text-slate-400">50kn</th>
                <th className="px-2 py-2 text-right text-slate-400">PFD%</th>
                <th className="px-2 py-2 text-left text-slate-400">Tip</th>
              </tr>
            </thead>
            <tbody>
              {virtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}><td colSpan={8} /></tr>
              )}
              {virtualizer.getVirtualItems().map(vRow => {
                const row = filteredAnalysis[vRow.index];
                return (
                  <tr key={vRow.index} className={`border-b border-slate-700/30 hover:bg-slate-700/20 ${row.riskScore > 40 ? 'bg-red-500/5' : ''}`} style={{ height: ROW_H }}>
                    <td className="px-2 py-1"><div className="flex items-center gap-1"><div className="w-8 h-2 rounded-full overflow-hidden bg-slate-700"><div className={`h-full rounded-full ${row.riskScore > 60 ? 'bg-red-500' : row.riskScore > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${row.riskScore}%` }} /></div><span className="text-[10px] text-slate-500 font-mono">{row.riskScore}</span></div></td>
                    <td className="px-2 py-1 text-slate-300">{row.date}</td>
                    <td className="px-2 py-1 font-mono font-bold text-white">{row.tailNumber}</td>
                    <td className="px-2 py-1 text-slate-300">{row.route}</td>
                    <td className="px-2 py-1 text-right font-mono text-slate-200">{row.dist30kn.toFixed(0)}</td>
                    <td className={`px-2 py-1 text-right font-mono ${row.anomalyType === '50kn_exceeds_30kn' ? 'text-red-400 font-bold' : 'text-slate-200'}`}>{row.dist50kn.toFixed(0)}</td>
                    <td className={`px-2 py-1 text-right font-mono ${row.pfd < 80 ? 'text-red-400' : row.pfd < 95 ? 'text-amber-400' : 'text-slate-200'}`}>{row.pfd.toFixed(1)}</td>
                    <td className="px-2 py-1">
                      {row.anomalyType === 'normal' ? <span className="badge-success text-[10px]">Normal</span> :
                       row.anomalyType === '50kn_exceeds_30kn' ? <span className="badge-danger text-[10px]">50&gt;30</span> :
                       row.anomalyType === 'excessive_distance' ? <span className="badge-warning text-[10px]">Aşırı</span> :
                       <span className="text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full">PFD</span>}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0) }}><td colSpan={8} /></tr>
            </tbody>
          </table>
        </div>
        {filteredAnalysis.length === 0 && <div className="text-center py-8 text-slate-500 text-sm">Filtrelere uygun kayıt yok</div>}
      </div>
    </div>
  );
}
