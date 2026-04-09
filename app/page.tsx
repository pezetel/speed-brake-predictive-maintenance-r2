'use client';

import { useState } from 'react';
import { FlightRecord } from '@/lib/types';
import FileUploader from '@/components/FileUploader';
import Dashboard from '@/components/Dashboard';
import { Plane, AlertTriangle } from 'lucide-react';

export default function Home() {
  const [data, setData] = useState<FlightRecord[] | null>(null);

  return (
    <main className="min-h-screen">
      {!data ? (
        <div className="flex flex-col items-center justify-center min-h-screen px-4">
          <div className="max-w-2xl w-full text-center">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="p-3 bg-blue-500/20 rounded-xl border border-blue-500/30">
                <Plane className="w-10 h-10 text-blue-400" />
              </div>
              <div className="p-3 bg-red-500/20 rounded-xl border border-red-500/30">
                <AlertTriangle className="w-10 h-10 text-red-400" />
              </div>
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-3">
              B737 Speedbrake Analizi
            </h1>
            <p className="text-slate-400 text-lg mb-2">Speedbrake Predictive Maintenance</p>
            <p className="text-slate-500 text-sm mb-10">
              Excel dosyanızı yükleyerek uçuş verilerindeki speedbrake anomalilerini tespit edin.
              10.000+ satır desteklenir — sanal tablolar ve akıllı örnekleme ile hızlı çalışır.
            </p>
            <FileUploader onDataLoaded={setData} />
            <div className="mt-10 grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                <div className="text-2xl mb-1">📊</div>
                <div className="text-xs text-slate-400">Korelasyon Heatmap</div>
              </div>
              <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                <div className="text-2xl mb-1">🔴</div>
                <div className="text-xs text-slate-400">Anomali Tespiti</div>
              </div>
              <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                <div className="text-2xl mb-1">✈️</div>
                <div className="text-xs text-slate-400">Tahminsel Bakım</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Dashboard data={data} onReset={() => setData(null)} />
      )}
    </main>
  );
}
