// ============================================================
// Excel parse helper — main-thread FALLBACK
// Only used when Web Worker is unavailable.
// The primary path is through worker-bridge.ts → parse-worker.js
// ============================================================
import * as XLSX from 'xlsx';
import { FlightRecord } from './types';
import { parseExcelData } from './utils';

export interface ParseProgress {
  phase: 'reading' | 'parsing' | 'analyzing' | 'done';
  percent: number;
  recordCount?: number;
}

/**
 * Parse an Excel file on the main thread with progress callbacks.
 * Splits work into phases with yields so the UI can show progress.
 */
export async function parseExcelWithProgress(
  file: File,
  onProgress: (p: ParseProgress) => void,
): Promise<FlightRecord[]> {
  // Phase 1: Read file
  onProgress({ phase: 'reading', percent: 10 });
  const buffer = await file.arrayBuffer();

  // Phase 2: Parse workbook
  onProgress({ phase: 'parsing', percent: 25 });
  await yieldToMain();

  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellStyles: false,
    cellFormula: false,
    cellHTML: false,
  });

  // Collect rows from ALL sheets
  let allRows: any[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (json.length > 0) {
      allRows = allRows.concat(json);
    }
  }

  onProgress({ phase: 'parsing', percent: 45, recordCount: allRows.length });

  if (allRows.length === 0) {
    throw new Error('Excel dosyası boş veya okunamadı.');
  }

  // Phase 3: Analyze & create FlightRecords in chunks
  onProgress({ phase: 'analyzing', percent: 50 });
  await yieldToMain();

  const chunkSize = Math.max(5000, Math.min(15000, Math.floor(allRows.length / 8)));
  const records: FlightRecord[] = [];

  for (let i = 0; i < allRows.length; i += chunkSize) {
    const chunk = allRows.slice(i, i + chunkSize);
    const parsed = parseExcelData(chunk);
    records.push(...parsed);

    const pct = 50 + Math.round(((i + chunkSize) / allRows.length) * 45);
    onProgress({
      phase: 'analyzing',
      percent: Math.min(pct, 97),
      recordCount: records.length,
    });

    if (i + chunkSize < allRows.length) {
      await yieldToMain();
    }
  }

  onProgress({ phase: 'done', percent: 100, recordCount: records.length });
  return records;
}

/** Yield control back to the browser's event loop */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
