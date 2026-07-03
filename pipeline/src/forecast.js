// Step F2: the live multi-horizon peak forecast. For each configured lead
// time (default 3/7/14 days), forecast the target day's peak-demand hour and
// emit one record per lead — lead time is a first-class axis of the output,
// separate from the risk-profile axis (window WIDTH on a flagged day).
//
// Weather input per lead, in order of honesty:
//   * 3/7 days: ECCC citypage forecast (run `npm run fetch:forecast` first) —
//     the daily high/low downscaled to hourly by scaling the climatological
//     diurnal shape between them. weatherSource: "eccc-citypage".
//   * 14 days (or citypage missing/stale/out of range): climatology +
//     decaying anomaly persistence (forecast_weather.js), labelled
//     "climatology+persistence" — an estimate from history, NOT a weather
//     forecast; no public ECCC forecast product reaches 14 days.
//
// Confidence per lead comes from data/backtest_horizons.json (run
// `npm run backtest:horizons`) — the measured recall at that lead, not a
// made-up percentage. Those backtests use the surrogate for every lead, so
// treat 3/7-day figures as conservative when citypage weather is in use.
//
// Model: fit on ALL dataset candidate rows (this is deployment, not a
// backtest — use everything known).
//
// Output: pipeline/data/forecast_horizons.json + console summary.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { DateTime } from 'luxon'
import { FILES, DATA_DIR, FORECAST_LEAD_DAYS } from './config.js'
import { fitModel, predict, isCandidateRow, CANDIDATE_HOUR_RANGE } from './peak_model.js'
import { loadDataset, RISK_PROFILES, groupByDay } from './backtest.js'
import { buildClimatology, indexObservationsByUtcHour, anomalyAt, surrogateWeather } from './forecast_weather.js'
import { isOntarioHoliday } from './lib/holidays.js'
import { isMain } from './lib/is-main.js'

const EASTERN = 'America/Toronto'
const OBS_STALE_HOURS = 48 // dataset older than this -> skip the persistence term
const CITYPAGE_STALE_HOURS = 24

function loadCitypage() {
  if (!existsSync(FILES.forecastCitypage)) return null
  const fc = JSON.parse(readFileSync(FILES.forecastCitypage, 'utf8'))
  const age = DateTime.utc().diff(DateTime.fromISO(fc.fetchedAt), 'hours').hours
  if (age > CITYPAGE_STALE_HOURS) {
    console.warn(`  citypage forecast is ${age.toFixed(0)}h old — ignoring; re-run npm run fetch:forecast`)
    return null
  }
  return fc
}

// Hourly temps for a target day from a daily high/low: scale the target
// date's climatological diurnal shape between the forecast low and high.
function downscaleDay({ climatology, targetDay, highC, lowC }) {
  const climo = Array.from({ length: 24 }, (_, h) => climatology.tempAt(targetDay.set({ hour: h })))
  if (climo.some((v) => v === null)) return null
  const lo = Math.min(...climo)
  const hi = Math.max(...climo)
  const span = hi - lo || 1
  return climo.map((v) => lowC + ((v - lo) / span) * (highC - lowC))
}

function calendarRow(dt) {
  return {
    hour_of_day: dt.hour,
    is_weekend: dt.weekday >= 6 ? 1 : 0,
    is_holiday: isOntarioHoliday(dt),
  }
}

