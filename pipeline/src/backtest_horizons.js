// Multi-horizon peak backtest: how well does the model flag peak days/hours
// when its weather inputs are a 3/7/14-day-ahead FORECAST instead of the
// same hour's observed weather (which backtest.js v1 uses, per its caveat)?
//
// Weather at each lead comes from the climatology + anomaly-persistence
// surrogate (forecast_weather.js) — NOT a real archived NWP forecast, because
// ECCC publishes no public archive of past forecasts to backtest against
// (CaSPAr, the research archive, is registration-gated and out of scope).
// Consequences, stated plainly:
//   * The accuracy-vs-lead degradation measured here is REAL — each lead is
//     evaluated with exactly the information available that many days ahead.
//   * Short-lead numbers (especially 3-day) are likely a LOWER BOUND on what
//     the live path achieves, since live runs use the actual ECCC citypage
//     forecast (fetch_forecast.js), and a real NWP forecast beats anomaly
//     persistence at 3-7 days. 14-day live uses this same surrogate, so the
//     14-day number here is the honest expectation, not a lower bound.
//
// Walk-forward hygiene: model + climatology are fit only on base years before
// the test year; the persistence anomaly uses only observations strictly
// before each forecast's issue time (target - leadDays).
//
// Inherited from v1 (kept for comparability): days are ranked season-level
// (top FLAGGED_DAYS_PER_YEAR per base year) rather than re-ranked on each
// rolling issue date, and leadDays=0 (observed weather) is included as the
// baseline row of the degradation curve — it reproduces v1's numbers.
//
// Output: pipeline/data/backtest_horizons.json

import { writeFileSync, mkdirSync } from 'node:fs'
import { DateTime } from 'luxon'
import { FILES, DATA_DIR, FORECAST_LEAD_DAYS } from './config.js'
import { fitModel, predict, isCandidateRow, CANDIDATE_HOUR_RANGE } from './peak_model.js'
import {
  RISK_PROFILES, FLAGGED_DAYS_PER_YEAR,
  loadDataset, groupByDay, windowHoursForDay, fmtPct,
} from './backtest.js'
import {
  buildClimatology, indexObservationsByUtcHour, anomalyAt, surrogateWeather, ANOMALY_TAU_DAYS,
} from './forecast_weather.js'
import { isMain } from './lib/is-main.js'

