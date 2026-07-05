// Step F2: the live 5CP peak forecast, framed for an ICI consumer deciding
// which upcoming hours to curtail.
//
// Domain framing (why this shape):
//   * ICI base period = May 1 – Apr 30. A consumer's demand during that
//     period's 5 Coincident Peaks (the 5 highest Ontario demand hours, one per
//     day) sets their Peak Demand Factor, which is billed over the FOLLOWING
//     adjustment period (Jul 1 – Jun 30). Curtailing the right hours NOW, in
//     the in-progress base period, is what lowers next year's GA bill.
//   * So the useful question isn't "what's the peak on exactly day N" -- it's
//     "over the next 14 days, which hours are likely to crack the CURRENT base
//     period's running top-5, and are therefore worth curtailing?"
//
// This module answers that:
//   * running5CP  -- the base period's top-5 daily peaks banked SO FAR (from
//     observed demand), and the 5th-place threshold a new peak must beat.
//   * predictedPeaks -- up to 5 upcoming candidate-peak days over the next 14,
//     ranked by predicted demand, each tagged with how many days out it is
//     (so 3-/7-/14-day views are nested subsets: a peak inside 3 days is also
//     inside the 7- and 14-day windows) and whether it would crack the running
//     top-5 (wouldRankTop5 == a real curtailment target, not just a warm day).
//
// Weather input degrades honestly with lead time (see forecast_weather.js and
// the README): ECCC citypage forecast within its ~7-day reach, climatology
// surrogate beyond it. Confidence + expectedAccuracy fall off with days out.
//
// Note on running5CP from observed demand: this is the LIVE, in-progress
// period's board, which IESO itself publishes as a running ranking (the ICI
// Peak Tracker current-period file). It is NOT the "re-rank raw demand" anti-
// pattern CLAUDE.md warns against -- that rule is about fabricating Final
// ground-truth labels for a COMPLETED base period's backtest. Here the period
// isn't finished and no Final ranking exists yet, so the running observed
// board is the only and correct source.
//
// Output: pipeline/data/forecast_horizons.json + console summary.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { DateTime } from 'luxon'
import {
  FILES, DATA_DIR, FORECAST_LEAD_DAYS, baseYearOf, basePeriodBounds, billingPeriodBounds,
} from './config.js'
import { fitModel, predict, isCandidateRow, CANDIDATE_HOUR_RANGE } from './peak_model.js'
import { loadDataset, RISK_PROFILES, groupByDay } from './backtest.js'
import { buildClimatology, indexObservationsByUtcHour, anomalyAt, surrogateWeather } from './forecast_weather.js'
import { loadCalibration, probabilityFor, confidenceLabel } from './peak_probability.js'
import { isOntarioHoliday } from './lib/holidays.js'
import { isMain } from './lib/is-main.js'

const EASTERN = 'America/Toronto'
const OBS_STALE_HOURS = 48 // dataset older than this -> skip the persistence term
const CITYPAGE_STALE_HOURS = 24
const MAX_HORIZON = () => Math.max(...FORECAST_LEAD_DAYS) // furthest day to forecast
const MAX_PEAKS = 5 // 5CP -- only the top 5 ever matter

const round1 = (x) => Math.round(x * 10) / 10
const round2 = (x) => Math.round(x * 100) / 100

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

// Smallest configured horizon that still contains a day this many days out.
function leadBucketFor(daysOut) {
  const buckets = [...FORECAST_LEAD_DAYS].sort((a, b) => a - b)
  return buckets.find((b) => daysOut <= b) ?? buckets.at(-1)
}

