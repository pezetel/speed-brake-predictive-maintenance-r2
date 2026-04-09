'use client';

import { AnomalySummary } from '@/lib/types';
import { AlertTriangle, CheckCircle, Plane, Gauge, Timer, Ruler, Wrench } from 'lucide-react';

interface Props {
  summary: AnomalySummary;
}

export default function KPICards({ summary }: Props) {
  const cards = [
    { label: 'Toplam Uçuş', value: summary.totalFlights.toLocaleString(), sub: `${summary.uniqueTails} uçak`, icon: <Plane className="w-5 h-5" />, color: 'blue' },
    { label: 'Kritik Anomali', value: summary.criticalCount.toLocaleString(), sub: `${summary.problematicTails.length} farklı uçak`, icon: <AlertTriangle className="w-5 h-5" />, color: 'red' },
    { label: 'Uyarı', value: summary.warningCount.toLocaleString(), sub: `${((summary.warningCount / Math.max(summary.totalFlights, 1)) * 100).toFixed(1)}% oran`, icon: <AlertTriangle className="w-5 h-5" />, color: 'amber' },
    { label: 'Normal', value: summary.normalCount.toLocaleString(), sub: `${((summary.normalCount / Math.max(summary.totalFlights, 1)) * 100).toFixed(1)}% sağlıklı`, icon: <CheckCircle className="w-5 h-5" />, color: 'emerald' },
    { label: 'Ort. PFD', value: summary.avgPFD.toFixed(1) + '%', sub: summary.avgPFD < 95 ? '⚠️ Normalin altında' : '✅ Normal', icon: <Gauge className="w-5 h-5" />, color: summary.avgPFD < 95 ? 'amber' : 'cyan' },
    { label: 'Ort. Açı', value: summary.avgDeg.toFixed(1) + '°', sub: `Süre: ${summary.avgDuration.toFixed(2)}s`, icon: <Timer className="w-5 h-5" />, color: 'purple' },
    { label: 'Ort. İniş', value: summary.avgLandingDist.toFixed(0) + 'm', sub: `${summary.landingDistAnomalyCount} mesafe anomalisi`, icon: <Ruler className="w-5 h-5" />, color: 'indigo' },
    { label: 'Yavaş Açılma', value: summary.slowOpeningCount.toLocaleString(), sub: `${summary.mechanicalFailureCount} mekanik arıza`, icon: <Wrench className="w-5 h-5" />, color: 'orange' },
  ];

  const colorMap: Record<string, { bg: string; icon: string; text: string; border: string }> = {
    blue: { bg: 'bg-blue-500/10', icon: 'text-blue-400', text: 'text-blue-400', border: 'border-blue-500/20' },
    red: { bg: 'bg-red-500/10', icon: 'text-red-400', text: 'text-red-400', border: 'border-red-500/20' },
    amber: { bg: 'bg-amber-500/10', icon: 'text-amber-400', text: 'text-amber-400', border: 'border-amber-500/20' },
    emerald: { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    cyan: { bg: 'bg-cyan-500/10', icon: 'text-cyan-400', text: 'text-cyan-400', border: 'border-cyan-500/20' },
    purple: { bg: 'bg-purple-500/10', icon: 'text-purple-400', text: 'text-purple-400', border: 'border-purple-500/20' },
    indigo: { bg: 'bg-indigo-500/10', icon: 'text-indigo-400', text: 'text-indigo-400', border: 'border-indigo-500/20' },
    orange: { bg: 'bg-orange-500/10', icon: 'text-orange-400', text: 'text-orange-400', border: 'border-orange-500/20' },
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {cards.map((card, i) => {
        const c = colorMap[card.color] || colorMap.blue;
        return (
          <div key={i} className={`card ${c.border}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">{card.label}</span>
              <div className={`p-1.5 rounded-lg ${c.bg}`}><span className={c.icon}>{card.icon}</span></div>
            </div>
            <div className={`text-xl font-bold ${c.text} mb-1`}>{card.value}</div>
            <div className="text-[10px] text-slate-500 leading-relaxed">{card.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
