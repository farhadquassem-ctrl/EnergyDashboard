// Pure logic for the Peak Forecast tab — no React, unit-testable (the
// contract's calculations.ts). Rendering lives in components/; data access in
// lib/ieso/peakForecast.js.

// Candidate peak band is HE11–HE22 => interval-start hours 10..21.
export const BAND_START = 10
export const BAND_END = 21

/** Position/width on the 24h rail as a CSS percentage. */
export const pct = (h) => `${(h / 24) * 100}%`

export const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-CA'))

export function fmtDay(iso) {
  // Noon local avoids any date rollover from timezone offset.
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function relTime(iso) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 60) return `${Math.max(0, mins)} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.round(hrs / 24)} days ago`
}

// Categorical confidence tiers from the pipeline (see types/market.js
// GAForecast note: no numeric probabilities yet).
export const CONF = {
  moderate: { label: 'Moderate', cls: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500', w: '68%' },
  low: { label: 'Low', cls: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', w: '42%' },
  'very low': { label: 'Very low', cls: 'text-red-600 dark:text-red-400', bar: 'bg-red-500', w: '22%' },
}

// The 3/7/14-day views are nested subsets keyed on daysOut.
export const HORIZON_OPTS = [3, 7, 14]

/** Predicted peaks within the horizon, soonest first. */
export function filterPeaksByHorizon(predictedPeaks, horizon) {
  return (predictedPeaks ?? [])
    .filter((p) => p.daysOut <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))
}
