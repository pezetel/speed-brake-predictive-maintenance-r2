import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

// ---- Helpers ----
function parseNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (s.includes(',') && !s.includes('.')) return parseFloat(s.replace(',', '.')) || 0;
  if (s.includes(',') && s.includes('.')) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    return parseFloat(s.replace(/,/g, '')) || 0;
  }
  return parseFloat(s) || 0;
}

function detectAircraftType(tail: string): 'NG' | 'MAX' {
  if (!tail) return 'NG';
  return tail.toUpperCase().startsWith('TC-SM') ? 'MAX' : 'NG';
}

function excelDateToISO(val: any): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  const parts = s.split('.');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
    return `${year}-${month}-${day}`;
  }
  if (s.includes('-')) return s;
  if (s.includes('/')) {
    const p = s.split('/');
    if (p.length === 3) {
      const month = p[0].padStart(2, '0');
      const day = p[1].padStart(2, '0');
      const year = p[2].length === 2 ? '20' + p[2] : p[2];
      return `${year}-${month}-${day}`;
    }
  }
  return s;
}

// ---- Types ----
interface FlightRecord {
  flightDate: string;
  tailNumber: string;
  takeoffAirport: string;
  landingAirport: string;
  pfdTurn1: number;
  durationDerivative: number;
  durationExtTo99: number;
  pfdTurn1Deg: number;
  pfeTo99Deg: number;
  landingDist30kn: number;
  landingDist50kn: number;
  gsAtAutoSbop: number;
  aircraftType: 'NG' | 'MAX';
  anomalyLevel: 'normal' | 'warning' | 'critical';
  anomalyReasons: string[];
  isDoubledRecord: boolean;
  normalizedPfd: number;
  durationRatio: number;
  landingDistAnomaly: boolean;
}

interface FaultRecord {
  tailNumber: string;
  date: string;
  description: string;
  rawRow: Record<string, any>;
}

interface MatchResult {
  fault: FaultRecord;
  matchedFlights: FlightRecord[];
  bestMatch: FlightRecord | null;
  caughtAs: 'critical' | 'warning' | 'missed';
}

