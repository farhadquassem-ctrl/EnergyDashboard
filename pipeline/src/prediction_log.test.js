// Unit tests for the prediction-log pure core. Run: npm test (node --test).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_NAME, predictionsFromForecast, mergePredictions, resolvePredictions,
} from './prediction_log.js'

const forecast = {
  generatedAt: '2026-07-03T10:00:00-04:00',
  predictedPeaks: [
    { date: '2026-07-09', predictedMw: 22542, probability: 0.56, daysOut: 6 },
    { date: '2026-07-13', predictedMw: 22364, probability: 0.51, daysOut: 10 },
  ],
}

test('predictionsFromForecast builds unresolved ModelPrediction rows', () => {
  const preds = predictionsFromForecast(forecast)
  assert.equal(preds.length, 2)
  const p = preds[0]
  assert.equal(p.modelName, MODEL_NAME)
  assert.equal(p.targetDate, '2026-07-09')
  assert.equal(p.predictedAt, '2026-07-03T10:00:00-04:00')
  assert.equal(p.predictedValue, 22542)
  assert.equal(p.predictedProbability, 0.56)
  assert.equal(p.leadTimeDays, 6)
  assert.equal(p.resolved, false)
  assert.equal(p.actualValue, null)
  assert.equal(p.actualHit, null)
})

test('predictionsFromForecast tolerates a missing probability', () => {
  const preds = predictionsFromForecast({
    generatedAt: '2026-07-03T10:00:00-04:00',
    predictedPeaks: [{ date: '2026-07-09', predictedMw: 22542, daysOut: 6 }],
  })
  assert.equal(preds[0].predictedProbability, null)
})

test('mergePredictions is idempotent and additive by (model,target,predictedAt)', () => {
  const first = predictionsFromForecast(forecast)
  const same = mergePredictions(first, predictionsFromForecast(forecast))
  assert.equal(same.length, 2, 're-logging the same run adds nothing')

  const laterRun = predictionsFromForecast({ ...forecast, generatedAt: '2026-07-04T10:00:00-04:00' })
  const merged = mergePredictions(first, laterRun)
  assert.equal(merged.length, 4, 'a new run (new predictedAt) appends')
})

test('mergePredictions preserves existing resolution state', () => {
  const existing = [{ ...predictionsFromForecast(forecast)[0], resolved: true, actualValue: 23000, actualHit: true }]
  const merged = mergePredictions(existing, predictionsFromForecast(forecast))
  const row = merged.find((p) => p.targetDate === '2026-07-09')
  assert.equal(row.resolved, true)
  assert.equal(row.actualHit, true)
})

// Build minimal dataset rows through `lastDay`. A sentinel row ON lastDay makes
// the dataset's max day equal the argument (resolvePredictions derives the
// period-complete check from the data's last day, not from a label).
const rows = (lastDay) => {
  const days = [
    { day: '2026-06-01', peak: 20000 },
    { day: '2026-07-09', peak: 24000 },
    { day: '2026-07-13', peak: 21000 },
    { day: lastDay, peak: 15000 }, // sentinel = dataset end
  ]
  const out = []
  for (const { day, peak } of days) {
    if (day > lastDay) continue
    // two hours; the max is the daily peak
    out.push({ day, timestamp: `${day}T17:00:00-04:00`, ontario_demand_mw: peak - 500 })
    out.push({ day, timestamp: `${day}T18:00:00-04:00`, ontario_demand_mw: peak })
  }
  return out
}

test('resolvePredictions fills actualValue once the day passes; actualHit stays null mid-period', () => {
  const preds = predictionsFromForecast(forecast)
  // dataset ends 2026-07-31 — days passed, but base period (ends 2027-04-30) not closed
  const resolved = resolvePredictions(preds, rows('2026-07-31'))
  const a = resolved.find((p) => p.targetDate === '2026-07-09')
  assert.equal(a.actualValue, 24000)
  assert.equal(a.resolved, true)
  assert.equal(a.actualHit, null, 'outcome not final until the base period closes')
})

test('resolvePredictions sets actualHit once the base period is complete', () => {
  const preds = predictionsFromForecast(forecast)
  // dataset now runs past 2027-04-30 -> period closed; only top-5 daily peaks hit.
  const datasetRows = rows('2027-05-02')
  const resolved = resolvePredictions(preds, datasetRows)
  const hi = resolved.find((p) => p.targetDate === '2026-07-09') // 24000, top-5
  const lo = resolved.find((p) => p.targetDate === '2026-07-13') // 21000, still top-5 (only 3 days)
  assert.equal(hi.actualHit, true)
  assert.equal(lo.actualHit, true) // <=5 days total, all are top-5
})

test('resolvePredictions leaves a not-yet-observed day unresolved', () => {
  const preds = predictionsFromForecast(forecast)
  const resolved = resolvePredictions(preds, rows('2026-07-10')) // 07-13 not in data yet
  const future = resolved.find((p) => p.targetDate === '2026-07-13')
  assert.equal(future.resolved, false)
  assert.equal(future.actualValue, null)
})

test('resolvePredictions on empty dataset is a no-op', () => {
  const preds = predictionsFromForecast(forecast)
  assert.deepEqual(resolvePredictions(preds, []), preds)
})