// The base period's top-5 daily peaks observed so far: one highest hour per
// day, ranked. threshold = the 5th-place MW a new peak must beat to displace it.
function runningFiveCP(rows, basePeriodStart, nowDate) {
  const inPeriod = rows.filter(
    (r) => r.ontario_demand_mw != null && r.day >= basePeriodStart && r.day <= nowDate,
  )
  const byDay = new Map()
  for (const r of inPeriod) {
    const cur = byDay.get(r.day)
    if (!cur || r.ontario_demand_mw > cur.ontario_demand_mw) byDay.set(r.day, r)
  }
  const ranked = [...byDay.values()]
    .sort((a, b) => b.ontario_demand_mw - a.ontario_demand_mw)
    .slice(0, MAX_PEAKS)
    .map((r, i) => ({
      rank: i + 1,
      date: r.day,
      hourEnding: r.hour_of_day + 1,
      mw: Math.round(r.ontario_demand_mw),
    }))
  const threshold = ranked.length === MAX_PEAKS ? ranked.at(-1).mw : null // null => board not full, anything qualifies
  return { ranked, threshold }
}

// Hourly temps for a target day from a daily high/low: scale the target date's
// climatological diurnal shape between the forecast low and high.
function downscaleDay(climatology, targetDay, highC, lowC) {
  const climo = Array.from({ length: 24 }, (_, h) => climatology.tempAt(targetDay.set({ hour: h })))
  if (climo.some((v) => v === null)) return null
  const lo = Math.min(...climo)
  const hi = Math.max(...climo)
  const span = hi - lo || 1
  return climo.map((v) => lowC + ((v - lo) / span) * (highC - lowC))
}

function calendarRow(dt) {
  return { hour_of_day: dt.hour, is_weekend: dt.weekday >= 6 ? 1 : 0, is_holiday: isOntarioHoliday(dt) }
}

// Predict one day's peak hour. Weather: citypage forecast if the day is within
// its coverage, else the climatology(+persistence) surrogate decayed by daysOut.
function predictDayPeak({ day, daysOut, model, climatology, tempAnomaly, citypage }) {
  const date = day.toISODate()
  let hourlyTemp = null
  let weatherSource
  const cpDay = citypage?.days.find((d) => d.date === date)
  if (cpDay && cpDay.highC != null) {
    let lowC = cpDay.lowC
    let lowNote = ''
    if (lowC == null) {
      const climo = Array.from({ length: 24 }, (_, h) => climatology.tempAt(day.set({ hour: h })))
      if (!climo.some((v) => v === null)) {
        lowC = cpDay.highC - (Math.max(...climo) - Math.min(...climo))
        lowNote = ' (low filled from climo span)'
      }
    }
    if (lowC != null) {
      hourlyTemp = downscaleDay(climatology, day, cpDay.highC, lowC)
      if (hourlyTemp) weatherSource = `eccc-citypage${lowNote}`
    }
  }

  const hours = []
  for (let h = CANDIDATE_HOUR_RANGE.minHour; h <= CANDIDATE_HOUR_RANGE.maxHour; h++) {
    const dt = day.set({ hour: h })
    let temp_c, wind_kmh
    if (hourlyTemp) {
      temp_c = hourlyTemp[h]
      wind_kmh = climatology.windAt(dt) ?? 0
    } else {
      const fc = surrogateWeather({ climatology, tempAnomaly, leadDays: daysOut, targetEasternDt: dt })
      if (!fc) continue
      temp_c = fc.temp_c
      wind_kmh = fc.wind_kmh ?? 0
    }
    const row = { temp_c, wind_kmh, ...calendarRow(dt) }
    hours.push({ hourStart: h, temp_c, isCandidate: isCandidateRow(row), predicted: predict(model, row) })
  }
  if (hours.length === 0) return null
  if (!weatherSource) weatherSource = tempAnomaly !== 0 ? 'climatology+persistence' : 'climatology'

  const top = hours.reduce((a, b) => (b.predicted > a.predicted ? b : a))
  return {
    date,
    daysOut,
    weatherSource,
    isForecastWeather: weatherSource.startsWith('eccc'),
    peakRiskDay: hours.some((x) => x.isCandidate),
    predictedPeakHourStart: top.hourStart,
    predictedPeakHourEnding: top.hourStart + 1,
    predictedMw: Math.round(top.predicted),
    tempC: round1(top.temp_c),
  }
}

function curtailmentWindows(hourStart) {
  return RISK_PROFILES.map(({ profile, windowHours }) => {
    const start = hourStart - Math.floor((windowHours - 1) / 2)
    return { profile, windowHours, hourStart: start, label: `HE${start + 1}–HE${start + windowHours}` }
  })
}

