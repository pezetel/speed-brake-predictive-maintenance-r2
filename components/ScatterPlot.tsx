'use client';

import { useMemo, useState } from 'react';
import { FlightRecord } from '@/lib/types';
import { analysisFields, getFieldLabel } from '@/lib/utils';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Props {
  data: FlightRecord[];
  fullSize?: boolean;
}

const MAX_SCATTER = 2000;

function stratifiedSample(data: FlightRecord[], max: number): FlightRecord[] {
  if (data.length <= max) return data;
  const critical = data.filter(d => d.anomalyLevel === 'critical');
  const warning = data.filter(d => d.anomalyLevel === 'warning');
  const normal = data.filter(d => d.anomalyLevel === 'normal');
  const budget = max - critical.length - warning.length;
  if (budget <= 0) return [...critical, ...warning].slice(0, max);
  const step = normal.length / budget;
  const sampled: FlightRecord[] = [...critical, ...warning];
  for (let i = 0; i < budget && i * step < normal.length; i++) sampled.push(normal[Math.floor(i * step)]);
  return sampled;
}

export default function ScatterPlot({ data, fullSize }: Props) {
  const [xField, setXField] = useState<string>('normalizedPfd');
  const [yField, setYField] = useState<string>('pfdTurn1Deg');
  const [colorBy, setColorBy] = useState<'anomaly'>('anomaly');

  const chartData = useMemo(() => {
    const valid = data.filter(d => (d as any)[xField] > 0 && (d as any)[yField] > 0);
    const sampled = stratifiedSample(valid, MAX_SCATTER);
    return sampled.map(d => ({
      x: (d as any)[xField],
      y: (d as any)[yField],
      tail: d.tailNumber,
      anomaly: d.anomalyLevel,
    }));
  }, [data, xField, yField]);

  const normalData = chartData.filter(d => d.anomaly === 'normal');
  const warningData = chartData.filter(d => d.anomaly === 'warning');
  const criticalData = chartData.filter(d => d.anomaly === 'critical');

  const height = fullSize ? 'h-[600px]' : 'h-[350px]';
  const sampledLabel = data.length > MAX_SCATTER ? ` (${MAX_SCATTER.toLocaleString()} örneklendi)` : '';

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="card-header">Scatter Plot{sampledLabel}</div>
        <div className="flex flex-wrap gap-2">
          <select value={xField} onChange={e => setXField(e.target.value)} className="bg-slate-700 text-slate-200 text-[10px] rounded-lg px-2 py-1 border border-slate-600">
            {analysisFields.map(f => <option key={f} value={f}>{getFieldLabel(f)}</option>)}
          </select>
          <select value={yField} onChange={e => setYField(e.target.value)} className="bg-slate-700 text-slate-200 text-[10px] rounded-lg px-2 py-1 border border-slate-600">
            {analysisFields.map(f => <option key={f} value={f}>{getFieldLabel(f)}</option>)}
          </select>
        </div>
      </div>
      <div className={height}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="x" name={getFieldLabel(xField)} tick={{ fill: '#94a3b8', fontSize: 10 }} />
            <YAxis dataKey="y" name={getFieldLabel(yField)} tick={{ fill: '#94a3b8', fontSize: 10 }} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Scatter name="Normal" data={normalData} fill="#22c55e" fillOpacity={0.5} isAnimationActive={false} />
            <Scatter name="Uyarı" data={warningData} fill="#f59e0b" fillOpacity={0.6} isAnimationActive={false} />
            <Scatter name="Kritik" data={criticalData} fill="#ef4444" fillOpacity={0.7} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
