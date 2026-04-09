'use client';

import { useState, useMemo, useCallback } from 'react';
import { PredictiveInsight, FlightRecord, TailHealthScore } from '@/lib/types';
import {
  Brain, AlertTriangle, Droplets, Wrench, Cpu, Radio, Plane,
  ChevronDown, ChevronUp, ShieldAlert, Search, Filter, X,
  TrendingDown, TrendingUp, Minus, Eye
} from 'lucide-react';

interface Props {
  insights: PredictiveInsight[];
  data: FlightRecord[];
  healthScores: TailHealthScore[];
}

const categoryConfig: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string; label: string }> = {
  hydraulic: { icon: <Droplets className="w-4 h-4" />, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Hidrolik' },
  mechanical: { icon: <Wrench className="w-4 h-4" />, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', label: 'Mekanik' },
  sensor: { icon: <Cpu className="w-4 h-4" />, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', label: 'Sensör' },
  actuator: { icon: <Radio className="w-4 h-4" />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', label: 'Aktüatör' },
  operational: { icon: <Plane className="w-4 h-4" />, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Operasyonel' },
};

const severityConfig: Record<string, { color: string; bg: string; border: string; label: string; glow: string; dotColor: string }> = {
  critical: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Kritik', glow: 'shadow-red-500/10 shadow-lg', dotColor: 'bg-red-500' },
  warning: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Uyarı', glow: '', dotColor: 'bg-amber-500' },
  info: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Bilgi', glow: '', dotColor: 'bg-blue-500' },
};

const riskLabel: Record<string, string> = { LOW: 'Düşük', MEDIUM: 'Orta', HIGH: 'Yüksek', CRITICAL: 'Kritik' };

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

const trendIcon: Record<string, React.ReactNode> = {
  improving: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
  stable: <Minus className="w-3.5 h-3.5 text-slate-400" />,
  degrading: <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
};

const trendLabel: Record<string, string> = {
  improving: 'İyileşiyor',
  stable: 'Stabil',
  degrading: 'Kötüleşiyor',
};

interface TailGroup {
  tailNumber: string;
  health: TailHealthScore | null;
  criticals: PredictiveInsight[];
  warnings: PredictiveInsight[];
  infos: PredictiveInsight[];
  totalInsights: number;
  worstSeverity: 'critical' | 'warning' | 'info';
}

function worstSeverityOf(group: TailGroup): 'critical' | 'warning' | 'info' {
  if (group.criticals.length > 0) return 'critical';
  if (group.warnings.length > 0) return 'warning';
  return 'info';
}

export default function PredictiveInsights({ insights, data, healthScores }: Props) {
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [selectedTail, setSelectedTail] = useState<string | null>(null);
  const [tailSearch, setTailSearch] = useState('');
  const [expandedTails, setExpandedTails] = useState<Set<string>>(new Set());

  const tailHealthMap = useMemo(() => {
    const map = new Map<string, TailHealthScore>();
    healthScores.forEach(h => map.set(h.tailNumber, h));
    return map;
  }, [healthScores]);

  // Group insights by tail
  const tailGroups = useMemo(() => {
    const groupMap = new Map<string, TailGroup>();

    insights.forEach(ins => {
      let g = groupMap.get(ins.tailNumber);
      if (!g) {
        g = {
          tailNumber: ins.tailNumber,
          health: tailHealthMap.get(ins.tailNumber) || null,
          criticals: [],
          warnings: [],
          infos: [],
          totalInsights: 0,
          worstSeverity: 'info',
        };
        groupMap.set(ins.tailNumber, g);
      }
      if (ins.severity === 'critical') g.criticals.push(ins);
      else if (ins.severity === 'warning') g.warnings.push(ins);
      else g.infos.push(ins);
      g.totalInsights++;
      g.worstSeverity = worstSeverityOf(g);
    });

    let groups = Array.from(groupMap.values());
    groups.sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, info: 2 };
      const diff = sevOrder[a.worstSeverity] - sevOrder[b.worstSeverity];
      if (diff !== 0) return diff;
      return (a.health?.healthScore ?? 100) - (b.health?.healthScore ?? 100);
    });
    return groups;
  }, [insights, tailHealthMap]);

  // Each tail in ONLY ONE banner based on worst severity
  const criticalTailGroups = useMemo(() => tailGroups.filter(g => worstSeverityOf(g) === 'critical'), [tailGroups]);
  const warningOnlyTailGroups = useMemo(() => tailGroups.filter(g => worstSeverityOf(g) === 'warning'), [tailGroups]);

  const totalCriticalInsights = useMemo(() => criticalTailGroups.reduce((s, g) => s + g.criticals.length, 0), [criticalTailGroups]);
  const totalWarningInsights = useMemo(() => warningOnlyTailGroups.reduce((s, g) => s + g.warnings.length, 0), [warningOnlyTailGroups]);

  // Filtered groups for main list
  const filteredGroups = useMemo(() => {
    let groups = tailGroups;

    if (tailSearch.trim()) {
      const q = tailSearch.trim().toUpperCase();
      groups = groups.filter(g => g.tailNumber.toUpperCase().includes(q));
    }

    if (filterSeverity !== 'ALL') {
      groups = groups.filter(g => {
        if (filterSeverity === 'critical') return g.criticals.length > 0;
        if (filterSeverity === 'warning') return g.warnings.length > 0;
        if (filterSeverity === 'info') return g.infos.length > 0;
        return true;
      });
    }

    if (filterCategory !== 'ALL') {
      groups = groups.filter(g => {
        const allIns = [...g.criticals, ...g.warnings, ...g.infos];
        return allIns.some(i => i.category === filterCategory);
      });
    }

    if (selectedTail) {
      groups = groups.filter(g => g.tailNumber === selectedTail);
    }

    return groups;
  }, [tailGroups, tailSearch, filterSeverity, filterCategory, selectedTail]);

  const handleSelectTail = useCallback((tail: string) => {
    setSelectedTail(prev => prev === tail ? null : tail);
    setExpandedInsightId(null);
    setExpandedTails(prev => {
      const next = new Set(prev);
      if (!next.has(tail)) next.add(tail);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setSelectedTail(null);
    setTailSearch('');
    setFilterCategory('ALL');
    setFilterSeverity('ALL');
    setExpandedInsightId(null);
  }, []);

  const toggleTailExpanded = useCallback((tail: string) => {
    setExpandedTails(prev => {
      const next = new Set(prev);
      if (next.has(tail)) next.delete(tail);
      else next.add(tail);
      return next;
    });
  }, []);

  const expandAllTails = useCallback(() => {
    setExpandedTails(new Set(filteredGroups.map(g => g.tailNumber)));
  }, [filteredGroups]);

  const collapseAllTails = useCallback(() => {
    setExpandedTails(new Set());
  }, []);

  const selectedHealth = selectedTail ? tailHealthMap.get(selectedTail) ?? null : null;

  return (
    <div className="space-y-4 animate-fade-in">

      {/* ── TOP BANNERS ── Her uçak sadece en kötü seviyesinin panelinde ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* KRİTİK PANELİ */}
        <div className={`card border-red-500/30 ${criticalTailGroups.length > 0 ? 'animate-pulse-glow' : ''}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-red-500/20">
              <ShieldAlert className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-red-400">Kritik Uyarılar</h3>
              <p className="text-[10px] text-slate-500">
                {totalCriticalInsights} kritik sorun · {criticalTailGroups.length} uçak
              </p>
            </div>
            <div className="ml-auto text-3xl font-black text-red-400">{totalCriticalInsights}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {criticalTailGroups.map(g => (
              <button
                key={g.tailNumber}
                onClick={() => handleSelectTail(g.tailNumber)}
                className={`text-[10px] px-2.5 py-1.5 rounded-lg border font-bold transition-all
                  ${selectedTail === g.tailNumber
                    ? 'bg-red-500/30 border-red-500/50 text-red-300 ring-1 ring-red-500/30'
                    : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                  }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {g.tailNumber}
                  <span className="opacity-60">·</span>
                  <span className="text-red-300">{g.criticals.length}K</span>
                  {g.warnings.length > 0 && (
                    <span className="text-amber-400/70">{g.warnings.length}U</span>
                  )}
                </span>
              </button>
            ))}
            {criticalTailGroups.length === 0 && (
              <span className="text-[10px] text-emerald-400/60 italic flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Kritik sorun yok ✓
              </span>
            )}
          </div>
        </div>

        {/* UYARI PANELİ — sadece warning olan uçaklar */}
        <div className="card border-amber-500/30">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-400">Uyarılar</h3>
              <p className="text-[10px] text-slate-500">
                {totalWarningInsights} uyarı · {warningOnlyTailGroups.length} uçak
                {criticalTailGroups.some(g => g.warnings.length > 0) && (
                  <span className="text-slate-600 ml-1">
                    (+ {criticalTailGroups.reduce((s, g) => s + g.warnings.length, 0)} uyarı kritik uçaklarda)
                  </span>
                )}
              </p>
            </div>
            <div className="ml-auto text-3xl font-black text-amber-400">{totalWarningInsights}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {warningOnlyTailGroups.map(g => (
              <button
                key={g.tailNumber}
                onClick={() => handleSelectTail(g.tailNumber)}
                className={`text-[10px] px-2.5 py-1.5 rounded-lg border font-medium transition-all
                  ${selectedTail === g.tailNumber
                    ? 'bg-amber-500/30 border-amber-500/50 text-amber-300 ring-1 ring-amber-500/30'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                  }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  {g.tailNumber}
                  <span className="opacity-60">({g.warnings.length})</span>
                </span>
              </button>
            ))}
            {warningOnlyTailGroups.length === 0 && (
              <span className="text-[10px] text-emerald-400/60 italic flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Sadece uyarısı olan uçak yok ✓
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── SEÇİLİ UÇAK DETAY ── */}
      {selectedTail && selectedHealth && (
        <div className={`card border ${riskBg(selectedHealth.riskLevel)} animate-fade-in`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${
                selectedHealth.riskLevel === 'CRITICAL' ? 'bg-red-500/20' :
                selectedHealth.riskLevel === 'HIGH' ? 'bg-orange-500/20' :
                selectedHealth.riskLevel === 'MEDIUM' ? 'bg-amber-500/20' : 'bg-emerald-500/20'
              }`}>
                <Plane className={`w-6 h-6 ${riskColor(selectedHealth.riskLevel)}`} />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-white">{selectedTail}</h2>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${riskBg(selectedHealth.riskLevel)} ${riskColor(selectedHealth.riskLevel)} font-bold`}>
                    {riskLabel[selectedHealth.riskLevel]} Risk · Skor {selectedHealth.healthScore.toFixed(0)}
                  </span>
                  <span className="text-[10px] text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded-full">
                    {selectedHealth.aircraftType}
                  </span>
                  {trendIcon[selectedHealth.trend]}
                </div>
                <div className="flex items-center gap-4 mt-1 text-[10px] text-slate-500">
                  <span>{selectedHealth.totalFlights} uçuş</span>
                  <span>Son: {selectedHealth.lastFlightDate}</span>
                  <span>Trend: {trendLabel[selectedHealth.trend]}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedTail(null)}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tek satır metrikler */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mt-4 pt-3 border-t border-slate-700/30">
            <div>
              <div className="text-[10px] text-slate-500">Ort. PFD</div>
              <div className={`text-sm font-bold ${selectedHealth.avgPfd < 90 ? 'text-red-400' : selectedHealth.avgPfd < 95 ? 'text-amber-400' : 'text-slate-200'}`}>
                {selectedHealth.avgPfd.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Ort. Açı</div>
              <div className="text-sm font-bold text-slate-200">{selectedHealth.avgDeg.toFixed(1)}°</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Süre Oranı</div>
              <div className={`text-sm font-bold ${selectedHealth.durationRatioAvg > 2.5 ? 'text-red-400' : selectedHealth.durationRatioAvg > 2 ? 'text-amber-400' : 'text-slate-200'}`}>
                {selectedHealth.durationRatioAvg.toFixed(2)}x
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Kritik Uçuş</div>
              <div className={`text-sm font-bold ${selectedHealth.criticalCount > 0 ? 'text-red-400' : 'text-slate-200'}`}>{selectedHealth.criticalCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Uyarılı Uçuş</div>
              <div className={`text-sm font-bold ${selectedHealth.warningCount > 0 ? 'text-amber-400' : 'text-slate-200'}`}>{selectedHealth.warningCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">İniş Anomali</div>
              <div className={`text-sm font-bold ${selectedHealth.landingDistAnomalyRate > 0.05 ? 'text-red-400' : 'text-slate-200'}`}>
                %{(selectedHealth.landingDistAnomalyRate * 100).toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── FİLTRE BARI ── */}
      <div className="card !py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-slate-500" />

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={tailSearch}
              onChange={e => setTailSearch(e.target.value)}
              placeholder="Kuyruk no ara..."
              className="pl-8 pr-3 py-1.5 bg-slate-700/50 border border-slate-600/50 rounded-lg text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500/50 focus:outline-none w-40 transition-colors"
            />
          </div>

          <div className="flex gap-1">
            {[
              { key: 'ALL', label: 'Tümü', activeBg: 'bg-slate-600' },
              { key: 'critical', label: '🔴 Kritik', activeBg: 'bg-red-500/20' },
              { key: 'warning', label: '🟡 Uyarı', activeBg: 'bg-amber-500/20' },
              { key: 'info', label: '🔵 Bilgi', activeBg: 'bg-blue-500/20' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => setFilterSeverity(s.key)}
                className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-all font-medium
                  ${filterSeverity === s.key
                    ? `${s.activeBg} text-white border-white/10 ring-1 ring-white/5`
                    : 'bg-slate-700 text-slate-400 border-slate-600 hover:text-slate-300'
                  }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="bg-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 border border-slate-600 focus:border-blue-500/50 focus:outline-none"
          >
            <option value="ALL">Tüm Kategoriler</option>
            {Object.entries(categoryConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          <span className="text-[10px] text-slate-500">
            {filteredGroups.length} uçak · {filteredGroups.reduce((s, g) => s + g.totalInsights, 0)} insight
          </span>

          <div className="ml-auto flex gap-1">
            <button onClick={expandAllTails} className="text-[10px] text-slate-400 hover:text-slate-200 bg-slate-700/50 px-2 py-1 rounded-lg transition-colors">
              Hepsini Aç
            </button>
            <button onClick={collapseAllTails} className="text-[10px] text-slate-400 hover:text-slate-200 bg-slate-700/50 px-2 py-1 rounded-lg transition-colors">
              Hepsini Kapa
            </button>
            {(filterCategory !== 'ALL' || filterSeverity !== 'ALL' || tailSearch || selectedTail) && (
              <button
                onClick={handleClearAll}
                className="text-[10px] flex items-center gap-1 text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded-lg transition-colors"
              >
                <X className="w-3 h-3" />
                Temizle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── UÇAK GRUPLARI ── */}
      <div className="space-y-3">
        {filteredGroups.length === 0 && (
          <div className="card text-center py-16 text-slate-500">
            <Brain className="w-14 h-14 mx-auto mb-4 text-slate-600" />
            <p className="text-sm font-medium">Filtrelerinize uygun sonuç bulunamadı</p>
            <p className="text-xs text-slate-600 mt-1">Filtreleri değiştirmeyi deneyin</p>
          </div>
        )}

        {filteredGroups.map(group => {
          const isExpanded = expandedTails.has(group.tailNumber);
          const h = group.health;
          const worst = worstSeverityOf(group);
          const hasCritical = worst === 'critical';
          const hasWarning = worst === 'warning';

          const getFilteredInsights = (list: PredictiveInsight[]) => {
            if (filterCategory === 'ALL') return list;
            return list.filter(i => i.category === filterCategory);
          };

          const visibleCriticals = getFilteredInsights(group.criticals);
          const visibleWarnings = getFilteredInsights(group.warnings);
          const visibleInfos = getFilteredInsights(group.infos);

          return (
            <div
              key={group.tailNumber}
              className={`card transition-all ${
                hasCritical ? 'border-red-500/30' : hasWarning ? 'border-amber-500/30' : 'border-slate-700/50'
              } ${hasCritical ? 'shadow-red-500/5 shadow-lg' : ''}`}
            >
              {/* Tail Header */}
              <div
                className="flex items-center gap-3 cursor-pointer group"
                onClick={() => toggleTailExpanded(group.tailNumber)}
              >
                <div className={`p-2.5 rounded-xl shrink-0 ${
                  hasCritical ? 'bg-red-500/15' : hasWarning ? 'bg-amber-500/15' : 'bg-slate-700/50'
                }`}>
                  <Plane className={`w-5 h-5 ${
                    hasCritical ? 'text-red-400' : hasWarning ? 'text-amber-400' : 'text-slate-400'
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{group.tailNumber}</span>
                    {h && (
                      <>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${riskBg(h.riskLevel)} ${riskColor(h.riskLevel)} font-bold`}>
                          {h.healthScore.toFixed(0)} · {riskLabel[h.riskLevel]}
                        </span>
                        <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded-full">
                          {h.aircraftType}
                        </span>
                        {trendIcon[h.trend]}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {group.criticals.length > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-red-400 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        {group.criticals.length} kritik
                      </span>
                    )}
                    {group.warnings.length > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {group.warnings.length} uyarı
                      </span>
                    )}
                    {group.infos.length > 0 && (
                      <span className="text-[10px] text-blue-400">
                        {group.infos.length} bilgi
                      </span>
                    )}
                    {h && (
                      <span className="text-[10px] text-slate-500 ml-2">
                        {h.totalFlights} uçuş · Son: {h.lastFlightDate}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {h && (
                    <div className="w-20 hidden sm:block">
                      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            h.healthScore >= 85 ? 'bg-emerald-500' :
                            h.healthScore >= 70 ? 'bg-amber-500' :
                            h.healthScore >= 50 ? 'bg-orange-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${h.healthScore}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectTail(group.tailNumber);
                    }}
                    className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                    title="Detaylı Analiz"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <div className="p-1">
                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                      : <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                    }
                  </div>
                </div>
              </div>

              {/* Expanded: Insight details */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-slate-700/50 space-y-2 animate-fade-in">
                  {visibleCriticals.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      isExpanded={expandedInsightId === insight.id}
                      onToggle={() => setExpandedInsightId(expandedInsightId === insight.id ? null : insight.id)}
                    />
                  ))}
                  {visibleWarnings.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      isExpanded={expandedInsightId === insight.id}
                      onToggle={() => setExpandedInsightId(expandedInsightId === insight.id ? null : insight.id)}
                    />
                  ))}
                  {visibleInfos.map(insight => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      isExpanded={expandedInsightId === insight.id}
                      onToggle={() => setExpandedInsightId(expandedInsightId === insight.id ? null : insight.id)}
                    />
                  ))}
                  {visibleCriticals.length === 0 && visibleWarnings.length === 0 && visibleInfos.length === 0 && (
                    <p className="text-xs text-slate-500 text-center py-4">Bu kategoride insight yok</p>
                  )}
                </div>
              )}

              {/* Collapsed preview */}
              {!isExpanded && (group.criticals.length > 0 || group.warnings.length > 0) && (
                <div className="mt-3 space-y-1.5">
                  {group.criticals.slice(0, 2).map(ins => {
                    const cat = categoryConfig[ins.category] || categoryConfig.operational;
                    return (
                      <div key={ins.id} className="flex items-center gap-2 text-[11px] bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 animate-pulse" />
                        <span className={cat.color}>{cat.icon}</span>
                        <span className="text-red-300 font-medium truncate">{ins.title.replace(` — ${group.tailNumber}`, '')}</span>
                        <span className="ml-auto text-slate-500 shrink-0">%{ins.confidence}</span>
                      </div>
                    );
                  })}
                  {group.warnings.slice(0, group.criticals.length >= 2 ? 0 : 2 - group.criticals.length).map(ins => {
                    const cat = categoryConfig[ins.category] || categoryConfig.operational;
                    return (
                      <div key={ins.id} className="flex items-center gap-2 text-[11px] bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                        <span className={cat.color}>{cat.icon}</span>
                        <span className="text-amber-300 font-medium truncate">{ins.title.replace(` — ${group.tailNumber}`, '')}</span>
                        <span className="ml-auto text-slate-500 shrink-0">%{ins.confidence}</span>
                      </div>
                    );
                  })}
                  {group.totalInsights > 2 && (
                    <p className="text-[10px] text-slate-500 pl-5">
                      + {group.totalInsights - 2} daha fazla…
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
   InsightCard — Tek bir insight kartı
   ================================================================ */
function InsightCard({
  insight,
  isExpanded,
  onToggle,
}: {
  insight: PredictiveInsight;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const cat = categoryConfig[insight.category] || categoryConfig.operational;
  const sev = severityConfig[insight.severity] || severityConfig.info;

  return (
    <div className={`rounded-lg border ${sev.border} ${sev.bg} transition-all`}>
      <div
        className="flex items-start gap-2.5 cursor-pointer px-3 py-2.5"
        onClick={onToggle}
      >
        <div className={`p-1.5 rounded-md ${cat.bg} shrink-0 mt-0.5`}>
          <span className={cat.color}>{cat.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`w-2 h-2 rounded-full ${sev.dotColor} shrink-0 ${insight.severity === 'critical' ? 'animate-pulse' : ''}`} />
            <h4 className="text-xs font-bold text-white">{insight.title}</h4>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${cat.bg} ${cat.border} ${cat.color}`}>{cat.label}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{insight.description}</p>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
            <span>Güven: <strong className={sev.color}>%{insight.confidence}</strong></span>
            <span>{insight.relatedFlights} uçuş</span>
          </div>
        </div>
        <div className="shrink-0 p-0.5">
          {isExpanded
            ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          }
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2.5 animate-fade-in border-t border-slate-700/30 pt-2.5 ml-8">
          <div>
            <h5 className="text-[10px] font-semibold text-slate-300 mb-1.5">Kanıtlar</h5>
            <div className="space-y-1">
              {insight.evidence.map((ev, i) => (
                <div key={i} className="text-[10px] text-slate-400 bg-slate-800/50 rounded-md px-2.5 py-1 font-mono">
                  #{i + 1} {ev}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-2.5">
            <h5 className="text-[10px] font-semibold text-emerald-400 mb-0.5">💡 Öneri</h5>
            <p className="text-[11px] text-slate-300">{insight.recommendation}</p>
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>Güven Seviyesi</span>
              <span>%{insight.confidence}</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  insight.confidence >= 80 ? 'bg-emerald-500' :
                  insight.confidence >= 60 ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${insight.confidence}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