// ---- Anomaly Detection (mirror of lib/utils.ts) ----
function detectAnomaly(
  record: Omit<FlightRecord, 'anomalyLevel' | 'anomalyReasons'>,
): { level: 'normal' | 'warning' | 'critical'; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const nPfd = record.normalizedPfd;

  if (nPfd > 0 && nPfd < 60) {
    score += 60;
    reasons.push('PFD ciddi dusuk: ' + record.pfdTurn1.toFixed(1) + '%');
  } else if (nPfd >= 60 && nPfd < 75) {
    score += 45;
    reasons.push('PFD cok dusuk: ' + record.pfdTurn1.toFixed(1) + '%');
  } else if (nPfd >= 75 && nPfd < 85) {
    score += 25;
    reasons.push('PFD dusuk: ' + record.pfdTurn1.toFixed(1) + '%');
  } else if (nPfd >= 85 && nPfd < 92) {
    score += 8;
    reasons.push('PFD normalin altinda: ' + record.pfdTurn1.toFixed(1) + '%');
  }

  if (record.durationDerivative > 0 && record.durationExtTo99 > 0) {
    const ratio = record.durationRatio;
    const absExt = record.durationExtTo99;
    if (ratio > 6 && absExt > 8) {
      score += 40;
      reasons.push('Cok yavas acilma: %99a ' + absExt.toFixed(1) + 's (oran ' + ratio.toFixed(1) + 'x)');
    } else if (ratio > 4 && absExt > 5) {
      score += 25;
      reasons.push('Yavas acilma: %99a ' + absExt.toFixed(1) + 's (oran ' + ratio.toFixed(1) + 'x)');
    } else if (ratio > 3 && absExt > 4) {
      score += 12;
      reasons.push('Acilma gecikmesi: oran ' + ratio.toFixed(1) + 'x');
    }
  }

  if (record.durationExtTo99 > 15) {
    score += 35;
    reasons.push('%99 suresi asiri: ' + record.durationExtTo99.toFixed(1) + 's');
  } else if (record.durationExtTo99 > 10) {
    score += 15;
    reasons.push('%99 suresi yuksek: ' + record.durationExtTo99.toFixed(1) + 's');
  }

  if (record.landingDist30kn > 0 && record.landingDist50kn > 0) {
    if (record.landingDist50kn > record.landingDist30kn * 1.05) {
      score += 30;
      reasons.push('Inis mesafesi fizik ihlali: 50kn > 30kn');
    }
  }

  if (record.pfdTurn1Deg > 0 && record.pfeTo99Deg > 0) {
    if (record.pfdTurn1Deg < 20 && nPfd < 75) {
      score += 40;
      reasons.push('Aci cok dusuk: ' + record.pfdTurn1Deg.toFixed(1) + ' + PFD ' + nPfd.toFixed(1) + '%');
    } else if (record.pfdTurn1Deg < 25 && nPfd < 80) {
      score += 25;
      reasons.push('Aci dusuk: ' + record.pfdTurn1Deg.toFixed(1) + ' + PFD ' + nPfd.toFixed(1) + '%');
    }
    const degDiff = record.pfeTo99Deg - record.pfdTurn1Deg;
    if (degDiff > 10 && nPfd < 85) {
      score += 20;
      reasons.push('Gecikmeli acilma: ' + record.pfdTurn1Deg.toFixed(1) + ' -> ' + record.pfeTo99Deg.toFixed(1));
    } else if (degDiff > 8 && nPfd < 80) {
      score += 15;
      reasons.push('Kademeli acilma');
    }
  }

  if (record.isDoubledRecord) {
    reasons.push('Cift panel kaydi (ham PFD: ' + record.pfdTurn1.toFixed(1) + '%)');
  }

  if (record.gsAtAutoSbop > 0 && record.gsAtAutoSbop < 1500) {
    score += 5;
    reasons.push('GS@SBOP dusuk: ' + record.gsAtAutoSbop.toFixed(0));
  }

  if (nPfd < 85 && record.landingDist30kn > 1800) {
    score += 15;
    reasons.push('Dusuk PFD + uzun inis');
  }

  let level: 'normal' | 'warning' | 'critical' = 'normal';
  if (score >= 40) level = 'critical';
  else if (score >= 16) level = 'warning';
  if (reasons.length === 0) level = 'normal';
  if (level === 'normal' && reasons.length === 1 && record.isDoubledRecord) level = 'normal';

  return { level, reasons };
}

