'use client';

import { useState, useMemo } from 'react';
import { TailHealthScore, FlightRecord } from '@/lib/types';
import { Heart, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  healthScores: TailHealthScore[];
  data: FlightRecord[];
}

const MAX_TREND = 300;

function downsample(arr: FlightRecord[], max: number): FlightRecord[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const result: FlightRecord[] = [];
  for (let i = 0; i < max; i++) result.push(arr[Math.floor(i * step)]);
  return result;
}

function riskColor(risk: string) {
  switch (risk) {
    case 'LOW': return 'text-emerald-400';
    case 'MEDIUM': return 'text-amber-400';
    case 'HIGH': return 'text-orange-400';
    case 'CRITICAL': return 'text-red-400';
    default: return 'text-slate-400';
  }
}

function riskBg(risk: string) {
  switch (risk) {
    case 'LOW': return 'bg-emerald-500/10 border-emerald-500/20';
    case 'MEDIUM': return 'bg-amber-500/10 border-amber-500/20';
    case 'HIGH': return 'bg-orange-500/10 border-orange-500/20';
    case 'CRITICAL': return 'bg-red-500/10 border-red-500/20';
    default: return 'bg-slate-500/10 border-slate-500/20';
  }
}

const riskLabel: Record<string, string> = { LOW: 'Düşük', MEDIUM: 'Orta', HIGH: 'Yüksek', CRITICAL: 'Kritik' };
const trendIcon: Record<string, React.ReactNode> = {
  improving: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
  stable: <Minus className="w-3.5 h-3.5 text-slate-400" />,
  degrading: <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
};

export default function TailHealthMatrix({ healthScores, data }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'score' | 'tail' | 'flights'>('score');

  const sorted = useMemo(() => {
    const s = [...healthScores];
    if (sortBy === 'score') s.sort((a, b) => a.healthScore - b.healthScore);
    else if (sortBy === 'tail') s.sort((a, b) => a.tailNumber.localeCompare(b.tailNumber));
    else s.sort((a, b) => b.totalFlights - a.totalFlights);
    return s;
  }, [healthScores, sortBy]);

  const trendData = useMemo(() => {
    if (!expanded) return [];
    const flights = data.filter(d => d.tailNumber === expanded).sort((a, b) => a.flightDate.localeCompare(b.flightDate));
    const sampled = downsample(flights, MAX_TREND);
    return sampled.map(f => ({ date: f.flightDate, pfd: f.normalizedPfd, deg: f.pfdTurn1Deg, ratio: f.durationRatio }));
  }, [expanded, data]);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(level => {
          const count = healthScores.filter(h => h.riskLevel === level).length;
          return (
            <div key={level} className={`card border ${riskBg(level)}`}>
              <div className="text-[10px] text-slate-400 uppercase">{riskLabel[level]} Risk</div>
              <div className={`text-2xl font-bold ${riskColor(level)}`}>{count}</div>
              <div className="text-[10px] text-slate-500">uçak</div>
            </div>
          );
        })}
      </div>

      {/* Sort */}
      <div className="flex gap-2 items-center">
        <span className="text-xs text-slate-400">Sırala:</span>
        {(['score', 'tail', 'flights'] as const).map(s => (
          <button key={s} onClick={() => setSortBy(s)} className={`text-xs px-2 py-1 rounded-lg border ${sortBy === s ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
            {s === 'score' ? 'Skor' : s === 'tail' ? 'Kuyruk' : 'Uçuş Sayısı'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-left px-2 py-2">Kuyruk</th>
              <th className="text-center px-2 py-2">Skor</th>
              <th className="text-center px-2 py-2">Risk</th>
              <th className="text-center px-2 py-2">Trend</th>
              <th className="text-center px-2 py-2">Uçuş</th>
              <th className="text-center px-2 py-2">PFD</th>
              <th className="text-center px-2 py-2">Açı</th>
              <th className="text-center px-2 py-2">Ratio</th>
              <th className="text-center px-2 py-2">Kritik</th>
              <th className="text-center px-2 py-2">Uyarı</th>
              <th className="text-center px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(h => (
              <>
                <tr key={h.tailNumber} className="border-b border-slate-700/30 hover:bg-slate-700/20 cursor-pointer" onClick={() => setExpanded(expanded === h.tailNumber ? null : h.tailNumber)}>
                  <td className="px-2 py-1.5 font-bold text-white">{h.tailNumber}</td>
                  <td className="px-2 py-1 text-center">
                    <div className="flex items-center gap-1.5 justify-center">
                      <div className="w-12 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${h.healthScore >= 85 ? 'bg-emerald-500' : h.healthScore >= 70 ? 'bg-amber-500' : h.healthScore >= 50 ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${h.healthScore}%` }} />
                      </div>
                      <span className={`font-mono font-bold ${riskColor(h.riskLevel)}`}>{h.healthScore.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${riskBg(h.riskLevel)} ${riskColor(h.riskLevel)}`}>{riskLabel[h.riskLevel]}</span></td>
                  <td className="px-2 py-1 text-center">{trendIcon[h.trend]}</td>
                  <td className="px-2 py-1 text-center text-slate-300">{h.totalFlights}</td>
                  <td className="px-2 py-1 text-center text-slate-300">{h.avgPfd.toFixed(1)}%</td>
                  <td className="px-2 py-1 text-center text-slate-300">{h.avgDeg.toFixed(1)}°</td>
                  <td className="px-2 py-1 text-center text-slate-300">{h.durationRatioAvg.toFixed(2)}x</td>
                  <td className="px-2 py-1 text-center"><span className={h.criticalCount > 0 ? 'text-red-400 font-bold' : 'text-slate-500'}>{h.criticalCount}</span></td>
                  <td className="px-2 py-1 text-center"><span className={h.warningCount > 0 ? 'text-amber-400' : 'text-slate-500'}>{h.warningCount}</span></td>
                  <td className="px-2 py-1 text-center">{expanded === h.tailNumber ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}</td>
                </tr>
                {expanded === h.tailNumber && trendData.length > 0 && (
                  <tr key={`${h.tailNumber}-trend`}>
                    <td colSpan={11} className="p-3 bg-slate-800/50">
                      <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                            <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} />
                            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '11px' }} />
                            <Line type="monotone" dataKey="pfd" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="PFD %" />
                            <Line type="monotone" dataKey="deg" stroke="#a855f7" strokeWidth={1.5} dot={false} name="Açı°" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
