// Durable prospective prediction log (Prompt 5's "one gap that would otherwise
// force a rebuild"). The forecast's accuracy was, until now, ONLY a walk-
// forward backtest recomputed from history each run — nothing recorded what the
// model actually predicted, prospectively, to score against reality later.
//
// This maintains public/peak-forecast/prediction_log.json: an append-only log
// of ModelPrediction rows (see src/types/market.js for the shared shape — the
// JSON file is the pipeline↔app interface, same pattern as forecast.json). Each
// run appends the current forecast's predicted peaks and resolves any past ones
// whose target day now sits in the dataset.
//
// Two resolution stages, kept honest for 5CP:
//   * actualValue + resolved: as soon as the target day is in the dataset (the
//     day's actual peak MW is a fact once it passes).
//   * actualHit: only set once the day's base period is COMPLETE — whether a
//     July peak ends up in the final top-5 isn't knowable until Apr 30 closes
//     the period. Until then it stays null and the hit/calibration scorers skip
//     the row (see features/model-backtest/calculations.js).
//
// Pure core (mergePredictions/resolvePredictions/predictionsFromForecast) is
// unit-tested; the IO wrapper (updatePredictionLog) is the npm run
// log:predictions entry point.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FILES, baseYearOf, basePeriodBounds } from './config.js'
import { loadDataset, groupByDay } from './backtest.js'
import { isMain } from './lib/is-main.js'

export const MODEL_NAME = 'ga-5cp-peak'
const SCHEMA_VERSION = 1
const TOP5 = 5

const here = dirname(fileURLToPath(import.meta.url))
// pipeline/src -> repo root -> public/peak-forecast
const PUBLIC_DIR = join(here, '..', '..', 'public', 'peak-forecast')
const FORECAST_FILE = join(PUBLIC_DIR, 'forecast.json')
const LOG_FILE = join(PUBLIC_DIR, 'prediction_log.json')

const keyOf = (p) => `${p.modelName}|${p.targetDate}|${p.predictedAt}`

/**
 * Build ModelPrediction rows (unresolved) from a forecast's predicted peaks.
 * @param {object} forecast parsed forecast.json (needs generatedAt + predictedPeaks)
 * @returns {import('../../src/types/market').ModelPrediction[]}
 */
export function predictionsFromForecast(forecast) {
  const predictedAt = forecast.generatedAt
  return (forecast.predictedPeaks ?? []).map((p) => ({
    modelName: MODEL_NAME,
    targetDate: p.date,
    predictedAt,
    predictedValue: p.predictedMw,
    predictedProbability: p.probability ?? null,
    actualValue: null,
    actualHit: null,
    resolved: false,
    leadTimeDays: p.daysOut,
    // Optional provenance (additive): which weather drove this prediction and
    // the peak-hour temp, so accuracy can later be sliced real-forecast vs
    // surrogate. Present on forecast.json's predictedPeaks; null on older runs.
    // resolvePredictions spreads `...p`, so these survive resolution untouched.
    weatherSource: p.weatherSource ?? null,
    tempC: p.tempC ?? null,
  }))
}

/**
 * Append incoming predictions to the existing log, de-duplicated by
 * (modelName, targetDate, predictedAt) — re-running the same forecast is
 * idempotent; a new run (new predictedAt) adds new rows. Existing rows (incl.
 * their resolution state) are preserved.
 */
export function mergePredictions(existing, incoming) {
  const byKey = new Map((existing ?? []).map((p) => [keyOf(p), p]))
  for (const p of incoming ?? []) {
    if (!byKey.has(keyOf(p))) byKey.set(keyOf(p), p)
  }
  return [...byKey.values()].sort(
    (a, b) => a.targetDate.localeCompare(b.targetDate) || a.predictedAt.localeCompare(b.predictedAt),
  )
}