// ---- Parse flight data ----
function parseFlightData(filePath: string): FlightRecord[] {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

  console.log('');
  console.log('--- Ucus verisi: ' + filePath);
  console.log('    Satir sayisi: ' + rows.length);
  if (rows.length > 0) {
    console.log('    Kolonlar: ' + Object.keys(rows[0]).join(', '));
  }

  const keys = rows.length > 0 ? Object.keys(rows[0]) : [];

  function findCol(patterns: string[]): string | null {
    for (const key of keys) {
      const upper = key.toUpperCase();
      for (const p of patterns) {
        if (upper.includes(p.toUpperCase())) return key;
      }
    }
    return null;
  }

  const colDate = findCol(['FLIGHT_DATE', 'DATE', 'TARIH']);
  const colTail = findCol(['TAIL_NUMBER', 'TAIL', 'KUYRUK']);
  const colTakeoff = findCol(['TAKEOFF_AIRPORT', 'TAKEOFF', 'KALKIS']);
  const colLanding = findCol(['LANDING_AIRPORT', 'LANDING_AIRPORT_CODE', 'INIS']);
  const colPfd = findCol(['PFD_TURN_1)', 'PFD_TURN_1', 'SBLE_PFD_TURN_1)']);
  const colDurDeriv = findCol(['DERIVATIVE_TURN_1', 'DURATION_BASED_ON_DERIVATIVE']);
  const colDurExt = findCol(['EXTENSION_TO_99', 'DURATION_BASED_ON_EXTENSION']);
  const colPfdDeg = findCol(['PFD_TURN_1_DEG', 'TURN_1_DEG)']);
  const colPfeDeg = findCol(['PFE_TO_99_DEG', 'PFE_TO_99']);
  const colLand30 = findCol(['30_KNOT', 'FOR_30_KNOT', '30KN']);
  const colLand50 = findCol(['50_KNOT', 'FOR_50_KNOT', '50KN']);
  const colGs = findCol(['GS_AT_AUTO', 'SBOP_SEC', 'GS_AT_AUTO_SBOP']);

  console.log('    Date col: ' + (colDate || 'NOT FOUND'));
  console.log('    Tail col: ' + (colTail || 'NOT FOUND'));
  console.log('    PFD col:  ' + (colPfd || 'NOT FOUND'));

  const records: FlightRecord[] = [];

  for (const row of rows) {
    let tailNumber: string;
    let dateVal: any;
    let takeoffAirport: string;
    let landingAirport: string;
    let pfdTurn1: number;
    let durationDerivative: number;
    let durationExtTo99: number;
    let pfdTurn1Deg: number;
    let pfeTo99Deg: number;
    let landingDist30kn: number;
    let landingDist50kn: number;
    let gsAtAutoSbop: number;

    if (colTail) {
      dateVal = row[colDate || ''];
      tailNumber = String(row[colTail] || '').trim().toUpperCase();
      takeoffAirport = String(row[colTakeoff || ''] || '').trim().toUpperCase();
      landingAirport = String(row[colLanding || ''] || '').trim().toUpperCase();
      pfdTurn1 = parseNum(row[colPfd || '']);
      durationDerivative = parseNum(row[colDurDeriv || '']);
      durationExtTo99 = parseNum(row[colDurExt || '']);
      pfdTurn1Deg = parseNum(row[colPfdDeg || '']);
      pfeTo99Deg = parseNum(row[colPfeDeg || '']);
      landingDist30kn = parseNum(row[colLand30 || '']);
      landingDist50kn = parseNum(row[colLand50 || '']);
      gsAtAutoSbop = parseNum(row[colGs || '']);
    } else {
      const vals = Object.values(row);
      if (vals.length < 12) continue;
      dateVal = vals[0];
      tailNumber = String(vals[1] || '').trim().toUpperCase();
      takeoffAirport = String(vals[2] || '').trim().toUpperCase();
      landingAirport = String(vals[3] || '').trim().toUpperCase();
      pfdTurn1 = parseNum(vals[4]);
      durationDerivative = parseNum(vals[5]);
      durationExtTo99 = parseNum(vals[6]);
      pfdTurn1Deg = parseNum(vals[7]);
      pfeTo99Deg = parseNum(vals[8]);
      landingDist30kn = parseNum(vals[9]);
      landingDist50kn = parseNum(vals[10]);
      gsAtAutoSbop = parseNum(vals[11]);
    }

    if (!tailNumber || !tailNumber.startsWith('TC-')) continue;

    const flightDate = excelDateToISO(dateVal);
    if (!flightDate) continue;

    const aircraftType = detectAircraftType(tailNumber);
    const isDoubledRecord = pfdTurn1 > 150;
    const normalizedPfd = isDoubledRecord ? pfdTurn1 / Math.round(pfdTurn1 / 100) : pfdTurn1;
    const durationRatio = durationDerivative > 0 ? durationExtTo99 / durationDerivative : 0;
    const landingDistAnomaly = landingDist30kn > 0 && landingDist50kn > 0 && landingDist50kn > landingDist30kn * 1.05;

    const partial = {
      flightDate, tailNumber, takeoffAirport, landingAirport,
      pfdTurn1, durationDerivative, durationExtTo99,
      pfdTurn1Deg, pfeTo99Deg, landingDist30kn, landingDist50kn,
      gsAtAutoSbop, aircraftType, isDoubledRecord, normalizedPfd,
      durationRatio, landingDistAnomaly,
    };

    const { level, reasons } = detectAnomaly(partial);

    records.push({
      ...partial,
      anomalyLevel: level,
      anomalyReasons: reasons,
    });
  }

  console.log('    Parse edilen kayit: ' + records.length);
  return records;
}

