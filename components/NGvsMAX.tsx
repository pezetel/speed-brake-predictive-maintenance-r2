'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { FlightRecord } from '@/lib/types';
import { numericFields, getFieldLabel } from '@/lib/utils';
import { quickStats } from '@/lib/performance';

interface Props {
  data: FlightRecord[];
}

export default function NGvsMAX({ data }: Props) {
  const ngData = useMemo(() => data.filter(d => d.aircraftType === 'NG'), [data]);
  const maxData = useMemo(() => data.filter(d => d.aircraftType === 'MAX'), [data]);

  const comparisonData = useMemo(() => {
    return numericFields.map(field => {
      const ngVals = ngData.map(d => d[field as keyof FlightRecord] as number).filter(v => v > 0 && v < 100000);
      const maxVals = maxData.map(d => d[field as keyof FlightRecord] as number).filter(v => v > 0 && v < 100000);
      const ngS = quickStats(ngVals);
      const maxS = quickStats(maxVals);
      return {
        field: getFieldLabel(field), fieldKey: field,
        NG_mean: ngS.mean, MAX_mean: maxS.mean,
        NG_std: ngS.std, MAX_std: maxS.std,
        NG_min: ngS.min, MAX_min: maxS.min,
        NG_max: ngS.max, MAX_max: maxS.max,
        NG_count: ngS.count, MAX_count: maxS.count,
      };
    });
  }, [ngData, maxData]);

  const anomalyComparison = useMemo(() => {
    const ngA = ngData.filter(d => d.anomalyLevel !== 'normal').length;
    const maxA = maxData.filter(d => d.anomalyLevel !== 'normal').length;
    return [
      { category: 'Toplam Uçuş', NG: ngData.length, MAX: maxData.length },
      { category: 'Anomali Sayısı', NG: ngA, MAX: maxA },
      { category: 'Kritik', NG: ngData.filter(d => d.anomalyLevel === 'critical').length, MAX: maxData.filter(d => d.anomalyLevel === 'critical').length },
      { category: 'Anomali %', NG: ngData.length > 0 ? +(ngA / ngData.length * 100).toFixed(1) : 0, MAX: maxData.length > 0 ? +(maxA / maxData.length * 100).toFixed(1) : 0 },
    ];
  }, [ngData, maxData]);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card border-blue-500/20">
          <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-blue-500/20 rounded-lg"><span className="text-blue-400 font-bold text-lg">NG</span></div><div><h3 className="text-white font-bold">B737 NG</h3><p className="text-xs text-slate-400">{ngData.length.toLocaleString()} uçuş · {new Set(ngData.map(d => d.tailNumber)).size} uçak</p></div></div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-700/50 rounded-lg p-2"><div className="text-lg font-bold text-red-400">{ngData.filter(d => d.anomalyLevel === 'critical').length}</div><div className="text-[10px] text-slate-400">Kritik</div></div>
            <div className="bg-slate-700/50 rounded-lg p-2"><div className="text-lg font-bold text-amber-400">{ngData.filter(d => d.anomalyLevel === 'warning').length}</div><div className="text-[10px] text-slate-400">Uyarı</div></div>
            <div className="bg-slate-700/50 rounded-lg p-2"><div className="text-lg font-bold text-emerald-400">{ngData.filter(d => d.anomalyLevel === 'normal').length}</div><div className="text-[10px] text-slate-400">Normal</div></div>
          </div>
        </div>
        <div className="card border-purple-500/20">
          <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-purple-500/20 rounded-lg"><span className="text-purple-400 font-bold text-lg">MAX</span></div><div><h3 className="text-white font-bold">B737 MAX</h3><p className="text-xs text-slate-400">{maxData.length.toLocaleString()} uçuş · {new Set(maxData.map(d => d.tailNumber)).size} uçak</p></div></div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-700/50 rounded-lg p-2"><div className="text-lg font-bold text-red-400">{maxData.filter(d => d.anomalyLevel === 'critical').length}</div><div className="text-[10px] text-slate-400">Kritik</div></div>
            <div className="bg-slate-700/50 rounded-lg p-2"><div className="text-lg font-bold text-amber-400">{maxData.filter(d => d.anomalyLevel === 'warning').length}</div><div className="text-[10px] text-slate-400">Uyarı</div></div>
            <div className="bg-slate-700/50 rounded-lg p-2"><div className="text-lg font-bold text-emerald-400">{maxData.filter(d => d.anomalyLevel === 'normal').length}</div><div className="text-[10px] text-slate-400">Normal</div></div>
          </div>
        </div>
      </div>

      {/* Anomaly comparison */}
      <div className="card">
        <div className="card-header">NG vs MAX Anomali Karşılaştırması</div>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={anomalyComparison} margin={{ top: 10, right: 30, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '12px' }} />
              <Legend />
              <Bar dataKey="NG" fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="MAX" fill="#a855f7" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stats table */}
      <div className="card">
        <div className="card-header">Parametrik Karşılaştırma (Ort ± Std)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="px-3 py-2 text-left text-slate-400">Parametre</th>
                <th className="px-3 py-2 text-center text-blue-400">NG Ort ± Std</th>
                <th className="px-3 py-2 text-center text-blue-400">Min-Max</th>
                <th className="px-3 py-2 text-center text-purple-400">MAX Ort ± Std</th>
                <th className="px-3 py-2 text-center text-purple-400">Min-Max</th>
                <th className="px-3 py-2 text-center text-slate-400">Fark (%)</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.map((row, i) => {
                const diff = row.NG_mean > 0 ? ((row.MAX_mean - row.NG_mean) / row.NG_mean * 100) : 0;
                return (
                  <tr key={i} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                    <td className="px-3 py-2 text-slate-300 font-medium">{row.field}</td>
                    <td className="px-3 py-2 text-center text-blue-300 font-mono">{row.NG_mean.toFixed(2)} ± {row.NG_std.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center text-slate-500 font-mono text-[10px]">{row.NG_min.toFixed(1)} – {row.NG_max.toFixed(1)}</td>
                    <td className="px-3 py-2 text-center text-purple-300 font-mono">{row.MAX_mean.toFixed(2)} ± {row.MAX_std.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center text-slate-500 font-mono text-[10px]">{row.MAX_min.toFixed(1)} – {row.MAX_max.toFixed(1)}</td>
                    <td className={`px-3 py-2 text-center font-mono font-bold ${Math.abs(diff) > 10 ? 'text-amber-400' : 'text-slate-400'}`}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mean comparison bar chart */}
      <div className="card">
        <div className="card-header">Ortalama Değer Karşılaştırması</div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparisonData.filter(d => !['landingDist30kn', 'landingDist50kn', 'gsAtAutoSbop'].includes(d.fieldKey))} margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="field" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '12px' }} />
              <Legend />
              <Bar dataKey="NG_mean" name="NG Ort." fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="MAX_mean" name="MAX Ort." fill="#a855f7" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
