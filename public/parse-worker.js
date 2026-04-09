// ============================================================
// B737 Speedbrake — Real Web Worker for Excel parsing
// Runs in a separate thread so UI stays responsive for 50K+ rows
// ============================================================

importScripts('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');

// ----------------------------------------------------------------
// Number parsing (handles European comma decimals)
// ----------------------------------------------------------------
function parseNumberSmart(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (s.includes(',') && !s.includes('.')) {
    return parseFloat(s.replace(',', '.')) || 0;
  }
  if (s.includes(',') && s.includes('.')) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    }
    return parseFloat(s.replace(/,/g, '')) || 0;
  }
  return parseFloat(s) || 0;
}

// ----------------------------------------------------------------
// Aircraft-type heuristic
// ----------------------------------------------------------------
function detectAircraftType(tail) {
  if (!tail) return 'NG';
  const t = tail.toUpperCase();
  if (t.startsWith('TC-SM')) return 'MAX';
  return 'NG';
}

// ----------------------------------------------------------------
// Per-record anomaly detection
// ----------------------------------------------------------------
function detectAnomaly(record) {
  const reasons = [];
  let level = 'normal';
  const nPfd = record.normalizedPfd;

  if (nPfd > 0 && nPfd < 70) {
    level = 'critical';
    reasons.push('PFD \u00e7ok d\u00fc\u015f\u00fck: ' + record.pfdTurn1.toFixed(1) + '%');
  } else if (nPfd >= 70 && nPfd < 80) {
    level = 'critical';
    reasons.push('PFD d\u00fc\u015f\u00fck: ' + record.pfdTurn1.toFixed(1) + '%');
  } else if (nPfd >= 80 && nPfd < 95) {
    if (level !== 'critical') level = 'warning';
    reasons.push('PFD normalin alt\u0131nda: ' + record.pfdTurn1.toFixed(1) + '%');
  }

  if (record.durationDerivative > 0 && record.durationExtTo99 > 0) {
    const ratio = record.durationRatio;
    if (ratio > 4) {
      level = 'critical';
      reasons.push('Yava\u015f a\u00e7\u0131lma: %99\'a ula\u015f\u0131m ' + ratio.toFixed(1) + 'x daha uzun');
    } else if (ratio > 2.5) {
      if (level !== 'critical') level = 'warning';
      reasons.push('Gecikmeli a\u00e7\u0131lma: Oran ' + ratio.toFixed(1) + 'x');
    }
  }

  if (record.durationExtTo99 > 10) {
    level = 'critical';
    reasons.push('%99 uzama s\u00fcresi a\u015f\u0131r\u0131 y\u00fcksek: ' + record.durationExtTo99.toFixed(1) + 's');
  } else if (record.durationExtTo99 > 5) {
    if (level !== 'critical') level = 'warning';
    reasons.push('%99 uzama s\u00fcresi y\u00fcksek: ' + record.durationExtTo99.toFixed(1) + 's');
  }

  if (record.landingDist30kn > 0 && record.landingDist50kn > 0) {
    if (record.landingDist50kn > record.landingDist30kn * 1.05) {
      level = 'critical';
      reasons.push('\u0130ni\u015f mesafesi anomalisi: 50kn(' + record.landingDist50kn.toFixed(0) + 'm) > 30kn(' + record.landingDist30kn.toFixed(0) + 'm)');
    }
  }

  if (record.landingDist30kn > 2200) {
    if (level !== 'critical') level = 'warning';
    reasons.push('\u0130ni\u015f mesafesi uzun: ' + record.landingDist30kn.toFixed(0) + 'm (30kn)');
  }

  if (record.pfdTurn1Deg > 0 && record.pfeTo99Deg > 0) {
    if (record.pfdTurn1Deg < 25 && nPfd < 90) {
      level = 'critical';
      reasons.push('A\u00e7\u0131 \u00e7ok d\u00fc\u015f\u00fck: ' + record.pfdTurn1Deg.toFixed(1) + '\u00b0');
    } else if (record.pfdTurn1Deg < 35 && nPfd < 90) {
      if (level !== 'critical') level = 'warning';
      reasons.push('A\u00e7\u0131 d\u00fc\u015f\u00fck: ' + record.pfdTurn1Deg.toFixed(1) + '\u00b0');
    }
    const degDiff = record.pfeTo99Deg - record.pfdTurn1Deg;
    if (degDiff > 8 && nPfd < 90) {
      if (level !== 'critical') level = 'warning';
      reasons.push('Gecikmeli a\u00e7\u0131lma: ' + record.pfdTurn1Deg.toFixed(1) + '\u00b0 \u2192 ' + record.pfeTo99Deg.toFixed(1) + '\u00b0');
    }
  }

  if (record.isDoubledRecord) {
    reasons.push('\u00c7ift kay\u0131t tespit edildi (PFD: ' + record.pfdTurn1.toFixed(1) + ')');
  }

  if (record.gsAtAutoSbop > 0 && record.gsAtAutoSbop < 2500) {
    if (level !== 'critical') level = 'warning';
    reasons.push('GS at SBOP \u00e7ok d\u00fc\u015f\u00fck: ' + record.gsAtAutoSbop.toFixed(0));
  }

  return { level: level, reasons: reasons };
}