// ---- Parse fault data ----
function parseFaultData(filePath: string): FaultRecord[] {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const faults: FaultRecord[] = [];

  console.log('');
  console.log('--- Ariza verisi: ' + filePath);
  console.log('    Sheet sayisi: ' + wb.SheetNames.length + ' -> ' + wb.SheetNames.join(', '));

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

    console.log('');
    console.log('    Sheet "' + sheetName + '": ' + rows.length + ' satir');
    if (rows.length > 0) {
      console.log('    Kolonlar: ' + Object.keys(rows[0]).join(', '));
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        const vals = Object.entries(rows[i]).map(function(e) { return e[0] + '=' + e[1]; }).join(' | ');
        console.log('    Ornek ' + (i + 1) + ': ' + vals.substring(0, 200));
      }
    }

    const keys = rows.length > 0 ? Object.keys(rows[0]) : [];

    const colTail = keys.find(function(k) {
      const u = k.toUpperCase();
      return u.includes('TAIL') || u.includes('KUYRUK') || u.includes('AC') || u.includes('REG');
    }) || keys.find(function(k) {
      const v = String(rows[0] && rows[0][k] || '').trim().toUpperCase();
      return v.startsWith('TC-');
    });

    const colDate = keys.find(function(k) {
      const u = k.toUpperCase();
      return u.includes('DATE') || u.includes('TARIH') || u.includes('REPORT');
    }) || keys.find(function(k) {
      const v = rows[0] && rows[0][k];
      if (v instanceof Date) return true;
      if (typeof v === 'number' && v > 40000 && v < 50000) return true;
      return false;
    });

    const colDesc = keys.find(function(k) {
      const u = k.toUpperCase();
      return u.includes('DESC') || u.includes('DEFECT') || u.includes('ARIZA') || u.includes('FAULT')
        || u.includes('TEXT') || u.includes('MESSAGE') || u.includes('DETAIL') || u.includes('COMPLAINT');
    });

    console.log('    Eslesen: Tail=' + (colTail || '?') + ', Date=' + (colDate || '?') + ', Desc=' + (colDesc || '?'));

    for (const row of rows) {
      let tail = '';
      if (colTail) {
        tail = String(row[colTail] || '').trim().toUpperCase();
      }
      if (!tail.startsWith('TC-')) {
        const allVals = Object.values(row);
        for (let vi = 0; vi < allVals.length; vi++) {
          const sv = String(allVals[vi] || '').trim().toUpperCase();
          if (sv.startsWith('TC-') && sv.length >= 5 && sv.length <= 8) {
            tail = sv;
            break;
          }
        }
      }
      if (!tail.startsWith('TC-')) continue;

      let date = '';
      if (colDate) {
        date = excelDateToISO(row[colDate]);
      }
      if (!date) {
        const allVals2 = Object.values(row);
        for (let vi2 = 0; vi2 < allVals2.length; vi2++) {
          const d = excelDateToISO(allVals2[vi2]);
          if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
            date = d;
            break;
          }
        }
      }

      let desc = '';
      if (colDesc) {
        desc = String(row[colDesc] || '').trim();
      }
      if (!desc) {
        desc = Object.entries(row)
          .filter(function(e) { return e[0] !== colTail && e[0] !== colDate; })
          .map(function(e) { return String(e[1] || '').trim(); })
          .filter(function(v) { return v.length > 3; })
          .join(' | ');
      }

      faults.push({ tailNumber: tail, date: date, description: desc, rawRow: row });
    }
  }

  console.log('');
  console.log('    Toplam ariza kaydi: ' + faults.length);
  return faults;
}

