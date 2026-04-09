// ============================================================
// B737 Speedbrake Predictive Maintenance — Legacy data helpers
// This file is kept for backward compatibility.
// Primary data flow: Excel Upload → parseExcelData (lib/utils.ts)
// ============================================================

import { FlightRecord } from './types';
import { detectAircraftType, detectAnomaly } from './utils';

/**
 * Detect aircraft type from tail number
 */
export function getAircraftType(tail: string): 'NG' | 'MAX' {
  return detectAircraftType(tail);
}

/**
 * Get field descriptions for tooltips and information panels
 */
export function getFieldDescriptions(): Record<string, string> {
  return {
    'PFD Turn 1 (%)': 'Speedbrake Percent Full Deployment — Turn 1. İlk hareket emrinden sonra hedefe ulaşma yüzdesi. ~100 normal, >150 çift panel açılma şüphesi.',
    'Duration Derivative (s)': 'Türev tabanlı açılma süresi. Speedbrake hareket hızının türevinden hesaplanan süre. Düşük = hızlı yanıt.',
    'Duration Ext to 99% (s)': 'Speedbrake %99 açılma pozisyonuna ulaşma süresi. Uzun süre = actuator yavaşlaması veya hidrolik basınç düşüklüğü.',
    'PFD Turn 1 Açısı (°)': 'İlk hareket açısı (derece). NG: 45-47°, MAX: 48° civarı normal. Çift panel ~92° olabilir.',
    'PFE to 99% Açısı (°)': 'Speedbrake %99 konumundaki açı değeri. PFD Turn 1 açısına yakın olmalı.',
    'İniş Mesafesi 30kn (m)': 'Uçak 30 knot hıza düşene kadar geçen mesafe. Speedbrake performansından doğrudan etkilenir.',
    'İniş Mesafesi 50kn (m)': 'Uçak 50 knot hıza düşene kadar geçen mesafe. Her zaman 30kn mesafesinden kısa olmalı.',
    'GS at Auto SBOP (s)': 'Ground spoiler otomatik açılma zamanı (SOF — Start of Flight referanslı). Yüksek = uzun mesafe uçuşu, çok düşük = erken açılma şüphesi.',
  };
}

/**
 * Key relationships between parameters — used for insight generation
 */
export const KEY_RELATIONSHIPS = {
  PFD_VS_DEG: {
    description: 'PFD_TURN_1 ↔ PFD_TURN_1_DEG & PFE_TO_99_DEG',
    normal: 'PFD ~100 → DEG 45-48° (NG) veya 48° (MAX)',
    anomaly: 'PFD düşük + DEG düşük → mekanik arıza; PFD düşük + DEG yükselerek gelen → yavaş açılma',
  },
  DURATION_RATIO: {
    description: 'Duration Derivative ↔ Duration Extension to 99',
    normal: 'extension_to_99 ≤ derivative veya çok yakın',
    anomaly: 'ext_to_99 >> derivative → hidrolik direnç veya mekanik engel',
  },
  PFD_VS_LANDING: {
    description: 'PFD_TURN_1 ↔ Landing Distance',
    normal: 'Tam açılma → yeterli sürükleme (drag) → normal iniş mesafesi',
    anomaly: 'Düşük PFD + uzun iniş mesafesi → yetersiz speedbrake etkinliği',
  },
  LANDING_30_VS_50: {
    description: 'Landing Distance 30kn ↔ Landing Distance 50kn',
    normal: 'distance_30kn > distance_50kn (30 knot\u0027a düşmek daha uzun mesafe)',
    anomaly: 'distance_50kn > distance_30kn → sensör hatası veya fren sistemi anomalisi',
  },
  GS_VS_DISTANCE: {
    description: 'GS at Auto SBOP ↔ Uçuş Mesafesi',
    normal: 'Kısa mesafe: düşük GS, Uzun mesafe: yüksek GS',
    anomaly: 'Uzun mesafe uçuşta çok düşük GS → erken açılma veya veri hatası',
  },
  NG_VS_MAX: {
    description: 'NG vs MAX Farkları',
    normal: 'MAX: DEG=48° sabit, duration daha uniform; NG: DEG 45-47° değişken',
    anomaly: 'Belirgin sapma → uçak tipine özel sorun',
  },
} as const;