// Evaluate one (test year, lead) pair. For leadDays=0 the row's observed
// weather is used unchanged (v1 baseline).
function evaluateLead({ model, climatology, obsByKey, testRows, leadDays }) {
  const anomalyCache = new Map() // per issue hour

  // Build the candidate set as it would look at forecast time: swap in the
  // forecast weather, THEN apply the candidate filter (hour band + forecast
  // temp extremity). Filtering on observed temp here would leak the answer.
  const hourBandRows = testRows.filter((r) => {
    const h = Number(r.hour_of_day)
    return h >= CANDIDATE_HOUR_RANGE.minHour && h <= CANDIDATE_HOUR_RANGE.maxHour
  })

  const candidates = []
  for (const r of hourBandRows) {
    let fcRow
    if (leadDays === 0) {
      if (!isCandidateRow(r)) continue
      fcRow = r
    } else {
      const target = DateTime.fromISO(r.timestamp, { setZone: true })
      const issue = target.minus({ days: leadDays })
      const issueKey = issue.toISO()
      let anom = anomalyCache.get(issueKey)
      if (anom === undefined) {
        anom = anomalyAt(obsByKey, issue, climatology).tempAnomaly
        anomalyCache.set(issueKey, anom)
      }
      const fc = surrogateWeather({ climatology, tempAnomaly: anom, leadDays, targetEasternDt: target })
      if (!fc) continue
      fcRow = { ...r, temp_c: fc.temp_c, wind_kmh: fc.wind_kmh ?? r.wind_kmh }
      if (!isCandidateRow(fcRow)) continue
    }
    candidates.push({ ...fcRow, predicted: predict(model, fcRow) })
  }

  const dayGroups = [...groupByDay(candidates).entries()].map(([day, rows]) => ({
    day,
    rows,
    topPredicted: Math.max(...rows.map((x) => x.predicted)),
  }))
  dayGroups.sort((a, b) => b.topPredicted - a.topPredicted)
  const flaggedDays = dayGroups.slice(0, FLAGGED_DAYS_PER_YEAR)

  // Denominator: every actual official peak hour in the test year's hour band,
  // regardless of whether the forecast weather kept it in the candidate set —
  // a peak the forecast filtered out is a genuine miss, not an exclusion.
  const actualTop5 = hourBandRows.filter((r) => r.is_top5_peak === 1)
  const actualTop10 = hourBandRows.filter((r) => r.is_top10_peak === 1)

  const flaggedDaySet = new Set(flaggedDays.map((d) => d.day))
  const top5DayHits = new Set(actualTop5.filter((r) => flaggedDaySet.has(r.day)).map((r) => r.day)).size
  const top5Days = new Set(actualTop5.map((r) => r.day)).size

  const profileResults = RISK_PROFILES.map(({ profile, windowHours }) => {
    let top5Hits = 0
    let top10Hits = 0
    for (const { day, rows } of flaggedDays) {
      const hours = windowHoursForDay(rows, windowHours)
      if (actualTop5.some((r) => r.day === day && hours.has(r.hour_of_day))) top5Hits++
      if (actualTop10.some((r) => r.day === day && hours.has(r.hour_of_day))) top10Hits++
    }
    return {
      profile,
      windowHours,
      top5Recall: actualTop5.length ? top5Hits / actualTop5.length : null,
      top10Recall: actualTop10.length ? top10Hits / actualTop10.length : null,
      curtailmentHours: flaggedDays.length * windowHours,
    }
  })

  return {
    leadDays,
    weatherSource: leadDays === 0 ? 'observed (v1 baseline)' : 'climatology+persistence surrogate',
    candidateHours: candidates.length,
    top5DayRecall: top5Days ? top5DayHits / top5Days : null, // day flagged at all, before windowing
    profileResults,
  }
}

export function runHorizonBacktest() {
  const rows = loadDataset() // rows already carry .day and .baseYear
  const years = [...new Set(rows.map((r) => r.baseYear))].sort((a, b) => a - b)
  const leads = [0, ...FORECAST_LEAD_DAYS]
  const results = []

  console.log(`horizon backtest: leads=[${leads.join(', ')}] days, anomaly tau=${ANOMALY_TAU_DAYS}d`)

  for (const testYear of years) {
    const trainingRows = rows.filter((r) => r.baseYear < testYear)
    if (trainingRows.length === 0) {
      console.log(`${testYear}: no prior base years -- training-only, not evaluated`)
      continue
    }
    const testRows = rows.filter((r) => r.baseYear === testYear)
    const model = fitModel(trainingRows.filter(isCandidateRow))
    const climatology = buildClimatology(trainingRows)
    // Anomaly lookback may reach before the test year's start; index everything
    // (anomalyAt only ever reads hours strictly before each issue time).
    const obsByKey = indexObservationsByUtcHour(rows)

    const horizons = leads.map((leadDays) =>
      evaluateLead({ model, climatology, obsByKey, testRows, leadDays }),
    )
    results.push({ baseYear: testYear, r2: model.r2, horizons })

    console.log(`\n${testYear} (train R²=${model.r2.toFixed(3)}):`)
    for (const h of horizons) {
      const balanced = h.profileResults.find((p) => p.profile === 'Balanced')
      console.log(
        `  lead ${String(h.leadDays).padStart(2)}d [${h.weatherSource}]: ` +
          `day-recall=${fmtPct(h.top5DayRecall)}  ` +
          `Balanced top5=${fmtPct(balanced.top5Recall)} top10=${fmtPct(balanced.top10Recall)}`,
      )
    }
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.backtestHorizons, JSON.stringify(results, null, 2))
  console.log(`\nbacktest_horizons: wrote ${results.length} base years -> ${FILES.backtestHorizons}`)
  return results
}

if (isMain(import.meta.url)) {
  try {
    runHorizonBacktest()
  } catch (e) {
    console.error('backtest_horizons failed:', e.message)
    process.exit(1)
  }
}
