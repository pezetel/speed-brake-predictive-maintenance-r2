// ============================================================
// B737 Speedbrake — Worker Bridge
// Manages a real Web Worker for Excel parsing off the main thread.
// Falls back to main-thread parsing if Worker is unavailable.
// ============================================================
import { FlightRecord } from './types';

export interface ParseProgress {
  phase: 'reading' | 'parsing' | 'analyzing' | 'done';
  percent: number;
  recordCount?: number;
}

let workerInstance: Worker | null = null;

function getWorker(): Worker | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!workerInstance) {
      workerInstance = new Worker('/parse-worker.js');
    }
    return workerInstance;
  } catch {
    return null;
  }
}

/**
 * Parse an Excel file using a real Web Worker.
 * The heavy XLSX parsing + anomaly detection runs entirely off the main thread.
 * Falls back to main-thread parsing if Workers aren't available.
 */
export function parseExcelInWorker(
  file: File,
  onProgress: (p: ParseProgress) => void,
): Promise<FlightRecord[]> {
  return new Promise(async (resolve, reject) => {
    const worker = getWorker();

    if (!worker) {
      // Fallback: dynamic import of the old main-thread parser
      try {
        const { parseExcelWithProgress } = await import('./worker-parse');
        const records = await parseExcelWithProgress(file, onProgress);
        resolve(records);
      } catch (err) {
        reject(err);
      }
      return;
    }

    // Read the file as ArrayBuffer on the main thread (fast)
    onProgress({ phase: 'reading', percent: 2 });
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err) {
      reject(new Error('Dosya okunamadı: ' + (err as Error).message));
      return;
    }

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
    };

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress({
          phase: msg.phase,
          percent: msg.percent,
          recordCount: msg.recordCount,
        });
      } else if (msg.type === 'result') {
        cleanup();
        resolve(msg.records as FlightRecord[]);
      } else if (msg.type === 'error') {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      reject(new Error('Worker error: ' + err.message));
    };

    // Transfer the buffer to the worker (zero-copy)
    worker.postMessage({ type: 'parse', buffer: buffer }, [buffer]);
  });
}

/**
 * Terminate the worker if needed (e.g., on component unmount)
 */
export function terminateParseWorker(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}
