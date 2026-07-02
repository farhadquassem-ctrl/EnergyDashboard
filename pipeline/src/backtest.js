// Step 5: peak-prediction backtest. Fits the OLS model (peak_model.js) on
// past base periods and evaluates it against later ones (walk-forward /
// expanding window: train on all base years strictly before the test year),
// checking whether its highest-predicted hours land on IESO's official
// top5/top10 peak hours.
//
// v1 caveat: features come from the SAME hour being predicted (actual temp/
// demand, not a forecast) -- this validates the modeling approach itself, not
// a real forecast. See CLAUDE.md task 2 for the full accepted-limitations list.
//
// Output: pipeline/data/backtest_results.json, one entry per evaluated base year.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parseCsv, columnIndex } from './lib/csv.js'
import { FILES, DATA_DIR, baseYearOf } from './config.js'
import { fitModel, predict, isCandidateRow, FEATURES } from './peak_model.js'
import { isMain } from './lib/is-main.js'

// "Risk profile" = curtailment-window width in hours, centered on the model's
// highest-predicted hour for a flagged day. Narrower = less unnecessary ICI
// curtailment cost; wider = safer catch of the actual peak hour.
const RISK_PROFILES = [
  { profile: 'Conservative', windowHours: 3 },
  { profile: 'Balanced', windowHours: 4 },
  { profile: 'Aggressive', windowHours: 5 },
]
// Flagged per base period -- generous relative to the 5-10 real peaks per
// year so the evaluation has margin, without flagging every candidate day.
const FLAGGED_DAYS_PER_YEAR = 15

const DATASET_COLUMNS = ['timestamp', 'ontario_demand_mw', 'is_top5_peak', 'is_top10_peak', ...FEATURES]

function loadDataset() {
  const text = readFileSync(FILES.dataset, 'utf8')
  const { header, rows } = parseCsv(text)
  const idx = Object.fromEntries(DATASET_COLUMNS.map((c) => [c, columnIndex(header, c)]))
  return rows
    .map((cols) => {
      const row = { timestamp: cols[idx.timestamp], day: cols[idx.timestamp].slice(0, 10) }
      for (const c of DATASET_COLUMNS.slice(1)) {
        row[c] = cols[idx[c]] === '' ? null : Number(cols[idx[c]])
      }
      row.baseYear = baseYearOf(row.day)
      return row
    })
    .filter((r) => r.ontario_demand_mw !== null && FEATURES.every((f) => r[f] !== null))
}

function groupByDay(rows) {
  const byDay = new Map()
  for (const r of rows) {
    const list = byDay.get(r.day) ?? []
    list.push(r)
    byDay.set(r.day, list)
  }
  return byDay
}

// Center a `width`-hour window on a flagged day's highest-predicted hour.
function windowHoursForDay(dayRows, width) {
  const topHour = [...dayRows].sort((a, b) => b.predicted - a.predicted)[0].hour_of_day
  const start = topHour - Math.floor((width - 1) / 2)
  return new Set(Array.from({ length: width }, (_, i) => start + i))
}

function backtestYear(trainingRows, testRows) {
  const candidateTrain = trainingRows.filter(isCandidateRow)
  const model = fitModel(candidateTrain)

  const candidateTest = testRows.filter(isCandidateRow)
  for (const r of candidateTest) r.predicted = predict(model, r)

  const dayGroups = [...groupByDay(candidateTest).entries()].map(([day, rows]) => ({
    day,
    rows,
    topPredicted: Math.max(...rows.map((r) => r.predicted)),
  }))
  dayGroups.sort((a, b) => b.topPredicted - a.topPredicted)
  const flaggedDays = dayGroups.slice(0, FLAGGED_DAYS_PER_YEAR)

  // Regression's own top-10-predicted vs. actual-top10 overlap: a direct
  // fit-quality check independent of the risk-profile windowing below.
  const rankedByPrediction = [...candidateTest].sort((a, b) => b.predicted - a.predicted)
  const top10PredictedKeys = new Set(rankedByPrediction.slice(0, 10).map((r) => r.timestamp))
  const actualTop10Keys = new Set(candidateTest.filter((r) => r.is_top10_peak === 1).map((r) => r.timestamp))
  const top10Overlap = [...top10PredictedKeys].filter((k) => actualTop10Keys.has(k)).length

  const actualTop5Hours = candidateTest.filter((r) => r.is_top5_peak === 1)
  const actualTop10Hours = candidateTest.filter((r) => r.is_top10_peak === 1)

  const profileResults = RISK_PROFILES.map(({ profile, windowHours }) => {
    let top5Hits = 0
    let top10Hits = 0
    for (const { day, rows } of flaggedDays) {
      const hours = windowHoursForDay(rows, windowHours)
      if (actualTop5Hours.some((r) => r.day === day && hours.has(r.hour_of_day))) top5Hits++
      if (actualTop10Hours.some((r) => r.day === day && hours.has(r.hour_of_day))) top10Hits++
    }
    return {
      profile,
      windowHours,
      top5Recall: actualTop5Hours.length ? top5Hits / actualTop5Hours.length : null,
      top10Recall: actualTop10Hours.length ? top10Hits / actualTop10Hours.length : null,
      curtailmentHours: flaggedDays.length * windowHours,
    }
  })

  return {
    trainRows: candidateTrain.length,
    r2: model.r2,
    featureCorrelations: model.featureCorrelations,
    top10Overlap,
    profileResults,
  }
}

export function runBacktest() {
  const rows = loadDataset()
  const years = [...new Set(rows.map((r) => r.baseYear))].sort((a, b) => a - b)
  const results = []

  for (const testYear of years) {
    const trainingRows = rows.filter((r) => r.baseYear < testYear)
    if (trainingRows.length === 0) {
      console.log(`${testYear}: no prior base years -- training-only, not evaluated`)
      continue
    }
    const result = backtestYear(trainingRows, rows.filter((r) => r.baseYear === testYear))
    results.push({ baseYear: testYear, ...result })

    console.log(`\n${testYear} (trained on ${result.trainRows} candidate-hour rows, R²=${result.r2.toFixed(3)}):`)
    console.log(`  top-10 predicted vs. actual overlap: ${result.top10Overlap}/10`)
    for (const p of result.profileResults) {
      console.log(
        `  ${p.profile.padEnd(12)} (${p.windowHours}h window): ` +
          `top5 recall=${fmtPct(p.top5Recall)} top10 recall=${fmtPct(p.top10Recall)} curtailment=${p.curtailmentHours}h`,
      )
    }
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.backtest, JSON.stringify(results, null, 2))
  console.log(`\nbacktest: wrote ${results.length} evaluated base years -> ${FILES.backtest}`)
  return results
}

function fmtPct(x) {
  return x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`
}

if (isMain(import.meta.url)) {
  try {
    runBacktest()
  } catch (e) {
    console.error('backtest failed:', e.message)
    process.exit(1)
  }
}
