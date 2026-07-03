// Surrogate N-day-ahead weather "forecast" built purely from history:
// climatology + decaying anomaly persistence. No network, no NWP model.
//
//   forecastTemp(target, leadDays) =
//     climo(dayOfYear, hour) + recentAnomaly(issueTime) * exp(-leadDays / TAU)
//
// Why this exists: a real 3/7/14-day-ahead peak forecast needs *forecast*
// weather as model input (on the day you'd run it, the target day's temp_c
// isn't observed yet). ECCC publishes a real public forecast feed (citypage
// XML, ~7 days out — see fetch_forecast.js) for live runs, but publishes NO
// public archive of past forecasts, so historical backtests can't use the
// real feed. This surrogate is the honest stand-in for both:
//   * backtesting all horizons (backtest_horizons.js) — the same surrogate is
//     evaluated at every lead, so the accuracy-vs-lead curve is real, not
//     assumed;
//   * live 14-day forecasts, where no public ECCC product reaches anyway.
// It must always be labelled climatology/persistence in output — never
// presented as an actual weather forecast.
//
// Components:
//   * Climatology: mean temp/wind per (day-of-year, hour-of-day) over the
//     supplied history, smoothed with a ±CLIMO_WINDOW_DAYS day-of-year window
//     (a 1-2 year history is thin; the window is what makes bins usable).
//   * Anomaly persistence: today's departure from climatology carries some
//     information about the next few days, decaying with lead time. The decay
//     is exponential with e-folding constant TAU (days). TAU=5 is a standard
//     synoptic-persistence scale, deliberately NOT tuned against this
//     dataset's peak-recall numbers — tuning it to flatten the degradation
//     curve would defeat the point of measuring degradation.
//   * Wind: climatology only. Wind anomalies decorrelate in ~a day, so a
//     multi-day persistence term would be noise dressed up as signal.

import { DateTime } from 'luxon'
import { utcHourKey } from './lib/time.js'

export const ANOMALY_TAU_DAYS = Number(process.env.FORECAST_ANOMALY_TAU_DAYS ?? 5)
const CLIMO_WINDOW_DAYS = 7
const ANOMALY_LOOKBACK_HOURS = 24
const MIN_ANOMALY_OBS = 12 // below this, fall back to anomaly=0 (pure climatology)

const DOY_MAX = 366

// rows: dataset rows with { timestamp, temp_c, wind_kmh } (nulls tolerated).
// Returns lookup functions over the smoothed (day-of-year, hour) bins.
export function buildClimatology(rows) {
  // raw sums per (doy-1, hour)
  const mk = () => Array.from({ length: DOY_MAX }, () => new Array(24).fill(0))
  const tSum = mk(), tN = mk(), wSum = mk(), wN = mk()

  for (const r of rows) {
    const dt = DateTime.fromISO(r.timestamp, { setZone: true })
    if (!dt.isValid) continue
    const d = dt.ordinal - 1
    const h = dt.hour
    if (r.temp_c !== null && r.temp_c !== '') { tSum[d][h] += Number(r.temp_c); tN[d][h]++ }
    if (r.wind_kmh !== null && r.wind_kmh !== '') { wSum[d][h] += Number(r.wind_kmh); wN[d][h]++ }
  }

  // smooth: mean over doy±window (wrapping the year boundary), same hour
  const smooth = (sum, n) => {
    const out = Array.from({ length: DOY_MAX }, () => new Array(24).fill(null))
    for (let d = 0; d < DOY_MAX; d++) {
      for (let h = 0; h < 24; h++) {
        let s = 0, c = 0
        for (let k = -CLIMO_WINDOW_DAYS; k <= CLIMO_WINDOW_DAYS; k++) {
          const dd = (d + k + DOY_MAX) % DOY_MAX
          s += sum[dd][h]
          c += n[dd][h]
        }
        if (c > 0) out[d][h] = s / c
      }
    }
    return out
  }

  const temp = smooth(tSum, tN)
  const wind = smooth(wSum, wN)

  return {
    tempAt: (easternDt) => temp[easternDt.ordinal - 1][easternDt.hour],
    windAt: (easternDt) => wind[easternDt.ordinal - 1][easternDt.hour],
  }
}

// Index observed rows by UTC hour key for the anomaly lookback.
export function indexObservationsByUtcHour(rows) {
  const map = new Map()
  for (const r of rows) {
    const dt = DateTime.fromISO(r.timestamp, { setZone: true })
    if (dt.isValid) map.set(utcHourKey(dt), { dt, temp_c: r.temp_c })
  }
  return map
}

// Mean (observed - climatology) temp over the 24h strictly before issueTime.
// Only uses observations BEFORE the issue time — this is what makes the
// backtest walk-forward-clean: nothing from the forecast target's future (or
// present) leaks into the forecast.
// Returns { tempAnomaly, hoursUsed }; tempAnomaly=0 when too few obs.
export function anomalyAt(obsByKey, issueEasternDt, climatology) {
  let s = 0, n = 0
  for (let back = 1; back <= ANOMALY_LOOKBACK_HOURS; back++) {
    const at = issueEasternDt.minus({ hours: back })
    const obs = obsByKey.get(utcHourKey(at))
    if (!obs || obs.temp_c === null || obs.temp_c === '') continue
    const climo = climatology.tempAt(obs.dt)
    if (climo === null) continue
    s += Number(obs.temp_c) - climo
    n++
  }
  if (n < MIN_ANOMALY_OBS) return { tempAnomaly: 0, hoursUsed: n }
  return { tempAnomaly: s / n, hoursUsed: n }
}

export function anomalyDecay(leadDays) {
  return Math.exp(-leadDays / ANOMALY_TAU_DAYS)
}

// The surrogate forecast for one target hour at a given lead time.
// Returns null when climatology has no bin for the target (shouldn't happen
// with a >=1-year history, but don't fabricate a number if it does).
export function surrogateWeather({ climatology, tempAnomaly, leadDays, targetEasternDt }) {
  const climoTemp = climatology.tempAt(targetEasternDt)
  if (climoTemp === null) return null
  return {
    temp_c: climoTemp + tempAnomaly * anomalyDecay(leadDays),
    wind_kmh: climatology.windAt(targetEasternDt), // may be null; caller decides
    source: 'climatology+persistence',
  }
}