export function runForecast() {
  const rows = loadDataset() // rows carry .day and .baseYear
  const candidateRows = rows.filter(isCandidateRow)
  const model = fitModel(candidateRows)
  const climatology = buildClimatology(rows)
  const obsByKey = indexObservationsByUtcHour(rows)

  const now = DateTime.now().setZone(EASTERN)
  const nowDate = now.toISODate()
  const baseYear = baseYearOf(nowDate)
  const basePeriod = basePeriodBounds(baseYear)
  const billingPeriod = billingPeriodBounds(baseYear)

  const latestObs = DateTime.fromISO(rows.at(-1).timestamp, { setZone: true })
  const obsAgeH = now.diff(latestObs, 'hours').hours
  const datasetThrough = latestObs.toISODate()

  let tempAnomaly = 0
  let staleNote = null
  if (obsAgeH <= OBS_STALE_HOURS) {
    tempAnomaly = anomalyAt(obsByKey, latestObs, climatology).tempAnomaly
  } else {
    staleNote = `dataset ends ${datasetThrough} (${Math.round(obsAgeH)}h ago) — persistence term skipped; running board is as of the dataset end, not now`
    console.warn(`  ${staleNote}`)
  }

  const citypage = loadCitypage()
  if (!citypage) console.warn('  no fresh citypage forecast — all leads fall back to the climatology surrogate')

  // Empirical peak-probability calibration (npm run calibrate). Absent on a
  // first run -> probability stays null and confidence falls back to the old
  // days-out heuristic, so nothing breaks before the first calibration.
  const calibration = loadCalibration()
  if (!calibration) console.warn('  no peak_probability.json — probability absent, confidence falls back to days-out; run npm run calibrate')

  // Running board for the in-progress base period (as of the dataset end).
  const boardThrough = obsAgeH <= OBS_STALE_HOURS ? nowDate : datasetThrough
  const { ranked: running5CP, threshold } = runningFiveCP(rows, basePeriod.start, boardThrough)

  // A predicted peak's would-be rank on the current board, and whether that
  // cracks the top 5 (== worth curtailing).
  const projectedRankOf = (mw) => running5CP.filter((p) => p.mw > mw).length + 1
  const cracksTop5 = (mw) => (threshold == null ? true : mw > threshold)

  // Forecast every day in the next MAX_HORIZON, rank by predicted peak MW.
  const dayPeaks = []
  for (let d = 1; d <= MAX_HORIZON(); d++) {
    const p = predictDayPeak({
      day: now.plus({ days: d }).startOf('day'),
      daysOut: d,
      model, climatology, tempAnomaly, citypage,
    })
    if (p) dayPeaks.push(p)
  }
  dayPeaks.sort((a, b) => b.predictedMw - a.predictedMw)

  // Curtailment targets = predicted peaks that would crack the running top-5,
  // capped at 5. If fewer than 2 qualify (quiet stretch / board already high),
  // pad with the next-best days as monitor-only context so the tab isn't empty.
  const decorate = (p, selected) => {
    const leadBucket = leadBucketFor(p.daysOut)
    // Calibrated P(this day cracks the base period's top-5), from the empirical
    // percentile×lead model. confidence is the RELATIVE rung — gated on the
    // normalized per-lead percentile, not the absolute probability (which is
    // intrinsically small; see confidenceLabel) — so the UI must keep the
    // numeric probability visible beside it. If calibration is absent, both
    // fall back to a days-out heuristic in the same 3-rung wording so the
    // dashboard's confidence enum keeps working.
    const scored = probabilityFor(calibration, { predictedMw: p.predictedMw, lead: leadBucket })
    const probability = scored ? round2(scored.probability) : null
    const confidence = scored
      ? confidenceLabel(scored.percentile)
      : p.daysOut <= 3 ? 'high' : p.daysOut <= 7 ? 'moderate' : 'low'
    return {
      ...p,
      leadBucket,
      projectedRank: projectedRankOf(p.predictedMw),
      wouldRankTop5: selected,
      probability,
      peakPercentile: scored ? round2(scored.percentile) : null,
      confidence,
      curtailmentWindows: curtailmentWindows(p.predictedPeakHourStart),
      expectedAccuracy: null, // filled below from backtests
    }
  }
  const selected = dayPeaks.filter((p) => p.peakRiskDay && cracksTop5(p.predictedMw)).slice(0, MAX_PEAKS)
  const padCount = Math.max(0, 2 - selected.length)
  const pad = dayPeaks.filter((p) => !selected.includes(p)).slice(0, padCount)
  const predictedPeaks = [...selected.map((p) => decorate(p, true)), ...pad.map((p) => decorate(p, false))]

  // Measured accuracy per lead bucket, attached to each peak and summarised.
  const backtests = existsSync(FILES.backtestHorizons)
    ? JSON.parse(readFileSync(FILES.backtestHorizons, 'utf8'))
    : null
  if (!backtests) console.warn('  no backtest_horizons.json — accuracy will be absent; run npm run backtest:horizons')
  const accuracyByLead = {}
  for (const lead of FORECAST_LEAD_DAYS) accuracyByLead[lead] = backtests ? aggregateBacktest(backtests, lead) : null
  for (const p of predictedPeaks) p.expectedAccuracy = accuracyByLead[p.leadBucket] ?? null

  const out = {
    generatedAt: now.toISO({ suppressMilliseconds: true }),
    datasetThrough,
    staleNote,
    model: { r2: round2(model.r2), trainRows: candidateRows.length },
    basePeriod: { ...basePeriod, baseYear },
    billingPeriod,
    horizons: [...FORECAST_LEAD_DAYS].sort((a, b) => a - b),
    threshold,
    running5CP,
    predictedPeaks,
    accuracyByLead,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.forecastHorizons, JSON.stringify(out, null, 2))
  printSummary(out)
  return out
}

