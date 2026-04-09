'use client';

import React, { useState, useMemo, useCallback, lazy, Suspense, useTransition } from 'react';
import { FlightRecord, FilterState } from '@/lib/types';
import { useFilteredData } from '@/lib/use-filtered-data';
import { getCachedSummary, getCachedHealthScores, getCachedInsights, clearAllCaches } from '@/lib/analytics-cache';
import { debounce } from '@/lib/performance';
import KPICards from './KPICards';
import Filters from './Filters';
import { Plane, RotateCcw, AlertTriangle, BarChart3, GitCompareArrows, Activity, TrendingUp, Brain, Ruler, Heart, Clock, Loader2, BookOpen } from 'lucide-react';

// Lazy-load heavy tab components
const CorrelationHeatmap = lazy(() => import('./CorrelationHeatmap'));
const ScatterPlot = lazy(() => import('./ScatterPlot'));
const AnomalyTable = lazy(() => import('./AnomalyTable'));
const TailTrend = lazy(() => import('./TailTrend'));
const PredictiveInsights = lazy(() => import('./PredictiveInsights'));
const LandingDistanceAnalysisView = lazy(() => import('./LandingDistanceAnalysis'));
const TailHealthMatrix = lazy(() => import('./TailHealthMatrix'));
const FlightTimeline = lazy(() => import('./FlightTimeline'));
const DocsTab = lazy(() => import('./DocsTab'));

interface Props {
  data: FlightRecord[];
  onReset: () => void;
}

type TabKey = 'overview' | 'correlation' | 'scatter' | 'anomalies' | 'trends' | 'predictive' | 'landing' | 'health' | 'timeline' | 'docs';

function TabSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      <span className="ml-3 text-slate-400 text-sm">Yükleniyor…</span>
    </div>
  );
}

export default function Dashboard({ data, onReset }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState<FilterState>({
    dateRange: null,
    tails: [],
    aircraftType: 'ALL',
    anomalyLevel: 'ALL',
    airport: '',
  });

  // Debounced filter setter
  const debouncedSetFilters = useMemo(
    () => debounce((f: FilterState) => {
      startTransition(() => setFilters(f));
    }, 200),
    [startTransition],
  );

  const handleFilterChange = useCallback(
    (f: FilterState) => debouncedSetFilters(f),
    [debouncedSetFilters],
  );

  const { filteredData, index } = useFilteredData(data, filters);

  const summary = useMemo(() => getCachedSummary(filteredData), [filteredData]);

  const healthScores = useMemo(() => {
    if (['overview', 'predictive', 'health'].includes(activeTab)) {
      return getCachedHealthScores(filteredData);
    }
    return [];
  }, [filteredData, activeTab]);

  const insights = useMemo(() => {
    if (['overview', 'predictive'].includes(activeTab) && healthScores.length > 0) {
      return getCachedInsights(filteredData, healthScores);
    }
    return [];
  }, [filteredData, healthScores, activeTab]);

  const handleReset = useCallback(() => {
    clearAllCaches();
    onReset();
  }, [onReset]);

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'overview', label: 'Genel Bakış', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'predictive', label: 'Tahminsel Bakım', icon: <Brain className="w-4 h-4" />, badge: insights.filter(i => i.severity === 'critical').length || undefined },
    { key: 'health', label: 'Uçak Sağlığı', icon: <Heart className="w-4 h-4" /> },
    { key: 'correlation', label: 'Korelasyon', icon: <GitCompareArrows className="w-4 h-4" /> },
    { key: 'scatter', label: 'Scatter Plot', icon: <Activity className="w-4 h-4" /> },
    { key: 'anomalies', label: 'Anomaliler', icon: <AlertTriangle className="w-4 h-4" />, badge: summary.criticalCount || undefined },
    { key: 'landing', label: 'İniş Mesafesi', icon: <Ruler className="w-4 h-4" /> },
    { key: 'trends', label: 'Tail Trend', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'timeline', label: 'Zaman Çizelgesi', icon: <Clock className="w-4 h-4" /> },
    { key: 'docs', label: 'Nasıl Çalışır?', icon: <BookOpen className="w-4 h-4" /> },
  ];

  const handleTabChange = useCallback((key: TabKey) => {
    startTransition(() => setActiveTab(key));
  }, [startTransition]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/50">
        <div className="max-w-[1800px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Plane className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">B737 Speedbrake Predictive Maintenance</h1>
              <p className="text-xs text-slate-400">
                {summary.totalFlights.toLocaleString()} uçuş · {summary.uniqueTails} uçak · {summary.criticalCount} kritik
                {isPending && <span className="ml-2 text-blue-400">⏳ Hesaplanıyor…</span>}
              </p>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Yeni Dosya
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-[1800px] mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto pb-0 scrollbar-hide">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-t-lg transition-all whitespace-nowrap
                  ${activeTab === tab.key
                    ? 'bg-slate-800 text-blue-400 border-b-2 border-blue-400'
                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
                  }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded-full font-bold">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Filters — hide on docs tab */}
      {activeTab !== 'docs' && (
        <div className="max-w-[1800px] mx-auto px-4 pt-4">
          <Filters index={index} filters={filters} onFilterChange={handleFilterChange} />
        </div>
      )}

      {/* Content */}
      <div className="max-w-[1800px] mx-auto px-4 py-4">
        <Suspense fallback={<TabSpinner />}>
          {activeTab === 'overview' && (
            <div className="space-y-4 animate-fade-in">
              <KPICards summary={summary} />
              {insights.filter(i => i.severity === 'critical').length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-bold text-red-400">Kritik Tahminsel Bakım Uyarıları</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {insights.filter(i => i.severity === 'critical').slice(0, 6).map(insight => (
                      <div key={insight.id} className="bg-red-500/5 rounded-lg p-2.5 border border-red-500/10">
                        <div className="text-xs font-medium text-red-300">{insight.title}</div>
                        <div className="text-[10px] text-slate-400 mt-1">
                          {insight.category.toUpperCase()} · %{insight.confidence} güven · {insight.relatedFlights} uçuş
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <CorrelationHeatmap data={filteredData} />
                <ScatterPlot data={filteredData} />
              </div>
              <AnomalyTable data={filteredData} maxRows={10} />
            </div>
          )}
          {activeTab === 'predictive' && <PredictiveInsights insights={insights} data={filteredData} healthScores={healthScores} />}
          {activeTab === 'health' && <TailHealthMatrix healthScores={healthScores} data={filteredData} />}
          {activeTab === 'correlation' && <CorrelationHeatmap data={filteredData} fullSize />}
          {activeTab === 'scatter' && <ScatterPlot data={filteredData} fullSize />}
          {activeTab === 'anomalies' && <AnomalyTable data={filteredData} />}
          {activeTab === 'landing' && <LandingDistanceAnalysisView data={filteredData} />}
          {activeTab === 'trends' && <TailTrend data={filteredData} />}
          {activeTab === 'timeline' && <FlightTimeline data={filteredData} />}
          {activeTab === 'docs' && <DocsTab />}
        </Suspense>
      </div>
    </div>
  );
}
