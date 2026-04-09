'use client';

import React, { useMemo } from 'react';
import { FlightRecord } from '@/lib/types';
import { TailHealthScore } from '@/lib/types';
import { getFieldDescriptions } from '@/lib/data';
import {
  Plane, AlertTriangle, CheckCircle, Info,
  TrendingUp, Timer, Ruler, Gauge
} from 'lucide-react';

interface Props {
  healthScores: TailHealthScore[];
  data: FlightRecord[];
  onAircraftClick?: (tail: string) => void;
}

/**
 * FleetOverview — cleaned up to use the existing TailHealthScore type
 * from analytics instead of a non-existent AircraftHealth type.
 * Removed imports of non-existent chart sub-components.
 */
export default function FleetOverview({ healthScores, data, onAircraftClick }: Props) {
  const ngAircraft = useMemo(() => healthScores.filter(h => h.aircraftType === 'NG'), [healthScores]);
  const maxAircraft = useMemo(() => healthScores.filter(h => h.aircraftType === 'MAX'), [healthScores]);
  const descriptions = getFieldDescriptions();

  const avgHealthNG = ngAircraft.length > 0
    ? ngAircraft.reduce((s, h) => s + h.healthScore, 0) / ngAircraft.length
    : 0;
  const avgHealthMAX = maxAircraft.length > 0
    ? maxAircraft.reduce((s, h) => s + h.healthScore, 0) / maxAircraft.length
    : 0;

  const totalAnomalies = healthScores.reduce((s, h) => s + h.criticalCount + h.warningCount, 0);
  const totalCritical = healthScores.reduce((s, h) => s + h.criticalCount, 0);

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-emerald-400';
    if (score >= 70) return 'text-amber-400';
    if (score >= 50) return 'text-orange-400';
    return 'text-red-400';
  };

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'LOW': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'MEDIUM': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'HIGH': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'CRITICAL': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return '';
    }
  };

  const riskLabel: Record<string, string> = {
    LOW: 'Düşük',
    MEDIUM: 'Orta',
    HIGH: 'Yüksek',
    CRITICAL: 'Kritik',
  };

  const trendLabel: Record<string, string> = {
    improving: '📈 İyileşiyor',
    stable: '➡️ Stabil',
    degrading: '📉 Kötüleşiyor',
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card border-blue-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">737 NG Filo Sağlığı</p>
              <p className={`text-3xl font-bold mt-1 ${getScoreColor(avgHealthNG)}`}>
                {avgHealthNG.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500 mt-1">{ngAircraft.length} uçak</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Plane size={24} className="text-blue-400" />
            </div>
          </div>
        </div>

        <div className="card border-cyan-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">737 MAX Filo Sağlığı</p>
              <p className={`text-3xl font-bold mt-1 ${getScoreColor(avgHealthMAX)}`}>
                {avgHealthMAX.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500 mt-1">{maxAircraft.length} uçak</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
              <Plane size={24} className="text-cyan-400" />
            </div>
          </div>
        </div>

        <div className="card border-amber-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Toplam Anomali</p>
              <p className="text-3xl font-bold mt-1 text-amber-400">
                {totalAnomalies}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {totalCritical} kritik
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center">
              <AlertTriangle size={24} className="text-yellow-400" />
            </div>
          </div>
        </div>

        <div className="card border-emerald-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Toplam Uçuş</p>
              <p className="text-3xl font-bold mt-1 text-emerald-400">
                {data.length.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500 mt-1">{healthScores.length} uçak</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
              <CheckCircle size={24} className="text-green-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Parameter Descriptions */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Info size={18} className="text-blue-400" />
          <h3 className="font-semibold text-white">Parametre Açıklamaları</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {Object.entries(descriptions).map(([key, desc]) => (
            <div key={key} className="bg-slate-700/30 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-400 mb-1">{key}</p>
              <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Aircraft Grid */}
      <div>
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Plane size={18} className="text-blue-400" />
          Uçak Bazlı Durum ({healthScores.length} uçak)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {healthScores
            .slice() // avoid mutating prop
            .sort((a, b) => a.healthScore - b.healthScore)
            .map(ac => (
              <button
                key={ac.tailNumber}
                onClick={() => onAircraftClick?.(ac.tailNumber)}
                className={`card text-left transition-all hover:scale-[1.02] hover:shadow-lg ${
                  ac.riskLevel === 'CRITICAL' ? 'border-red-500/30 shadow-red-500/10 shadow-lg' :
                  ac.riskLevel === 'HIGH' ? 'border-orange-500/30' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{ac.tailNumber}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      ac.aircraftType === 'MAX' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {ac.aircraftType}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${getRiskBadge(ac.riskLevel)}`}>
                    {riskLabel[ac.riskLevel]}
                  </span>
                </div>

                {/* Health bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400">Sağlık Skoru</span>
                    <span className={`font-bold ${getScoreColor(ac.healthScore)}`}>
                      {ac.healthScore.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        ac.healthScore >= 85 ? 'bg-emerald-500' :
                        ac.healthScore >= 70 ? 'bg-amber-500' :
                        ac.healthScore >= 50 ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${ac.healthScore}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-700/30 rounded p-2">
                    <span className="text-slate-500">Uçuş</span>
                    <p className="font-semibold text-white">{ac.totalFlights}</p>
                  </div>
                  <div className="bg-slate-700/30 rounded p-2">
                    <span className="text-slate-500">PFD</span>
                    <p className="font-semibold text-white">{ac.avgPfd.toFixed(1)}%</p>
                  </div>
                  <div className="bg-slate-700/30 rounded p-2">
                    <span className="text-slate-500">Süre Oranı</span>
                    <p className="font-semibold text-white">{ac.durationRatioAvg.toFixed(2)}x</p>
                  </div>
                  <div className="bg-slate-700/30 rounded p-2">
                    <span className="text-slate-500">Anomali</span>
                    <p className={`font-semibold ${(ac.criticalCount + ac.warningCount) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {ac.criticalCount + ac.warningCount}
                    </p>
                  </div>
                </div>

                {/* Trend */}
                <div className="mt-2 text-[10px] text-slate-500 text-center">
                  {trendLabel[ac.trend] || 'Stabil'} · Son: {ac.lastFlightDate}
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