function aggregateBacktest(backtests, leadDays) {
  const vals = []
  for (const year of backtests) {
    const h = year.horizons.find((x) => x.leadDays === leadDays)
    const balanced = h?.profileResults.find((p) => p.profile === 'Balanced')
    if (balanced?.top5Recall != null) vals.push(balanced.top5Recall)
  }
  if (vals.length === 0) return null
  return {
    basis: 'walk-forward backtest, surrogate (climatology+persistence) weather',
    years: vals.length,
    balancedTop5Recall: {
      min: round2(Math.min(...vals)),
      mean: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
      max: round2(Math.max(...vals)),
    },
  }
}

function printSummary(out) {
  console.log(`\nforecast: base period ${out.basePeriod.label} (${out.basePeriod.start} … ${out.basePeriod.end})`)
  console.log(`  determines GA billing: ${out.billingPeriod.label}`)
  console.log(`  running 5CP so far (through ${out.datasetThrough}), threshold=${out.threshold ?? 'board not full'}:`)
  for (const p of out.running5CP) console.log(`    #${p.rank} ${p.date} HE${p.hourEnding}  ${p.mw} MW`)
  console.log(`  predicted peaks (next ${Math.max(...out.horizons)} days):`)
  for (const p of out.predictedPeaks) {
    console.log(
      `    ${p.date} (+${p.daysOut}d, ≤${p.leadBucket}d): HE${p.predictedPeakHourEnding} ~${p.predictedMw} MW` +
        ` → would rank #${p.projectedRank}${p.wouldRankTop5 ? ' ✓ CURTAIL' : '  (monitor)'}` +
        ` [${p.weatherSource}; P(top5)=${p.probability == null ? 'n/a' : `${Math.round(p.probability * 100)}%`}; ${p.confidence}]`,
    )
  }
  console.log(`\nforecast: wrote ${out.predictedPeaks.length} predicted peaks -> ${FILES.forecastHorizons}`)
}

if (isMain(import.meta.url)) {
  try {
    runForecast()
  } catch (e) {
    console.error('forecast failed:', e.message)
    process.exit(1)
  }
}
