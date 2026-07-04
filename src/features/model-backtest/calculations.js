// Model-agnostic accuracy scoring (the contract's calculations.js: pure, no
// React, unit-testable). Prompt 5's generalization: the Peak Forecast tab's
// "Measured accuracy by lead time" was GA-specific and computed pipeline-side;
// this module scores ANY model's prediction log (peak 5CP today; DA/RT price,
// storage forecasts later) so adding a second model is a data-plumbing change,
// not a UI rebuild.
//
// Two distinct accuracy sources, deliberately kept separate:
//   1. Walk-forward BACKTEST aggregate (`accuracyByLead` in forecast.json) —
//      recomputed from history each run. The existing panel renders this; the
//      presentation helpers for it (leadRecall/recallColorClass) are extracted
//      here unchanged so the panel's output is byte-identical.
//   2. Prospective PREDICTION LOG (ModelPrediction[], accumulated in
//      prediction_log.json) — the new durable record scored as reality
//      arrives. computeHitRate/computeCalibration/computeTrendOverTime operate
//      on this; they return empty/neutral until the log has resolved rows.
//
// A ModelPrediction is "resolved" once actualValue is known (the target day
// passed). `actualHit` (the positive-outcome label, e.g. "ended up top-5") may
// lag further — for 5CP it's only final at the base period's close — so the
// hit/calibration scorers use only rows where actualHit != null, while the
// point-error trend uses actualValue.

/** @typedef {import('../../types/market').ModelPrediction} ModelPrediction */

// Recall color thresholds — the exact cutoffs the AccuracyPanel shipped with.
export const RECALL_GOOD = 0.6
export const RECALL_OK = 0.4

// --- extracted presentation helpers (behavior-preserving) -------------------

/** Mean Balanced top-5 recall for a lead bucket from forecast.json's aggregate. */
export function leadRecall(accuracyByLead, lead) {
  return accuracyByLead?.[String(lead)]?.balancedTop5Recall?.mean ?? null
}

/** Bar color class for a recall value (null = no data). Matches the panel. */
export function recallColorClass(r) {
  if (r == null) return 'bg-zinc-400'
  if (r >= RECALL_GOOD) return 'bg-emerald-500'
  if (r >= RECALL_OK) return 'bg-amber-500'
  return 'bg-red-500'
}

// --- generalized log scoring (operate on ModelPrediction[]) -----------------

const forModel = (predictions, modelName) =>
  (predictions ?? []).filter((p) => !modelName || p.modelName === modelName)

/**
 * Detection recall/precision of a model's positive events on its prospective
 * log. Ground truth = `actualHit`; a prediction is "flagged" when its
 * predictedProbability ≥ threshold (falls back to a truthy predictedProbability
 * being absent → not flagged). Generalizes the GA "did we catch the top-5"
 * recall to any model via `modelName`.
 *
 * @param {ModelPrediction[]} predictions
 * @param {{ modelName?: string, threshold?: number }} [opts]
 */
export function computeHitRate(predictions, { modelName, threshold = 0.5 } = {}) {
  const scored = forModel(predictions, modelName).filter((p) => p.actualHit != null)
  const positives = scored.filter((p) => p.actualHit === true)
  const flagged = scored.filter((p) => (p.predictedProbability ?? 0) >= threshold)
  const hits = flagged.filter((p) => p.actualHit === true)
  return {
    modelName: modelName ?? null,
    threshold,
    resolved: scored.length,
    positives: positives.length,
    flagged: flagged.length,
    hits: hits.length,
    recall: positives.length ? hits.length / positives.length : null,
    precision: flagged.length ? hits.length / flagged.length : null,
  }
}

/**
 * Reliability-diagram data: bin resolved predictions by predictedProbability
 * and compare the predicted mean to the observed hit frequency in each bin.
 * The classic calibration check — a well-calibrated model has observedFreq ≈
 * predictedMean in every bin. Brier score is the overall summary.
 *
 * @param {ModelPrediction[]} predictions
 * @param {{ modelName?: string, bins?: number }} [opts]
 */
export function computeCalibration(predictions, { modelName, bins = 10 } = {}) {
  const scored = forModel(predictions, modelName).filter(
    (p) => p.actualHit != null && p.predictedProbability != null,
  )
  const buckets = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins,
    hi: (i + 1) / bins,
    n: 0,
    predictedSum: 0,
    hits: 0,
  }))
  let brierSum = 0
  for (const p of scored) {
    const prob = Math.min(1, Math.max(0, p.predictedProbability))
    let i = Math.floor(prob * bins)
    if (i >= bins) i = bins - 1
    buckets[i].n += 1
    buckets[i].predictedSum += prob
    buckets[i].hits += p.actualHit ? 1 : 0
    brierSum += (prob - (p.actualHit ? 1 : 0)) ** 2
  }
  return {
    modelName: modelName ?? null,
    resolved: scored.length,
    brier: scored.length ? brierSum / scored.length : null,
    bins: buckets.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      n: b.n,
      predictedMean: b.n ? b.predictedSum / b.n : null,
      observedFreq: b.n ? b.hits / b.n : null,
    })),
  }
}

/**
 * Rolling accuracy over time: bucket resolved predictions by the calendar
 * period they were MADE in (predictedAt), and report each bucket's Brier score
 * (needs predictedProbability + actualHit) and mean absolute point error
 * (needs actualValue). Lets a "is the model getting better/worse" trend render
 * without any model-specific logic.
 *
 * @param {ModelPrediction[]} predictions
 * @param {{ modelName?: string, bucket?: 'month'|'week' }} [opts]
 */
export function computeTrendOverTime(predictions, { modelName, bucket = 'month' } = {}) {
  const rows = forModel(predictions, modelName).filter((p) => p.resolved)
  const groups = new Map()
  for (const p of rows) {
    const key = bucketKey(p.predictedAt, bucket)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, ps]) => {
      const hitScored = ps.filter((p) => p.actualHit != null && p.predictedProbability != null)
      const errScored = ps.filter((p) => p.actualValue != null && p.predictedValue != null)
      const brier = hitScored.length
        ? hitScored.reduce((s, p) => s + (clamp01(p.predictedProbability) - (p.actualHit ? 1 : 0)) ** 2, 0) / hitScored.length
        : null
      const mae = errScored.length
        ? errScored.reduce((s, p) => s + Math.abs(p.predictedValue - p.actualValue), 0) / errScored.length
        : null
      return { period, n: ps.length, brier, mae }
    })
}

const clamp01 = (p) => Math.min(1, Math.max(0, p))

// YYYY-MM (month) or YYYY-Www (ISO week) key from an ISO timestamp.
function bucketKey(iso, bucket) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  if (bucket === 'week') {
    // ISO week number
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const day = t.getUTCDay() || 7
    t.setUTCDate(t.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
