// Deterministic sample bills so the tab renders and the anomaly engine has
// something to chew on before anyone uploads a photo (mirrors the GA tab's
// "Load sample profile"). 14 monthly TOU bills for one meter, Jun 2025 → Jul
// 2026, with a seasonal shape and a deliberate final-month event: a hot July
// that is both peak-heavy AND ~32% above the previous July — the latter is what
// trips RAPID_INCREASE under the ≥12-bill year-over-year rule (not the May→Jul
// seasonal ramp, which the rule intentionally ignores).

import { DateTime } from 'luxon'

//                Jun25 Jul25 Aug25 Sep25 Oct25 Nov25 Dec25 Jan26 Feb26 Mar26 Apr26 May26 Jun26 Jul26
const DAILY_KWH = [28, 34, 33, 27, 24, 26, 32, 34, 33, 27, 24, 25, 30, 45]
const ON_PCT = [0.18, 0.20, 0.20, 0.18, 0.17, 0.18, 0.19, 0.20, 0.20, 0.18, 0.17, 0.18, 0.19, 0.35]

export function sampleBills() {
  const start0 = DateTime.fromISO('2025-06-01')
  return DAILY_KWH.map((daily, i) => {
    const start = start0.plus({ months: i })
    const end = start.plus({ days: 30 }) // 30-day periods keep the sample tidy
    const total = daily * 30
    const on = Math.round(total * ON_PCT[i])
    const mid = Math.round(total * 0.22)
    const off = total - on - mid
    return {
      id: `sample-${String(i).padStart(2, '0')}`,
      meterId: 'SAMPLE-METER-001',
      startDate: start.toISODate(),
      endDate: end.toISODate(),
      offPeakKwh: off,
      midPeakKwh: mid,
      onPeakKwh: on,
      totalBilledAmount: Math.round(total * 0.16 * 100) / 100,
      ratePlan: 'TOU',
      source: 'manual',
    }
  })
}
