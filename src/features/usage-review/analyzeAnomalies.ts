// analyzeAnomalies — the Usage Review anomaly engine (Phase 4).
//
// Strict TypeScript, no `any` (spec non-negotiable). Pure: no I/O, no React —
// mirrors the GA Exposure tab's calculations.js so all business logic stays
// unit-testable in isolation (see analyzeAnomalies.test.ts for the hand-worked
// ground truth). Input is an array of bills the caller has already sorted
// chronologically; output is Anomaly[] the UI maps to per-period badges.

import type {
  Bill, NormalizedBill, Anomaly, AnomalyType, Severity, AnomalyOptions,
} from './types.ts'

const MS_PER_DAY = 86_400_000

const DEFAULTS = {
  volumeZThreshold: 1.5,
  peakShiftFactor: 1.3,
  velocityDeltaThreshold: 0.25,
  seasonalWindow: 12,
} as const

// ---------------------------------------------------------------------------
// Step 0 — normalization (REQUIRED before any comparison)
// ---------------------------------------------------------------------------

/**
 * Billing periods run 27–33 days, so raw period totals are not comparable —
 * everything downstream runs on per-day averages. `billingDays` is the calendar
 * difference End − Start (a 2024-01-01 → 2024-01-31 bill = 30 days); a bill
 * whose dates are missing/inverted is clamped to ≥1 day so we never divide by
 * zero or go negative. `totalKwh` falls back to the sum of the three TOU buckets
 * when the bill didn't carry an explicit total.
 */
export function normalizeBill(bill: Bill): NormalizedBill {
  const start = Date.parse(bill.startDate)
  const end = Date.parse(bill.endDate)
  const rawDays =
    Number.isFinite(start) && Number.isFinite(end)
      ? Math.round((end - start) / MS_PER_DAY)
      : NaN
  const billingDays = Number.isFinite(rawDays) && rawDays >= 1 ? rawDays : 1

  const totalKwh =
    bill.totalKwh != null && Number.isFinite(bill.totalKwh)
      ? bill.totalKwh
      : bill.offPeakKwh + bill.midPeakKwh + bill.onPeakKwh

  return {
    bill,
    billingDays,
    totalKwh,
    dailyTotalKwh: totalKwh / billingDays,
    dailyOnPeakKwh: bill.onPeakKwh / billingDays,
    dailyMidPeakKwh: bill.midPeakKwh / billingDays,
    dailyOffPeakKwh: bill.offPeakKwh / billingDays,
  }
}

// ---------------------------------------------------------------------------
// small numeric helpers (typed, total)
// ---------------------------------------------------------------------------

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** Population standard deviation (÷N). Chosen over sample (÷N−1) for stability
 *  on the tiny datasets a household accumulates; documented, not silent. */
function stdDev(xs: readonly number[], mu: number): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += (x - mu) ** 2
  return Math.sqrt(s / xs.length)
}

const pct = (ratio: number): number => Math.round(ratio * 1000) / 10 // one decimal, ×100

// ---------------------------------------------------------------------------
// severity ladders (magnitude past each trigger → LOW / MEDIUM / HIGH)
// ---------------------------------------------------------------------------

function severityByZ(z: number): Severity {
  if (z > 3) return 'HIGH'
  if (z > 2) return 'MEDIUM'
  return 'LOW'
}

function severityByExcess(ratio: number): Severity {
  // ratio = how far past the trigger multiple, e.g. current/(historical×factor)
  if (ratio > 1.5) return 'HIGH'
  if (ratio > 1.2) return 'MEDIUM'
  return 'LOW'
}

function severityByDelta(delta: number): Severity {
  if (delta > 0.75) return 'HIGH'
  if (delta > 0.5) return 'MEDIUM'
  return 'LOW'
}

// ---------------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------------

/**
 * Detect usage anomalies across a chronologically-sorted array of bills.
 * Returns every triggered anomaly (a bill can raise more than one), ordered by
 * bill position then check number, so the UI can render badges per period.
 *
 * Checks (all on Step-0 daily averages):
 *  1. VOLUME_SPIKE  — modified Z-score of dailyTotalKwh > 1.5
 *  2. PEAK_HEAVY    — currentOnPeakPct > historicalOnPeakPct × 1.3
 *  3. RAPID_INCREASE— dailyTotalKwh up > 25% vs prior bill (or vs N−12 when
 *                     the dataset has ≥12 bills, so seasonal swings don't fire)
 */
