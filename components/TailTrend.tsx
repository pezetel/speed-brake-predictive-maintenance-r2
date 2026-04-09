'use client';

import { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ReferenceLine } from 'recharts';
import { FlightRecord } from '@/lib/types';
import { getFieldLabel, numericFields } from '@/lib/utils';
import { downsample } from '@/lib/performance';

interface Props {
  data: FlightRecord[];
}

const MAX_TREND_POINTS = 500;
const MAX_BAR_TAILS = 30;

export default function TailTrend({ data }: Props) {
  const allTails = useMemo(() => Array.from(new Set(data.map(d => d.tailNumber))).sort(), [data]);

  const problematicTails = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(d => { if (d.anomalyLevel !== 'normal') counts[d.tailNumber] = (counts[d.tailNumber] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  }, [data]);

  const [selectedTail, setSelectedTail] = useState<string>(problematicTails[0] || allTails[0] || '');
  const [metric, setMetric] = useState<string>('pfdTurn1');

  const tailData = useMemo(() => {
    const flights = data
      .filter(d => d.tailNumber === selectedTail)
      .sort((a, b) => a.flightDate.localeCompare(b.flightDate) || a.gsAtAutoSbop - b.gsAtAutoSbop)
      .map((d, i) => ({
        index: i + 1,
        date: d.flightDate,
        route: `${d.takeoffAirport}→${d.landingAirport}`,
        value: d[metric as keyof FlightRecord] as number,
        anomaly: d.anomalyLevel,
      }));
    return downsample(flights, MAX_TREND_POINTS);
  }, [data, selectedTail, metric]);

  const tailAnomalyCounts = useMemo(() => {
    const counts: Record<string, { normal: number; warning: number; critical: number; total: number }> = {};
    data.forEach(d => {
      if (!counts[d.tailNumber]) counts[d.tailNumber] = { normal: 0, warning: 0, critical: 0, total: 0 };
      counts[d.tailNumber][d.anomalyLevel]++;
      counts[d.tailNumber].total++;
    });
    return Object.entries(counts)
      .map(([tail, c]) => ({ tail, ...c }))
      .sort((a, b) => (b.critical + b.warning) - (a.critical + a.warning))
      .slice(0, MAX_BAR_TAILS);
  }, [data]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl">
        <p className="font-bold text-white">{d.route}</p>
        <p className="text-slate-400">{d.date} · #{d.index}</p>
        <p className="text-blue-400 mt-1">{getFieldLabel(metric)}: {typeof d.value === 'number' ? d.value.toFixed(2) : d.value}</p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">Uçak Bazlı Anomali Dağılımı (Top {MAX_BAR_TAILS})</div>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tailAnomalyCounts} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="tail" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '11px' }} />
              <Bar dataKey="critical" stackId="a" fill="#ef4444" name="Kritik" isAnimationActive={false} />
              <Bar dataKey="warning" stackId="a" fill="#f59e0b" name="Uyarı" isAnimationActive={false} />
              <Bar dataKey="normal" stackId="a" fill="#22c55e" name="Normal" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Uçak Trend Analizi</div>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Uçak:</label>
            <select value={selectedTail} onChange={e => setSelectedTail(e.target.value)} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 border border-slate-600 max-w-[160px]">
              {problematicTails.length > 0 && (
                <optgroup label="⚠️ Problemli">
                  {problematicTails.map(t => <option key={t} value={t}>{t}</option>)}
                </optgroup>
              )}
              <optgroup label="Tüm Uçaklar">
                {allTails.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Metrik:</label>
            <select value={metric} onChange={e => setMetric(e.target.value)} className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 border border-slate-600">
              {numericFields.map(f => <option key={f} value={f}>{getFieldLabel(f)}</option>)}
            </select>
          </div>
        </div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-bold text-white">{selectedTail}</span>
          <span className="badge-info">{tailData.length} nokta{data.filter(d => d.tailNumber === selectedTail).length > MAX_TREND_POINTS ? ' (örneklenmiş)' : ''}</span>
        </div>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={tailData} margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="index" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'Uçuş Sırası', position: 'bottom', fill: '#94a3b8', fontSize: 11, dy: 15 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              {metric === 'pfdTurn1' && (
                <>
                  <ReferenceLine y={100} stroke="#22c55e" strokeDasharray="5 5" />
                  <ReferenceLine y={95} stroke="#f59e0b" strokeDasharray="5 5" />
                  <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="5 5" />
                </>
              )}
              <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
