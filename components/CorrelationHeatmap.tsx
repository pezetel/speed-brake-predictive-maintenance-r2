'use client';

import { useMemo } from 'react';
import { FlightRecord } from '@/lib/types';
import { computeCorrelation, analysisFields, getFieldLabel } from '@/lib/utils';
import { downsample } from '@/lib/performance';

interface Props {
  data: FlightRecord[];
  fullSize?: boolean;
}

const MAX_CORR_SAMPLE = 5000;

export default function CorrelationHeatmap({ data, fullSize }: Props) {
  // Subsample for correlation computation (Pearson doesn't need all points)
  const sampled = useMemo(() => {
    if (data.length <= MAX_CORR_SAMPLE) return data;
    return downsample(data, MAX_CORR_SAMPLE);
  }, [data]);

  const matrix = useMemo(() => {
    const fields = [...analysisFields];
    const result: { xKey: string; yKey: string; value: number }[][] = [];
    for (let i = 0; i < fields.length; i++) {
      const row: { xKey: string; yKey: string; value: number }[] = [];
      for (let j = 0; j < fields.length; j++) {
        const paired = sampled
          .map(d => ({ x: d[fields[i] as keyof FlightRecord] as number, y: d[fields[j] as keyof FlightRecord] as number }))
          .filter(p => typeof p.x === 'number' && typeof p.y === 'number' && p.x > 0 && p.y > 0 && p.x < 100000 && p.y < 100000);
        const corr = computeCorrelation(paired.map(p => p.x), paired.map(p => p.y));
        row.push({ xKey: fields[i], yKey: fields[j], value: corr });
      }
      result.push(row);
    }
    return result;
  }, [sampled]);

  const getColor = (val: number): string => {
    const abs = Math.abs(val);
    if (val > 0) {
      if (abs > 0.8) return 'bg-blue-600 text-white font-bold';
      if (abs > 0.6) return 'bg-blue-500/80 text-white';
      if (abs > 0.4) return 'bg-blue-400/60 text-blue-100';
      if (abs > 0.2) return 'bg-blue-300/30 text-blue-200';
      return 'bg-slate-700/50 text-slate-400';
    } else {
      if (abs > 0.8) return 'bg-red-600 text-white font-bold';
      if (abs > 0.6) return 'bg-red-500/80 text-white';
      if (abs > 0.4) return 'bg-red-400/60 text-red-100';
      if (abs > 0.2) return 'bg-red-300/30 text-red-200';
      return 'bg-slate-700/50 text-slate-400';
    }
  };

  const fields = [...analysisFields];

  const keyCorrelations = useMemo(() => {
    const highlights: { pair: string; value: number; interpretation: string }[] = [];
    for (let i = 0; i < matrix.length; i++) {
      for (let j = i + 1; j < matrix[i].length; j++) {
        const cell = matrix[i][j];
        if (Math.abs(cell.value) > 0.5) {
          const pair = `${getFieldLabel(cell.xKey)} ↔ ${getFieldLabel(cell.yKey)}`;
          let interpretation = '';
          if (cell.xKey.includes('pfd') && cell.yKey.includes('landing')) {
            interpretation = cell.value < 0 ? 'PFD düştükçe iniş mesafesi uzar' : 'PFD ile iniş mesafesi pozitif ilişkili';
          } else if (cell.xKey.includes('Deg') && cell.yKey.includes('Deg')) {
            interpretation = 'Açı değerleri tutarlı mekanik davranış gösteriyor';
          } else if (cell.xKey.includes('duration') && cell.yKey.includes('duration')) {
            interpretation = 'Süre parametreleri ilişkili';
          } else {
            interpretation = cell.value > 0 ? 'Pozitif korelasyon' : 'Negatif korelasyon';
          }
          highlights.push({ pair, value: cell.value, interpretation });
        }
      }
    }
    return highlights.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 8);
  }, [matrix]);

  return (
    <div className="card">
      <div className="card-header flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-gradient-to-r from-red-500 via-slate-500 to-blue-500" />
        Korelasyon Matrisi
        {data.length > MAX_CORR_SAMPLE && <span className="text-[10px] text-slate-500 ml-2">({MAX_CORR_SAMPLE.toLocaleString()} örnekle)</span>}
      </div>
      <div className="overflow-x-auto">
        <div className={`${fullSize ? 'min-w-[800px]' : 'min-w-[600px]'}`}>
          <div className="flex">
            <div className={`${fullSize ? 'w-40' : 'w-28'} shrink-0`} />
            {fields.map(f => (
              <div key={f} className={`${fullSize ? 'w-24' : 'w-16'} shrink-0 text-center`}>
                <span className="text-[9px] text-slate-400 font-medium leading-tight block" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', height: fullSize ? '110px' : '70px' }}>
                  {getFieldLabel(f)}
                </span>
              </div>
            ))}
          </div>
          {matrix.map((row, i) => (
            <div key={i} className="flex items-center">
              <div className={`${fullSize ? 'w-40' : 'w-28'} shrink-0 pr-2 text-right`}>
                <span className="text-[9px] text-slate-400 font-medium">{getFieldLabel(fields[i])}</span>
              </div>
              {row.map((cell, j) => (
                <div
                  key={j}
                  className={`${fullSize ? 'w-24 h-10' : 'w-16 h-8'} shrink-0 flex items-center justify-center ${getColor(cell.value)} rounded-sm m-[1px] transition-all hover:scale-110 hover:z-10 cursor-default`}
                  title={`${getFieldLabel(cell.xKey)} ↔ ${getFieldLabel(cell.yKey)}: r=${cell.value.toFixed(3)}`}
                >
                  <span className={`${fullSize ? 'text-xs' : 'text-[9px]'} font-mono`}>{i === j ? '1.00' : cell.value.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-slate-400">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-600" /> Negatif (güçlü)</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-slate-600" /> Zayıf / Yok</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-blue-600" /> Pozitif (güçlü)</div>
      </div>
      {fullSize && keyCorrelations.length > 0 && (
        <div className="mt-6 border-t border-slate-700 pt-4">
          <h4 className="text-xs font-semibold text-slate-300 mb-3">🔑 Önemli Korelasyonlar</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {keyCorrelations.map((kc, i) => (
              <div key={i} className={`rounded-lg p-2.5 border text-xs ${kc.value > 0 ? 'bg-blue-500/5 border-blue-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-300">{kc.pair}</span>
                  <span className={`font-mono font-bold ${kc.value > 0 ? 'text-blue-400' : 'text-red-400'}`}>r={kc.value.toFixed(3)}</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{kc.interpretation}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
