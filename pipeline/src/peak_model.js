// Peak-prediction model: multivariate OLS regression predicting
// ontario_demand_mw from weather + calendar features, fit via the normal
// equations (closed-form least squares).
//
// simple-statistics has no multivariate or logistic regression -- only a
// 2-variable linearRegression -- so the fit itself is a small hand-rolled
// matrix solve (Gauss-Jordan on an ~8x8 system, well within safe numerical
// range for this feature count). simple-statistics is used for its summary
// stats (mean, sampleCorrelation) as fit diagnostics.
//
// Candidates are hard-filtered two ways:
//   - Hours: HE11-HE22 (hour_of_day 10-21 in this dataset's interval-start
//     convention) -- the historical peak-hour range across all of 2020-2025.
//   - Temperature extremity: temp_c >= COOLING_THRESHOLD_C (summer AC load) OR
//     temp_c <= HEATING_THRESHOLD_C (winter heating load). Ontario demand-vs-
//     temperature is bimodal (both hot AND cold raise demand vs. a mild day),
//     so raw temp_c as a single linear feature doesn't work -- a v1 that
//     restricted candidates to June-September dodged this but silently wrote
//     off winter entirely (including a real Feb-2023 cold-snap peak). Fixed
//     properly with degree-based features instead of a month filter: see
//     cooling_degrees/heating_degrees below, each a non-negative distance past
//     its threshold, so both directions of "extreme weather -> more demand"
//     get their own coefficient instead of cancelling each other out.
// Together these keep the training population non-trivial (not just mild
// shoulder-season noise) while genuinely allowing winter candidate days.
//
// Winter heating in Ontario is still mostly gas furnaces (weaker electricity-
// demand link than summer AC), so don't expect winter recall to match summer
// out of the gate -- HEATING_THRESHOLD_C is deliberately a tunable starting
// point, expected to matter more as heat-pump adoption grows.
//
// humidex is deliberately excluded: ~82% missing (only reported in warm
// conditions), and temp_c already carries the heat-load signal without
// needing imputation logic in v1.
//
// Note: is_top5_peak/is_top10_peak (used only for backtest evaluation, never
// as fit inputs) were ranked by IESO's own metric -- Ontario demand MW for
// live years, AQEW MWh for fallback years (2020/2021/2024). Those were
// spot-checked to identify the same (date, hour) rank-for-rank (see
// fetch_peaks.js), so predicting ontario_demand_mw remains a fair backtest
// target even for fallback-labeled years.

import { mean, sampleCorrelation } from 'simple-statistics'

export const CANDIDATE_HOUR_RANGE = { minHour: 10, maxHour: 21 } // hour_of_day, HE11-HE22
export const COOLING_THRESHOLD_C = 25 // summer AC load kicks in above this
export const HEATING_THRESHOLD_C = 10 // winter heating load kicks in below this

export const FEATURES = ['cooling_degrees', 'heating_degrees', 'wind_kmh', 'hour_of_day', 'is_weekend', 'is_holiday']

export function isCandidateRow(row) {
  const h = Number(row.hour_of_day)
  const t = Number(row.temp_c)
  const inHourBand = h >= CANDIDATE_HOUR_RANGE.minHour && h <= CANDIDATE_HOUR_RANGE.maxHour
  const inTempExtreme = t >= COOLING_THRESHOLD_C || t <= HEATING_THRESHOLD_C
  return inHourBand && inTempExtreme
}

// Non-negative distance past each threshold -- lets "hotter than 25 -> more
// demand" and "colder than 10 -> more demand" each get their own coefficient
// instead of a single raw temp_c term cancelling the two directions out.
function deriveFeatureValue(row, name) {
  if (name === 'cooling_degrees') return Math.max(0, Number(row.temp_c) - COOLING_THRESHOLD_C)
  if (name === 'heating_degrees') return Math.max(0, HEATING_THRESHOLD_C - Number(row.temp_c))
  return Number(row[name])
}

function featureVector(row) {
  return FEATURES.map((f) => deriveFeatureValue(row, f))
}

// Solve (XtX) beta = Xty by Gauss-Jordan elimination with partial pivoting.
function solveLinearSystem(XtX, Xty) {
  const n = XtX.length
  const M = XtX.map((row, i) => [...row, Xty[i]])
  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r
    }
    ;[M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    const pivot = M[col][col]
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('singular matrix in OLS fit -- check for collinear/constant training features')
    }
    for (let c = col; c <= n; c++) M[col][c] /= pivot
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c]
    }
  }
  return M.map((row) => row[n])
}

// Fit ontario_demand_mw ~ intercept + FEATURES on the given rows (caller must
// pre-filter to candidate hours). Returns coefficients, R-squared, and
// per-feature training correlations (diagnostic only, not used in scoring).
export function fitModel(trainingRows) {
  const y = trainingRows.map((r) => Number(r.ontario_demand_mw))
  const X = trainingRows.map((r) => [1, ...featureVector(r)])
  const p = X[0].length
  const n = X.length

  const XtX = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0
      for (let k = 0; k < n; k++) s += X[k][i] * X[k][j]
      return s
    }),
  )
  const Xty = Array.from({ length: p }, (_, i) => {
    let s = 0
    for (let k = 0; k < n; k++) s += X[k][i] * y[k]
    return s
  })

  const coefficients = solveLinearSystem(XtX, Xty)

  const yMean = mean(y)
  let ssRes = 0
  let ssTot = 0
  for (let k = 0; k < n; k++) {
    const pred = X[k].reduce((s, x, i) => s + x * coefficients[i], 0)
    ssRes += (y[k] - pred) ** 2
    ssTot += (y[k] - yMean) ** 2
  }
  const r2 = 1 - ssRes / ssTot

  const featureCorrelations = Object.fromEntries(
    FEATURES.map((f) => [f, sampleCorrelation(trainingRows.map((r) => deriveFeatureValue(r, f)), y)]),
  )

  return { coefficients, r2, n, featureCorrelations }
}

export function predict(model, row) {
  const x = [1, ...featureVector(row)]
  return x.reduce((s, v, i) => s + v * model.coefficients[i], 0)
}