export function analyzeAnomalies(bills: readonly Bill[], options: AnomalyOptions = {}): Anomaly[] {
  const opt = { ...DEFAULTS, ...options }
  if (bills.length === 0) return []

  const norm: NormalizedBill[] = bills.map(normalizeBill)
  const out: Anomaly[] = []

  // --- dataset-wide stats -------------------------------------------------
  const dailyTotals = norm.map((n) => n.dailyTotalKwh)
  const mu = mean(dailyTotals)
  const sigma = stdDev(dailyTotals, mu)

  const sumTotal = norm.reduce((s, n) => s + n.totalKwh, 0)
  const sumOnPeak = norm.reduce((s, n) => s + n.bill.onPeakKwh, 0)
  const historicalOnPeakPct = sumTotal > 0 ? sumOnPeak / sumTotal : 0

  // --- per-bill checks (accumulate per bill, then flush in check order) ----
  for (let i = 0; i < norm.length; i++) {
    const n = norm[i]!
    const perBill: Anomaly[] = []

    // Check 1 — Volume Spike (modified Z-score). sigma===0 => flat dataset,
    // no spikes. Only positive excursions are "spikes".
    if (sigma > 0) {
      const z = (n.dailyTotalKwh - mu) / sigma
      if (z > opt.volumeZThreshold) {
        const variance = mu > 0 ? (n.dailyTotalKwh - mu) / mu : 0
        perBill.push(mk('VOLUME_SPIKE', severityByZ(z), n.bill.id,
          `Daily usage was ${pct(variance)}% higher than your historical average.`,
          pct(variance)))
      }
    }

    // Check 2 — TOU Proportion Shift (baseload deviation). Proportion is
    // scale-free, so raw period kWh and daily averages give the same ratio.
    const billTotal = n.totalKwh
    if (historicalOnPeakPct > 0 && billTotal > 0) {
      const currentOnPeakPct = n.bill.onPeakKwh / billTotal
      const trigger = historicalOnPeakPct * opt.peakShiftFactor
      if (currentOnPeakPct > trigger) {
        const excess = currentOnPeakPct / trigger
        const aboveHist = currentOnPeakPct / historicalOnPeakPct - 1
        perBill.push(mk('PEAK_HEAVY', severityByExcess(excess), n.bill.id,
          `On-peak share (${pct(currentOnPeakPct)}%) ran ${pct(aboveHist)}% above your usual mix. ` +
          `Shift high-draw appliances (EV charging, laundry, dishwasher) to after 7:00 PM` +
          `${n.bill.ratePlan === 'ULO' ? ', or into the Ultra-Low Overnight window (after 11 PM).' : ' — or consider the Ultra-Low Overnight (ULO) plan.'}`,
          pct(aboveHist)))
      }
    }

    // Check 3 — Velocity / month-over-month. With ≥12 bills, compare to the
    // same period last year (N−12) so summer-cooling / winter-heating swings
    // don't false-trigger; otherwise compare to the immediately prior bill.
    const seasonal = norm.length >= opt.seasonalWindow
    const refIdx = seasonal ? i - opt.seasonalWindow : i - 1
    if (refIdx >= 0) {
      const prev = norm[refIdx]!
      if (prev.dailyTotalKwh > 0) {
        const delta = (n.dailyTotalKwh - prev.dailyTotalKwh) / prev.dailyTotalKwh
        if (delta > opt.velocityDeltaThreshold) {
          perBill.push(mk('RAPID_INCREASE', severityByDelta(delta), n.bill.id,
            `Daily usage jumped ${pct(delta)}% versus ${seasonal ? 'the same period last year' : 'your previous bill'}.`,
            pct(delta)))
        }
      }
    }

    // flush in deterministic check order (VOLUME_SPIKE, PEAK_HEAVY, RAPID_INCREASE)
    perBill.sort((a, b) => ORDER[a.type] - ORDER[b.type])
    out.push(...perBill)
  }

  return out
}

const ORDER: Record<AnomalyType, number> = {
  VOLUME_SPIKE: 0,
  PEAK_HEAVY: 1,
  RAPID_INCREASE: 2,
}

function mk(type: AnomalyType, severity: Severity, billId: string, message: string, metric: number): Anomaly {
  return { type, severity, billId, message, metric }
}
