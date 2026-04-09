// ============================================================
// B737 Speedbrake Predictive Maintenance — Shared Types
// ============================================================

/** One row coming out of the uploaded Excel file after parsing */
export interface FlightRecord {
  flightDate: string;        // ISO yyyy-mm-dd
  tailNumber: string;        // e.g. TC-SPB
  takeoffAirport: string;    // IATA code
  landingAirport: string;    // IATA code
  pfdTurn1: number;          // raw PFD Turn 1 %
  durationDerivative: number;// seconds
  durationExtTo99: number;   // seconds
  pfdTurn1Deg: number;       // degrees
  pfeTo99Deg: number;        // degrees
  landingDist30kn: number;   // metres
  landingDist50kn: number;   // metres
  gsAtAutoSbop: number;      // seconds from SOF
  aircraftType: 'NG' | 'MAX';
  anomalyLevel: 'normal' | 'warning' | 'critical';
  anomalyReasons: string[];
  /** Source tag: which signal(s) drove the anomaly classification */
  anomalySource: 'speedbrake' | 'sensor' | 'mixed' | 'none';
  // ---- computed helpers ----
  isDoubledRecord: boolean;  // PFD > 150 → probably two panels summed
  normalizedPfd: number;     // doubled records divided back
  durationRatio: number;     // extTo99 / derivative
  landingDistAnomaly: boolean; // 50kn > 30kn
}

/** Aggregated KPI summary for the currently-filtered data set */
export interface AnomalySummary {
  totalFlights: number;
  criticalCount: number;
  warningCount: number;
  normalCount: number;
  /** Sensor-only warnings (landing distance inversion, not speedbrake) */
  sensorOnlyWarningCount: number;
  uniqueTails: number;
  uniqueNGTails: number;
  uniqueMAXTails: number;
  avgPFD: number;
  problematicTails: string[];
  avgDeg: number;
  avgDuration: number;
  avgLandingDist: number;
  doubledRecords: number;
  landingDistAnomalyCount: number;
  avgDurationRatio: number;
  slowOpeningCount: number;
  mechanicalFailureCount: number;
}

/** Filter state shared between all dashboard views */
export interface FilterState {
  dateRange: [string, string] | null;
  tails: string[];
  aircraftType: 'ALL' | 'NG' | 'MAX';
  anomalyLevel: 'ALL' | 'normal' | 'warning' | 'critical';
  airport: string;
}

/** Per-tail health score produced by analytics */
export interface TailHealthScore {
  tailNumber: string;
  aircraftType: 'NG' | 'MAX';
  totalFlights: number;
  avgPfd: number;
  avgDeg: number;
  avgDurationDeriv: number;
  avgDurationExt: number;
  avgLanding30: number;
  avgLanding50: number;
  criticalCount: number;
  warningCount: number;
  healthScore: number;           // 0-100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  trend: 'improving' | 'stable' | 'degrading';
  durationRatioAvg: number;
  landingDistAnomalyRate: number;
  lastFlightDate: string;
  degradationRate: number;       // PFD drop first→second half
}

/** A single predictive-maintenance insight card */
export interface PredictiveInsight {
  id: string;
  tailNumber: string;
  category: 'hydraulic' | 'mechanical' | 'sensor' | 'actuator' | 'operational';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  evidence: string[];
  recommendation: string;
  relatedFlights: number;
  confidence: number;            // 0-100
}

/** Landing-distance detail row */
export interface LandingDistanceAnalysisRecord {
  tailNumber: string;
  route: string;
  date: string;
  dist30kn: number;
  dist50kn: number;
  pfd: number;
  deg: number;
  anomalyType: 'normal' | '50kn_exceeds_30kn' | 'excessive_distance' | 'pfd_correlation';
  riskScore: number;
}

/** Single entry for timeline view */
export interface FlightTimelineEntry {
  date: string;
  tailNumber: string;
  route: string;
  pfd: number;
  deg: number;
  durationRatio: number;
  anomalyLevel: 'normal' | 'warning' | 'critical';
  reasons: string[];
  landingDist30: number;
  landingDist50: number;
  gsAtSbop: number;
}