/**
 * Resolve predictions against the assembled dataset rows: fill actualValue once
 * the target day is present, and actualHit once its base period is complete.
 * Pure — returns a new array; already-resolved rows pass through untouched only
 * if actualHit is already final.
 *
 * @param {import('../../src/types/market').ModelPrediction[]} predictions
 * @param {ReturnType<typeof loadDataset>} datasetRows
 */
export function resolvePredictions(predictions, datasetRows) {
  if (!datasetRows.length) return predictions
  const lastDay = datasetRows.reduce((m, r) => (r.day > m ? r.day : m), datasetRows[0].day)

  // Actual daily peak MW per day.
  const dailyPeak = new Map()
  for (const [day, rows] of groupByDay(datasetRows)) {
    const peak = rows.reduce((m, r) => (r.ontario_demand_mw > m ? r.ontario_demand_mw : m), -Infinity)
    dailyPeak.set(day, peak)
  }

  // Final top-5 day set per base year (only meaningful once the period closed).
  const daysByBaseYear = new Map()
  for (const [day, peak] of dailyPeak) {
    const by = baseYearOf(day)
    if (!daysByBaseYear.has(by)) daysByBaseYear.set(by, [])
    daysByBaseYear.get(by).push({ day, peak })
  }
  const top5ByBaseYear = new Map()
  for (const [by, days] of daysByBaseYear) {
    const top5 = new Set(
      [...days].sort((a, b) => b.peak - a.peak).slice(0, TOP5).map((d) => d.day),
    )
    top5ByBaseYear.set(by, top5)
  }

  return predictions.map((p) => {
    if (p.actualHit != null) return p // already fully resolved
    const actualValue = dailyPeak.has(p.targetDate) ? Math.round(dailyPeak.get(p.targetDate)) : p.actualValue
    const resolved = dailyPeak.has(p.targetDate) || p.resolved

    const by = baseYearOf(p.targetDate)
    const periodComplete = lastDay > basePeriodBounds(by).end
    const actualHit = periodComplete && top5ByBaseYear.has(by)
      ? top5ByBaseYear.get(by).has(p.targetDate)
      : null

    return { ...p, actualValue, resolved, actualHit }
  })
}

/** Load the committed log (or an empty one). */
function loadLog() {
  if (!existsSync(LOG_FILE)) return { schemaVersion: SCHEMA_VERSION, predictions: [] }
  try {
    const parsed = JSON.parse(readFileSync(LOG_FILE, 'utf8'))
    return { schemaVersion: SCHEMA_VERSION, predictions: parsed.predictions ?? [] }
  } catch {
    return { schemaVersion: SCHEMA_VERSION, predictions: [] }
  }
}

// IO entry point (npm run log:predictions): append the current forecast's
// predictions and re-resolve the whole log against the latest dataset.
export function updatePredictionLog() {
  if (!existsSync(FORECAST_FILE)) {
    throw new Error(`no ${FORECAST_FILE} — run npm run export:dashboard first`)
  }
  const forecast = JSON.parse(readFileSync(FORECAST_FILE, 'utf8'))
  const datasetRows = existsSync(FILES.dataset) ? loadDataset() : []

  const prior = loadLog()
  const appended = mergePredictions(prior.predictions, predictionsFromForecast(forecast))
  const resolved = resolvePredictions(appended, datasetRows)

  const resolvedCount = resolved.filter((p) => p.resolved).length
  const hitScored = resolved.filter((p) => p.actualHit != null).length
  const out = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    models: [...new Set(resolved.map((p) => p.modelName))],
    predictions: resolved,
  }

  mkdirSync(PUBLIC_DIR, { recursive: true })
  writeFileSync(LOG_FILE, JSON.stringify(out, null, 2))
  console.log(
    `log:predictions: ${resolved.length} logged (${resolvedCount} resolved, ${hitScored} outcome-final) -> ${LOG_FILE}`,
  )
  return out
}

if (isMain(import.meta.url)) {
  try {
    updatePredictionLog()
  } catch (e) {
    console.error('log:predictions failed:', e.message)
    process.exit(1)
  }
}