export function runForecast() {
  const rows = loadDataset()
  const model = fitModel(rows.filter(isCandidateRow))
  const climatology = buildClimatology(rows)
  const obsByKey = indexObservationsByUtcHour(rows)
  console.log(`forecast: model fit on ${rows.filter(isCandidateRow).length} candidate rows, R²=${model.r2.toFixed(3)}`)

  // Persistence anomaly from the most recent observations — only if the
  // dataset actually extends to (nearly) now.
  const now = DateTime.now().setZone(EASTERN)
  const latestObs = DateTime.fromISO(rows.at(-1).timestamp, { setZone: true })
  const obsAgeH = now.diff(latestObs, 'hours').hours
  let tempAnomaly = 0
  let anomalyNote = null
  if (obsAgeH <= OBS_STALE_HOURS) {
    tempAnomaly = anomalyAt(obsByKey, latestObs, climatology).tempAnomaly
  } else {
    anomalyNote = `dataset ends ${latestObs.toISODate()} (${obsAgeH.toFixed(0)}h ago) — persistence term skipped, pure climatology`
    console.warn(`  ${anomalyNote}`)
  }

  const citypage = loadCitypage()
  if (!citypage) console.warn('  no fresh citypage forecast — all leads fall back to climatology surrogate')

  // Reference distribution: training candidate days' top predicted values, so
  // each forecast day's score can be placed as a percentile ("is this shaping
  // up like a real peak day or a middling hot day?").
  const trainCandidates = rows.filter(isCandidateRow).map((r) => ({ ...r, predicted: predict(model, r) }))
  const trainDayTops = [...groupByDay(trainCandidates).values()]
    .map((dayRows) => Math.max(...dayRows.map((r) => r.predicted)))
    .sort((a, b) => a - b)
  const percentileOf = (v) => {
    let lo = 0
    while (lo < trainDayTops.length && trainDayTops[lo] <= v) lo++
    return Math.round((100 * lo) / trainDayTops.length)
  }

  const backtests = existsSync(FILES.backtestHorizons)
    ? JSON.parse(readFileSync(FILES.backtestHorizons, 'utf8'))
    : null
  if (!backtests) console.warn('  no backtest_horizons.json — records will lack measured expectedAccuracy; run npm run backtest:horizons')

  const records = FORECAST_LEAD_DAYS.map((leadDays) => {
    const targetDay = now.plus({ days: leadDays }).startOf('day')
    const targetDate = targetDay.toISODate()

    // hourly weather for the target day
    let hourlyTemp = null
    let weatherSource
    const cpDay = citypage?.days.find((d) => d.date === targetDate)
    if (cpDay && cpDay.highC !== null) {
      // The last day of a citypage forecast often has a high but no overnight
      // low (no night period yet). The peak signal is the high; fill the low
      // from the climatological diurnal span rather than discarding the day.
      let lowC = cpDay.lowC
      let lowNote = ''
      if (lowC === null) {
        const climo = Array.from({ length: 24 }, (_, h) => climatology.tempAt(targetDay.set({ hour: h })))
        if (!climo.some((v) => v === null)) {
          lowC = cpDay.highC - (Math.max(...climo) - Math.min(...climo))
          lowNote = '; low filled from climatological diurnal span'
        }
      }
      if (lowC !== null) {
        hourlyTemp = downscaleDay({ climatology, targetDay, highC: cpDay.highC, lowC })
        weatherSource = `eccc-citypage (daily high/low, diurnal-shape downscaled${lowNote})`
      }
    }
    if (!hourlyTemp) {
      weatherSource = tempAnomaly !== 0 ? 'climatology+persistence (NOT a weather forecast)' : 'climatology (NOT a weather forecast)'
    }

    // predict every hour in the candidate band
    const hours = []
    for (let h = CANDIDATE_HOUR_RANGE.minHour; h <= CANDIDATE_HOUR_RANGE.maxHour; h++) {
      const dt = targetDay.set({ hour: h })
      let temp_c, wind_kmh
      if (hourlyTemp) {
        temp_c = hourlyTemp[h]
        wind_kmh = climatology.windAt(dt) ?? 0
      } else {
        const fc = surrogateWeather({ climatology, tempAnomaly, leadDays, targetEasternDt: dt })
        if (!fc) continue
        temp_c = fc.temp_c
        wind_kmh = fc.wind_kmh ?? 0
      }
      const row = { temp_c, wind_kmh, ...calendarRow(dt) }
      hours.push({ hour_of_day: h, temp_c, isCandidate: isCandidateRow(row), predicted: predict(model, row) })
    }
    if (hours.length === 0) throw new Error(`no forecastable hours for ${targetDate} — climatology gaps?`)

    const top = hours.reduce((a, b) => (b.predicted > a.predicted ? b : a))
    const peakRiskDay = hours.some((x) => x.isCandidate)
    const windows = RISK_PROFILES.map(({ profile, windowHours }) => {
      const start = top.hour_of_day - Math.floor((windowHours - 1) / 2)
      return { profile, windowHours, hourStart: start, label: `HE${start + 1}–HE${start + windowHours}` }
    })

    const bt = backtests
      ? aggregateBacktest(backtests, leadDays)
      : null

    return {
      leadDays,
      targetDate,
      issuedAt: now.toISO({ suppressMilliseconds: true }),
      weatherSource,
      ...(anomalyNote ? { anomalyNote } : {}),
      peakRiskDay, // any hour passes the model's temp-extremity candidate filter
      predictedPeakHourStart: top.hour_of_day, // dataset convention (interval start)
      predictedPeakHourEnding: top.hour_of_day + 1, // IESO HE convention
      predictedPeakTempC: round1(top.temp_c),
      predictedPeakMw: Math.round(top.predicted),
      peakScorePercentile: percentileOf(top.predicted), // vs training candidate days
      curtailmentWindows: windows,
      expectedAccuracy: bt, // measured, from backtest_horizons.json (surrogate-weather backtest)
      confidence: leadDays <= 3 ? 'moderate' : leadDays <= 7 ? 'low' : 'very low (beyond any real forecast product)',
    }
  })

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.forecastHorizons, JSON.stringify(records, null, 2))

  console.log('')
  for (const r of records) {
    console.log(
      `  +${String(r.leadDays).padStart(2)}d ${r.targetDate}: ` +
        `peak HE${r.predictedPeakHourEnding} ~${r.predictedPeakMw} MW ` +
        `(p${r.peakScorePercentile}${r.peakRiskDay ? ', peak-risk day' : ', not a peak-risk day'}) ` +
        `[${r.weatherSource}; confidence: ${r.confidence}]`,
    )
  }
  console.log(`\nforecast: wrote ${records.length} horizon records -> ${FILES.forecastHorizons}`)
  return records
}

// Mean/min/max Balanced-profile recall at this lead across backtested years.
function aggregateBacktest(backtests, leadDays) {
  const vals = []
  for (const year of backtests) {
    const h = year.horizons.find((x) => x.leadDays === leadDays)
    const balanced = h?.profileResults.find((p) => p.profile === 'Balanced')
    if (balanced?.top5Recall !== null && balanced?.top5Recall !== undefined) vals.push(balanced.top5Recall)
  }
  if (vals.length === 0) return null
  return {
    basis: 'walk-forward backtest with surrogate (climatology+persistence) weather — see backtest_horizons.js',
    years: vals.length,
    balancedTop5Recall: {
      min: round2(Math.min(...vals)),
      mean: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
      max: round2(Math.max(...vals)),
    },
  }
}

const round1 = (x) => Math.round(x * 10) / 10
const round2 = (x) => Math.round(x * 100) / 100

if (isMain(import.meta.url)) {
  try {
    runForecast()
  } catch (e) {
    console.error('forecast failed:', e.message)
    process.exit(1)
  }
}
