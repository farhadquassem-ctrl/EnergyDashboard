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

// Categorical confidence tiers from the pipeline. RELATIVE rungs: the label is
// gated on the peak's normalized per-lead percentile ("top-ranked vs history at
// this lead"), NOT the absolute P(top-5) — so components must keep the numeric
// probability visible next to the word ("High (P=6%)"). 'very low' is retired
// but kept mapping to the low tier so older forecast.json still renders.
export const CONF = {
  high: { label: 'High', cls: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', w: '85%' },
  moderate: { label: 'Moderate', cls: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500', w: '58%' },
  low: { label: 'Low', cls: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', w: '30%' },
  'very low': { label: 'Low', cls: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', w: '30%' },
}

/** "62%" from a 0–1 probability; null-safe ("—") for pre-calibration files. */
export const fmtProb = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`)

// The 3/7/14-day views are nested subsets keyed on daysOut.
export const HORIZON_OPTS = [3, 7, 14]

/** Predicted peaks within the horizon, soonest first. */
export function filterPeaksByHorizon(predictedPeaks, horizon) {
  return (predictedPeaks ?? [])
    .filter((p) => p.daysOut <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))
}
