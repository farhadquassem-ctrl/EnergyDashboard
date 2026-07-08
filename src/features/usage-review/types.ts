// Shared types for the Usage Review tool (Bill OCR + anomaly detection).
// Strict TypeScript, no `any` — the Retail/Homeowner spec makes the anomaly
// engine and its output type a hard TS requirement even though the rest of the
// app is JSDoc-JS (see docs/ARCHITECTURE.md deviation #1 and tsconfig.json).

/** Which TOU rate plan the buckets came from — affects the advisory copy. */
export type RatePlan = 'TOU' | 'ULO' | 'TIERED' | 'UNKNOWN'

/**
 * One electricity bill's extracted, structured data — the unit the whole tab
 * reasons over. Produced by OCR (Phase 1) or the vision fallback (Phase 2),
 * always user-confirmable before it enters analysis. kWh buckets are the raw
 * period totals as printed on the bill (NOT daily averages — normalization to
 * daily happens inside the engine, because 27–33-day periods aren't directly
 * comparable).
 */
export interface Bill {
  /** Stable per-bill id (source filename + index, or a uuid) — the anomaly's anchor. */
  id: string
  /** Meter/account identifier; the timeline is grouped by this. */
  meterId: string
  /** Service period start, ISO `YYYY-MM-DD`. */
  startDate: string
  /** Service period end, ISO `YYYY-MM-DD`. */
  endDate: string
  /** Off-peak kWh for the whole period. */
  offPeakKwh: number
  /** Mid-peak kWh for the whole period. */
  midPeakKwh: number
  /** On-peak kWh for the whole period. */
  onPeakKwh: number
  /**
   * Total kWh for the period. Optional: when absent the engine derives it as
   * offPeak + midPeak + onPeak. Present when the bill prints a separate total
   * (e.g. tiered/ULO bills whose buckets don't sum to the TOU three).
   */
  totalKwh?: number
  /** Total billed amount ($) — carried for display; not used by the engine. */
  totalBilledAmount: number
  /** Rate plan, when known — only changes advisory wording. */
  ratePlan?: RatePlan
  /** How this bill's data was obtained — surfaced in the UI, not used in math. */
  source?: 'ocr' | 'vision' | 'manual'
}

/** A single bill after Step-0 normalization to per-day averages. */
export interface NormalizedBill {
  bill: Bill
  billingDays: number
  totalKwh: number
  dailyTotalKwh: number
  dailyOnPeakKwh: number
  dailyMidPeakKwh: number
  dailyOffPeakKwh: number
}

export type AnomalyType = 'VOLUME_SPIKE' | 'PEAK_HEAVY' | 'RAPID_INCREASE'
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * The engine's output row — one detected anomaly on one bill. The UI maps over
 * `Anomaly[]` to render conditional warning badges next to the matching billing
 * period on the chart, keyed by `billId`.
 */
export interface Anomaly {
  type: AnomalyType
  severity: Severity
  billId: string
  message: string
  /** % variance / % delta for UI badges (already ×100, e.g. 42 = +42%). */
  metric?: number
}

/** Tunables for {@link import('./analyzeAnomalies').analyzeAnomalies}, all defaulted to the spec. */
export interface AnomalyOptions {
  /** Check 1 trigger: modified Z-score above this flags VOLUME_SPIKE (default 1.5). */
  volumeZThreshold?: number
  /** Check 2 trigger: currentOnPeakPct above historical × this flags PEAK_HEAVY (default 1.3). */
  peakShiftFactor?: number
  /** Check 3 trigger: month-over-month daily delta above this flags RAPID_INCREASE (default 0.25). */
  velocityDeltaThreshold?: number
  /** Dataset size at/above which Check 3 compares to N−12 (YoY) instead of N−1 (default 12). */
  seasonalWindow?: number
}