// ----------------------------------------------------------------
// Parse date string to ISO format
// ----------------------------------------------------------------
function parseDate(dateVal) {
  if (dateVal instanceof Date) {
    return dateVal.toISOString().split('T')[0];
  }
  if (typeof dateVal === 'number') {
    var d = new Date((dateVal - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
  var s = String(dateVal || '').trim();
  var parts = s.split('.');
  if (parts.length === 3) {
    var day = parts[0].length < 2 ? '0' + parts[0] : parts[0];
    var month = parts[1].length < 2 ? '0' + parts[1] : parts[1];
    var year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
    return year + '-' + month + '-' + day;
  }
  if (s.includes('-')) return s;
  if (s.includes('/')) {
    var p = s.split('/');
    if (p.length === 3) {
      var mo = p[0].length < 2 ? '0' + p[0] : p[0];
      var da = p[1].length < 2 ? '0' + p[1] : p[1];
      var yr = p[2].length === 2 ? '20' + p[2] : p[2];
      return yr + '-' + mo + '-' + da;
    }
  }
  return s;
}

// ----------------------------------------------------------------
// Column detection
// ----------------------------------------------------------------
function findColIndex(keys, patterns) {
  for (var ki = 0; ki < keys.length; ki++) {
    var upper = keys[ki].toUpperCase();
    for (var pi = 0; pi < patterns.length; pi++) {
      if (upper.indexOf(patterns[pi].toUpperCase()) !== -1) return keys[ki];
    }
  }
  return null;
}

// ----------------------------------------------------------------
// Process a chunk of raw rows into FlightRecords
// ----------------------------------------------------------------
function processChunk(rows, colMap) {
  var records = [];
  for (var ri = 0; ri < rows.length; ri++) {
    var row = rows[ri];
    var tailNumber, dateVal, takeoffAirport, landingAirport;
    var pfdTurn1, durationDerivative, durationExtTo99;
    var pfdTurn1Deg, pfeTo99Deg, landingDist30kn, landingDist50kn, gsAtAutoSbop;

    if (colMap.colTail) {
      dateVal = row[colMap.colDate || ''];
      tailNumber = String(row[colMap.colTail] || '').trim().toUpperCase();
      takeoffAirport = String(row[colMap.colTakeoff || ''] || '').trim().toUpperCase();
      landingAirport = String(row[colMap.colLanding || ''] || '').trim().toUpperCase();
      pfdTurn1 = parseNumberSmart(row[colMap.colPfd || '']);
      durationDerivative = parseNumberSmart(row[colMap.colDurDeriv || '']);
      durationExtTo99 = parseNumberSmart(row[colMap.colDurExt || '']);
      pfdTurn1Deg = parseNumberSmart(row[colMap.colPfdDeg || '']);
      pfeTo99Deg = parseNumberSmart(row[colMap.colPfeDeg || '']);
      landingDist30kn = parseNumberSmart(row[colMap.colLand30 || '']);
      landingDist50kn = parseNumberSmart(row[colMap.colLand50 || '']);
      gsAtAutoSbop = parseNumberSmart(row[colMap.colGs || '']);
    } else {
      var vals = Object.values(row);
      if (vals.length < 12) continue;
      dateVal = vals[0];
      tailNumber = String(vals[1] || '').trim().toUpperCase();
      takeoffAirport = String(vals[2] || '').trim().toUpperCase();
      landingAirport = String(vals[3] || '').trim().toUpperCase();
      pfdTurn1 = parseNumberSmart(vals[4]);
      durationDerivative = parseNumberSmart(vals[5]);
      durationExtTo99 = parseNumberSmart(vals[6]);
      pfdTurn1Deg = parseNumberSmart(vals[7]);
      pfeTo99Deg = parseNumberSmart(vals[8]);
      landingDist30kn = parseNumberSmart(vals[9]);
      landingDist50kn = parseNumberSmart(vals[10]);
      gsAtAutoSbop = parseNumberSmart(vals[11]);
    }

    if (!tailNumber || tailNumber.indexOf('TC-') !== 0) continue;

    var flightDate = parseDate(dateVal);
    var aircraftType = detectAircraftType(tailNumber);
    var isDoubledRecord = pfdTurn1 > 150;
    var normalizedPfd = isDoubledRecord
      ? pfdTurn1 / Math.round(pfdTurn1 / 100)
      : pfdTurn1;
    var durationRatio = durationDerivative > 0 ? durationExtTo99 / durationDerivative : 0;
    var landingDistAnomaly =
      landingDist30kn > 0 &&
      landingDist50kn > 0 &&
      landingDist50kn > landingDist30kn * 1.05;

    var partial = {
      flightDate: flightDate,
      tailNumber: tailNumber,
      takeoffAirport: takeoffAirport,
      landingAirport: landingAirport,
      pfdTurn1: pfdTurn1,
      durationDerivative: durationDerivative,
      durationExtTo99: durationExtTo99,
      pfdTurn1Deg: pfdTurn1Deg,
      pfeTo99Deg: pfeTo99Deg,
      landingDist30kn: landingDist30kn,
      landingDist50kn: landingDist50kn,
      gsAtAutoSbop: gsAtAutoSbop,
      aircraftType: aircraftType,
      isDoubledRecord: isDoubledRecord,
      normalizedPfd: normalizedPfd,
      durationRatio: durationRatio,
      landingDistAnomaly: landingDistAnomaly,
    };

    var anomaly = detectAnomaly(partial);
    partial.anomalyLevel = anomaly.level;
    partial.anomalyReasons = anomaly.reasons;
    records.push(partial);
  }
  return records;
}

// ----------------------------------------------------------------
// Main message handler
// ----------------------------------------------------------------
self.onmessage = function (e) {
  var msg = e.data;

  if (msg.type === 'parse') {
    try {
      self.postMessage({ type: 'progress', phase: 'reading', percent: 5 });

      var buffer = msg.buffer;
      var workbook = XLSX.read(buffer, {
        type: 'array',
        cellDates: true,
        cellStyles: false,
        cellFormula: false,
        cellHTML: false,
      });

      self.postMessage({ type: 'progress', phase: 'parsing', percent: 20 });

      // Collect all rows from all sheets
      var allRows = [];
      for (var si = 0; si < workbook.SheetNames.length; si++) {
        var sheetName = workbook.SheetNames[si];
        var sheet = workbook.Sheets[sheetName];
        var json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (json.length > 0) {
          for (var ji = 0; ji < json.length; ji++) {
            allRows.push(json[ji]);
          }
        }
      }

      self.postMessage({ type: 'progress', phase: 'parsing', percent: 40, recordCount: allRows.length });

      if (allRows.length === 0) {
        self.postMessage({ type: 'error', message: 'Excel dosyas\u0131 bo\u015f veya okunamad\u0131.' });
        return;
      }

      // Detect columns from first row
      var firstRow = allRows[0];
      var keys = Object.keys(firstRow);
      var colMap = {
        colDate: findColIndex(keys, ['FLIGHT_DATE', 'DATE', 'TARIH']),
        colTail: findColIndex(keys, ['TAIL_NUMBER', 'TAIL', 'KUYRUK']),
        colTakeoff: findColIndex(keys, ['TAKEOFF_AIRPORT', 'TAKEOFF', 'KALKIS']),
        colLanding: findColIndex(keys, ['LANDING_AIRPORT', 'LANDING_AIRPORT_CODE', 'INIS']),
        colPfd: findColIndex(keys, ['PFD_TURN_1)', 'PFD_TURN_1', 'SBLE_PFD_TURN_1)']),
        colDurDeriv: findColIndex(keys, ['DERIVATIVE_TURN_1', 'DURATION_BASED_ON_DERIVATIVE']),
        colDurExt: findColIndex(keys, ['EXTENSION_TO_99', 'DURATION_BASED_ON_EXTENSION']),
        colPfdDeg: findColIndex(keys, ['PFD_TURN_1_DEG', 'TURN_1_DEG)']),
        colPfeDeg: findColIndex(keys, ['PFE_TO_99_DEG', 'PFE_TO_99']),
        colLand30: findColIndex(keys, ['30_KNOT', 'FOR_30_KNOT', '30KN']),
        colLand50: findColIndex(keys, ['50_KNOT', 'FOR_50_KNOT', '50KN']),
        colGs: findColIndex(keys, ['GS_AT_AUTO', 'SBOP_SEC', 'GS_AT_AUTO_SBOP']),
      };

      // Process in chunks, posting progress
      var chunkSize = Math.max(5000, Math.min(15000, Math.floor(allRows.length / 6)));
      var records = [];

      for (var i = 0; i < allRows.length; i += chunkSize) {
        var end = Math.min(i + chunkSize, allRows.length);
        var chunk = allRows.slice(i, end);
        var parsed = processChunk(chunk, colMap);
        for (var pi = 0; pi < parsed.length; pi++) {
          records.push(parsed[pi]);
        }

        var pct = 40 + Math.round(((i + chunkSize) / allRows.length) * 55);
        self.postMessage({
          type: 'progress',
          phase: 'analyzing',
          percent: Math.min(pct, 97),
          recordCount: records.length,
        });
      }

      self.postMessage({ type: 'progress', phase: 'done', percent: 100, recordCount: records.length });
      self.postMessage({ type: 'result', records: records });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message || 'Worker parse error' });
    }
  }
};
