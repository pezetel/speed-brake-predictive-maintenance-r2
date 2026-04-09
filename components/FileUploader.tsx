'use client';

import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, Loader2, CheckCircle } from 'lucide-react';
import { FlightRecord } from '@/lib/types';
import { parseExcelInWorker, ParseProgress } from '@/lib/worker-bridge';

interface Props {
  onDataLoaded: (data: FlightRecord[]) => void;
}

export default function FileUploader({ onDataLoaded }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const isLoading = progress !== null && progress.phase !== 'done';

  const processFile = useCallback(async (file: File) => {
    setProgress({ phase: 'reading', percent: 0 });
    setError(null);
    setFileName(file.name);

    try {
      // Use the Web Worker bridge — parsing happens off the main thread
      // Falls back to main-thread parsing if Workers aren't available
      const records = await parseExcelInWorker(file, setProgress);

      if (records.length === 0) {
        setError('Geçerli uçuş kaydı bulunamadı. Kolon sıralamasını kontrol edin.');
        setProgress(null);
        return;
      }

      // Small delay so user sees 100%
      setTimeout(() => {
        onDataLoaded(records);
        setProgress(null);
      }, 400);
    } catch (err) {
      setError('Dosya okunurken hata oluştu: ' + (err as Error).message);
      setProgress(null);
    }
  }, [onDataLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const phaseLabels: Record<string, string> = {
    reading: 'Dosya okunuyor…',
    parsing: 'Excel ayrıştırılıyor…',
    analyzing: 'Anomali analizi yapılıyor…',
    done: 'Tamamlandı!',
  };

  return (
    <div className="w-full">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-10 transition-all duration-300 cursor-pointer
          ${isDragging
            ? 'border-blue-400 bg-blue-500/10 scale-[1.02]'
            : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
          }
          ${isLoading ? 'pointer-events-none' : ''}
        `}
        onClick={() => !isLoading && document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileInput}
        />

        {progress ? (
          <div className="flex flex-col items-center gap-4">
            {progress.phase === 'done' ? (
              <CheckCircle className="w-12 h-12 text-emerald-400" />
            ) : (
              <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
            )}
            <p className="text-slate-300 font-medium">{phaseLabels[progress.phase]}</p>
            {fileName && <p className="text-slate-500 text-sm">{fileName}</p>}

            {/* Progress bar */}
            <div className="w-full max-w-xs">
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-slate-500">
                <span>{progress.percent}%</span>
                {progress.recordCount !== undefined && (
                  <span>{progress.recordCount.toLocaleString()} kayıt</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 bg-slate-700/50 rounded-xl">
              {isDragging ? (
                <FileSpreadsheet className="w-12 h-12 text-blue-400" />
              ) : (
                <Upload className="w-12 h-12 text-slate-400" />
              )}
            </div>
            <div className="text-center">
              <p className="text-slate-300 font-medium">
                {isDragging ? 'Dosyayı bırakın' : 'Excel dosyanızı sürükleyin veya tıklayın'}
              </p>
              <p className="text-slate-500 text-sm mt-1">.xlsx, .xls, .csv — 50.000+ satır desteklenir (Web Worker ile)</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