// ---- Match faults to flights ----
function matchFaults(faults: FaultRecord[], flights: FlightRecord[]): MatchResult[] {
  const flightIndex = new Map<string, FlightRecord[]>();
  for (const f of flights) {
    const key = f.tailNumber + '|' + f.flightDate;
    let arr = flightIndex.get(key);
    if (!arr) { arr = []; flightIndex.set(key, arr); }
    arr.push(f);
  }

  const tailFlights = new Map<string, FlightRecord[]>();
  for (const f of flights) {
    let arr = tailFlights.get(f.tailNumber);
    if (!arr) { arr = []; tailFlights.set(f.tailNumber, arr); }
    arr.push(f);
  }

  const results: MatchResult[] = [];

  for (const fault of faults) {
    let matchedFlights: FlightRecord[] = [];

    // Exact date match
    const exactKey = fault.tailNumber + '|' + fault.date;
    const exact = flightIndex.get(exactKey);
    if (exact && exact.length > 0) {
      matchedFlights = exact;
    }

    // +/- 3 days
    if (matchedFlights.length === 0 && fault.date) {
      const faultDate = new Date(fault.date);
      const tailF = tailFlights.get(fault.tailNumber) || [];
      matchedFlights = tailF.filter(function(f) {
        const fd = new Date(f.flightDate);
        const diffDays = Math.abs((fd.getTime() - faultDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 3;
      });
    }

    // +/- 7 days
    if (matchedFlights.length === 0 && fault.date) {
      const faultDate = new Date(fault.date);
      const tailF = tailFlights.get(fault.tailNumber) || [];
      matchedFlights = tailF.filter(function(f) {
        const fd = new Date(f.flightDate);
        const diffDays = Math.abs((fd.getTime() - faultDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 7;
      });
    }

    let bestMatch: FlightRecord | null = null;
    for (const f of matchedFlights) {
      if (!bestMatch) { bestMatch = f; continue; }
      if (f.anomalyLevel === 'critical' && bestMatch.anomalyLevel !== 'critical') bestMatch = f;
      else if (f.anomalyLevel === 'warning' && bestMatch.anomalyLevel === 'normal') bestMatch = f;
    }

    let caughtAs: 'critical' | 'warning' | 'missed' = 'missed';
    if (bestMatch) {
      if (bestMatch.anomalyLevel === 'critical') caughtAs = 'critical';
      else if (bestMatch.anomalyLevel === 'warning') caughtAs = 'warning';
    }

    results.push({ fault: fault, matchedFlights: matchedFlights, bestMatch: bestMatch, caughtAs: caughtAs });
  }

  return results;
}

// ---- Main ----
function main() {
  const rootDir = path.resolve(__dirname, '..');
  const flightFile = path.join(rootDir, 'speed brake info.xlsx');
  const faultFile = path.join(rootDir, 'speedbrake ar\u0131zalar\u0131 filtreli.xlsx');

  if (!fs.existsSync(flightFile)) {
    console.error('HATA: Dosya bulunamadi: ' + flightFile);
    process.exit(1);
  }
  if (!fs.existsSync(faultFile)) {
    console.error('HATA: Dosya bulunamadi: ' + faultFile);
    process.exit(1);
  }

  console.log('================================================================');
  console.log(' B737 Speedbrake - Gercek Ariza vs Tahmin Karsilastirma');
  console.log('================================================================');

  // 1. Parse both files
  const allFlights = parseFlightData(flightFile);
  const faults = parseFaultData(faultFile);

  if (allFlights.length === 0) {
    console.error('HATA: Ucus verisi parse edilemedi!');
    process.exit(1);
  }
  if (faults.length === 0) {
    console.error('HATA: Ariza verisi parse edilemedi!');
    process.exit(1);
  }

  // 2. Date range
  const faultDates = faults.map(function(f) { return f.date; }).filter(function(d) { return d && /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
  const minFaultDate = faultDates[0] || '';
  const maxFaultDate = faultDates[faultDates.length - 1] || '';

  console.log('');
  console.log('----------------------------------------------------------------');
  console.log(' TARIH ARALIGI');
  console.log('----------------------------------------------------------------');
  console.log('  Ariza tarihleri: ' + minFaultDate + ' -> ' + maxFaultDate);

  const flightDates = allFlights.map(function(f) { return f.flightDate; }).filter(function(d) { return !!d; }).sort();
  console.log('  Ucus tarihleri:  ' + flightDates[0] + ' -> ' + flightDates[flightDates.length - 1]);

  // Filter flights to fault date range +/- 7 days
  let bufferStart = flightDates[0];
  if (minFaultDate) {
    const d = new Date(minFaultDate);
    d.setDate(d.getDate() - 7);
    bufferStart = d.toISOString().split('T')[0];
  }
  let bufferEnd = flightDates[flightDates.length - 1];
  if (maxFaultDate) {
    const d = new Date(maxFaultDate);
    d.setDate(d.getDate() + 7);
    bufferEnd = d.toISOString().split('T')[0];
  }

  const filteredFlights = allFlights.filter(function(f) { return f.flightDate >= bufferStart && f.flightDate <= bufferEnd; });
  console.log('  Filtrelenen ucus: ' + filteredFlights.length + ' (' + bufferStart + ' -> ' + bufferEnd + ')');

  // 3. Anomaly stats
  const criticalFlights = filteredFlights.filter(function(f) { return f.anomalyLevel === 'critical'; });
  const warningFlights = filteredFlights.filter(function(f) { return f.anomalyLevel === 'warning'; });
  const normalFlights = filteredFlights.filter(function(f) { return f.anomalyLevel === 'normal'; });

  console.log('');
  console.log('----------------------------------------------------------------');
  console.log(' FILTRELENMIS DONEM UCUS ANOMALI DAGILIMI');
  console.log('----------------------------------------------------------------');
  console.log('  Toplam ucus:   ' + filteredFlights.length);
  console.log('  KRITIK:        ' + criticalFlights.length + ' (%' + (criticalFlights.length / filteredFlights.length * 100).toFixed(1) + ')');
  console.log('  UYARI:         ' + warningFlights.length + ' (%' + (warningFlights.length / filteredFlights.length * 100).toFixed(1) + ')');
  console.log('  NORMAL:        ' + normalFlights.length + ' (%' + (normalFlights.length / filteredFlights.length * 100).toFixed(1) + ')');

  // 4. Match faults
  const matchResults = matchFaults(faults, filteredFlights);

  const caughtCritical = matchResults.filter(function(r) { return r.caughtAs === 'critical'; });
  const caughtWarning = matchResults.filter(function(r) { return r.caughtAs === 'warning'; });
  const missed = matchResults.filter(function(r) { return r.caughtAs === 'missed'; });
  const totalFaults = matchResults.length;

  console.log('');
  console.log('================================================================');
  console.log(' GERCEK ARIZA YAKALAMA SONUCLARI');
  console.log('================================================================');
  console.log('  Toplam gercek ariza kaydi:   ' + totalFaults);
  console.log('  Kritik olarak yakalanan:     ' + caughtCritical.length + ' (%' + (caughtCritical.length / totalFaults * 100).toFixed(1) + ')');
  console.log('  Uyari olarak yakalanan:      ' + caughtWarning.length + ' (%' + (caughtWarning.length / totalFaults * 100).toFixed(1) + ')');
  console.log('  TOPLAM YAKALANAN:            ' + (caughtCritical.length + caughtWarning.length) + ' (%' + ((caughtCritical.length + caughtWarning.length) / totalFaults * 100).toFixed(1) + ')');
  console.log('  KACIRILAN:                   ' + missed.length + ' (%' + (missed.length / totalFaults * 100).toFixed(1) + ')');

  // 5. Missed detail
  if (missed.length > 0) {
    console.log('');
    console.log('----------------------------------------------------------------');
    console.log(' KACIRILAN ARIZALAR (Detay)');
    console.log('----------------------------------------------------------------');
    for (const m of missed) {
      console.log('');
      console.log('  [KACTI] ' + m.fault.tailNumber + ' | ' + m.fault.date);
      console.log('     Aciklama: ' + m.fault.description.substring(0, 150));
      if (m.matchedFlights.length > 0) {
        console.log('     Eslesen ucus sayisi: ' + m.matchedFlights.length + ' (hepsi normal olarak degerlendirildi)');
        for (const f of m.matchedFlights.slice(0, 3)) {
          console.log('       ' + f.flightDate + ' ' + f.takeoffAirport + '->' + f.landingAirport + ' PFD=' + f.normalizedPfd.toFixed(1) + '% DEG=' + f.pfdTurn1Deg.toFixed(1) + ' Ratio=' + f.durationRatio.toFixed(2) + 'x');
        }
      } else {
        console.log('     Bu tarih araliginda ucus verisi bulunamadi');
      }
    }
  }

  // 6. Caught detail
  console.log('');
  console.log('----------------------------------------------------------------');
  console.log(' YAKALANAN ARIZALAR (Detay)');
  console.log('----------------------------------------------------------------');
  const allCaught = caughtCritical.concat(caughtWarning);
  for (const r of allCaught) {
    const icon = r.caughtAs === 'critical' ? '[KRITIK]' : '[UYARI] ';
    console.log('  ' + icon + ' ' + r.fault.tailNumber + ' | ' + r.fault.date + ' -> ' + r.caughtAs.toUpperCase());
    if (r.bestMatch) {
      console.log('     Ucus: ' + r.bestMatch.flightDate + ' ' + r.bestMatch.takeoffAirport + '->' + r.bestMatch.landingAirport);
      console.log('     PFD=' + r.bestMatch.normalizedPfd.toFixed(1) + '% DEG=' + r.bestMatch.pfdTurn1Deg.toFixed(1) + ' Ratio=' + r.bestMatch.durationRatio.toFixed(2) + 'x');
      console.log('     Sebepler: ' + r.bestMatch.anomalyReasons.join(' | '));
    }
  }

  // 7. Extra alerts (not associated with real faults)
  const faultKeys = new Set<string>();
  for (const f of faults) {
    if (f.date) {
      const faultDate = new Date(f.date);
      for (let d = -3; d <= 3; d++) {
        const dt = new Date(faultDate);
        dt.setDate(dt.getDate() + d);
        faultKeys.add(f.tailNumber + '|' + dt.toISOString().split('T')[0]);
      }
    }
  }

  const extraCriticals = filteredFlights.filter(function(f) {
    const key = f.tailNumber + '|' + f.flightDate;
    return f.anomalyLevel === 'critical' && !faultKeys.has(key);
  });
  const extraWarnings = filteredFlights.filter(function(f) {
    const key = f.tailNumber + '|' + f.flightDate;
    return f.anomalyLevel === 'warning' && !faultKeys.has(key);
  });

  console.log('');
  console.log('----------------------------------------------------------------');
  console.log(' GERCEK ARIZA DISI EK UYARILAR (False Positive / Erken Tespit)');
  console.log('----------------------------------------------------------------');
  console.log('  Ek Kritik uyari:   ' + extraCriticals.length);
  console.log('  Ek Warning uyari:  ' + extraWarnings.length);
  console.log('  Toplam ek uyari:   ' + (extraCriticals.length + extraWarnings.length));

  // Breakdown by tail
  const extraByTail = new Map<string, { critical: number; warning: number }>();
  for (const f of extraCriticals) {
    let entry = extraByTail.get(f.tailNumber);
    if (!entry) { entry = { critical: 0, warning: 0 }; extraByTail.set(f.tailNumber, entry); }
    entry.critical++;
  }
  for (const f of extraWarnings) {
    let entry = extraByTail.get(f.tailNumber);
    if (!entry) { entry = { critical: 0, warning: 0 }; extraByTail.set(f.tailNumber, entry); }
    entry.warning++;
  }
  if (extraByTail.size > 0) {
    console.log('');
    console.log('  Ucak bazli ek uyarilar:');
    const sorted = Array.from(extraByTail.entries()).sort(function(a, b) { return (b[1].critical + b[1].warning) - (a[1].critical + a[1].warning); });
    for (const entry of sorted) {
      console.log('    ' + entry[0] + ': ' + entry[1].critical + ' kritik, ' + entry[1].warning + ' uyari');
    }
  }

  // 8. Summary table
  const catchRate = (caughtCritical.length + caughtWarning.length) / totalFaults * 100;
  const falsePositiveRate = (extraCriticals.length + extraWarnings.length) / filteredFlights.length * 100;

  console.log('');
  console.log('');
  console.log('+======================================================================+');
  console.log('|                        OZET SONUC TABLOSU                            |');
  console.log('+======================================================================+');
  console.log('|  Analiz Donemi            | ' + bufferStart + ' -> ' + bufferEnd);
  console.log('|  Toplam Ucus (donemde)    | ' + filteredFlights.length);
  console.log('|  Gercek Ariza Kaydi       | ' + totalFaults);
  console.log('+----------------------------------------------------------------------+');
  console.log('|  YAKALAMA PERFORMANSI                                                |');
  console.log('+----------------------------------------------------------------------+');
  console.log('|  Kritik ile yakalanan     | ' + caughtCritical.length + ' / ' + totalFaults + '  (%' + (caughtCritical.length / totalFaults * 100).toFixed(1) + ')');
  console.log('|  Uyari ile yakalanan      | ' + caughtWarning.length + ' / ' + totalFaults + '  (%' + (caughtWarning.length / totalFaults * 100).toFixed(1) + ')');
  console.log('|  TOPLAM Yakalama Orani    | ' + (caughtCritical.length + caughtWarning.length) + ' / ' + totalFaults + '  (%' + catchRate.toFixed(1) + ')');
  console.log('|  Kacirilan                | ' + missed.length + ' / ' + totalFaults + '  (%' + (missed.length / totalFaults * 100).toFixed(1) + ')');
  console.log('+----------------------------------------------------------------------+');
  console.log('|  EK UYARILAR (ariza kaydi olmayan)                                   |');
  console.log('+----------------------------------------------------------------------+');
  console.log('|  Ek Kritik                | ' + extraCriticals.length);
  console.log('|  Ek Uyari                 | ' + extraWarnings.length);
  console.log('|  Toplam Ek Uyari          | ' + (extraCriticals.length + extraWarnings.length));
  console.log('|  False Positive Orani     | %' + falsePositiveRate.toFixed(1) + ' (' + (extraCriticals.length + extraWarnings.length) + '/' + filteredFlights.length + ')');
  console.log('+----------------------------------------------------------------------+');
  console.log('|  DEGERLENDIRME                                                       |');
  console.log('+----------------------------------------------------------------------+');
  if (catchRate >= 90) {
    console.log('|  Yakalama orani MUKEMMEL (%' + catchRate.toFixed(1) + ')');
  } else if (catchRate >= 70) {
    console.log('|  Yakalama orani IYI (%' + catchRate.toFixed(1) + ')');
  } else if (catchRate >= 50) {
    console.log('|  Yakalama orani ORTA (%' + catchRate.toFixed(1) + ') - esik degerleri ayarlanmali');
  } else {
    console.log('|  Yakalama orani DUSUK (%' + catchRate.toFixed(1) + ') - ciddi kalibrasyon gerekli');
  }

  if (missed.length > 0) {
    console.log('|');
    console.log('|  Kacirilan ariza ucaklari:');
    const missedTailSet = new Set<string>();
    for (const m of missed) { missedTailSet.add(m.fault.tailNumber); }
    const missedTails = Array.from(missedTailSet);
    for (const t of missedTails) {
      const count = missed.filter(function(m) { return m.fault.tailNumber === t; }).length;
      const hasData = missed.filter(function(m) { return m.fault.tailNumber === t && m.matchedFlights.length > 0; }).length;
      console.log('|    ' + t + ': ' + count + ' ariza (' + hasData + ' tanesi ucus verisiyle eslesti)');
    }
  }
  console.log('+======================================================================+');

  // 9. Detailed match table
  console.log('');
  console.log('');
  console.log('----------------------------------------------------------------');
  console.log(' DETAYLI ESLESTIRME TABLOSU');
  console.log('----------------------------------------------------------------');
  console.log('  Ucak       | Ariza Tarihi | Sonuc    | Eslesen Ucus | PFD%    | Aci    | Ratio  | Aciklama');
  console.log('  -----------|--------------|----------|--------------|---------|--------|--------|-------------------');
  for (const r of matchResults) {
    const icon = r.caughtAs === 'critical' ? 'KRITIK  ' : (r.caughtAs === 'warning' ? 'UYARI   ' : 'KACTI   ');
    const pfd = r.bestMatch ? r.bestMatch.normalizedPfd.toFixed(1) : 'N/A';
    const deg = r.bestMatch ? r.bestMatch.pfdTurn1Deg.toFixed(1) : 'N/A';
    const ratio = r.bestMatch ? r.bestMatch.durationRatio.toFixed(2) : 'N/A';
    const fDate = r.bestMatch ? r.bestMatch.flightDate : 'yok';
    const desc = r.fault.description.substring(0, 40);
    console.log('  ' + r.fault.tailNumber.padEnd(10) + ' | ' + r.fault.date.padEnd(12) + ' | ' + icon + ' | ' + fDate.padEnd(12) + ' | ' + pfd.padStart(6) + '% | ' + deg.padStart(5) + ' | ' + ratio.padStart(5) + 'x | ' + desc);
  }
}

main();
