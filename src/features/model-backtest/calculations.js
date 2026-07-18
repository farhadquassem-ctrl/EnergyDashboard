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

/**
 * The schemaVersion-2 diagnostic split for a lead bucket (or the lead-0
 * `accuracyBaseline` entry passed directly): pooled Σhits/Σtruths recalls +
 * raw counts, null-safe against v1 files that predate the fields.
 * @returns {{ dayRecall:number|null, windowedRecall:number|null,
 *             cpHourFilterSurvival:number|null, top5Days:number|null,
 *             actualTop5Hours:number|null }|null}
 */
export function leadDiagnostics(entry) {
  const p = entry?.pooled
  if (!p) return null
  return {
    dayRecall: p.dayRecall ?? null,
    windowedRecall: p.balancedRecall ?? null,
    cpHourFilterSurvival: p.cpHourFilterSurvival ?? null,
    top5Days: p.top5Days ?? null,
    actualTop5Hours: p.actualTop5Hours ?? null,
  }
}

/**
 * Headline recall for a lead: the pooled Σ/Σ number when the file carries it
 * (schemaVersion ≥ 2 — stable, count-backed), else the yearly mean (v1).
 */
export function leadHeadlineRecall(accuracyByLead, lead) {
  return leadDiagnostics(accuracyByLead?.[String(lead)])?.windowedRecall
    ?? leadRecall(accuracyByLead, lead)
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

// --- trailing-window summary (the live prediction-log accuracy panel) -------
// Unlike computeTrendOverTime (buckets by predictedAt), the trailing panel
// filters by TARGET date (D5): "how accurate were our predictions ABOUT the
// last N months", which is the window a reader actually means. Point-error
// (MAE/MAPE/bias) is computable now — actualValue resolves the day after each
// target day — while the top-5 hit label stays pending until a base period
// closes (Apr 30), so this returns both and lets the UI show the honest split.

const LEAD_BUCKETS = [
  { bucket: '1-3d', min: 1, max: 3 },
  { bucket: '4-7d', min: 4, max: 7 },
  { bucket: '8-14d', min: 8, max: 14 },
]

// YYYY-MM-DD (UTC) for a Date — matches the repo's string-compare date convention.
const pad2 = (n) => String(n).padStart(2, '0')
function isoDateUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}
// [start, end] YYYY-MM-DD for the trailing `months` calendar months ending at `now`.
function trailingBounds(now, months) {
  const end = isoDateUTC(now)
  const start = isoDateUTC(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate())))
  return { windowStart: start, windowEnd: end }
}

/**
 * Rows of a model whose TARGET date (D5 — the day being predicted, not the day
 * the prediction was made) falls in the trailing `months` calendar months
 * ending at `now`, inclusive. YYYY-MM-DD string compare (repo convention).
 *
 * @param {ModelPrediction[]} predictions
 * @param {{ modelName?: string, months?: number, now?: Date }} [opts]
 */
export function filterTrailingWindow(predictions, { modelName, months = 6, now = new Date() } = {}) {
  const { windowStart, windowEnd } = trailingBounds(now, months)
  return forModel(predictions, modelName).filter(
    (p) => p.targetDate >= windowStart && p.targetDate <= windowEnd,
  )
}

/**
 * Live trailing-accuracy summary from a model's prospective prediction log.
 * MW-error metrics (mae/mape/signed bias) over resolved rows in the window;
 * a by-lead breakdown; and the detection hit-rate (which stays at
 * resolved:0 until a base period closes and actualHit populates).
 *
 * `bias` is signed mean(predicted − actual): negative ⇒ the model runs low
 * (under-predicts), which the committed log currently shows.
 *
 * @param {ModelPrediction[]} predictions
 * @param {{ modelName?: string, months?: number, now?: Date, threshold?: number }} [opts]
 * @returns {{ months:number, windowStart:string, windowEnd:string, n:number,
 *   resolvedN:number, mae:number|null, mape:number|null, bias:number|null,
 *   byLead:{bucket:string,n:number,mae:number|null,mape:number|null}[],
 *   hit:ReturnType<typeof computeHitRate>, hitPendingN:number }}
 */
export function computeTrailingSummary(predictions, { modelName, months = 6, now = new Date(), threshold = 0.5 } = {}) {
  const { windowStart, windowEnd } = trailingBounds(now, months)
  const windowRows = filterTrailingWindow(predictions, { modelName, months, now })
  const resolved = windowRows.filter((p) => p.actualValue != null && p.predictedValue != null)

  const mae = resolved.length
    ? resolved.reduce((s, p) => s + Math.abs(p.predictedValue - p.actualValue), 0) / resolved.length
    : null
  const bias = resolved.length
    ? resolved.reduce((s, p) => s + (p.predictedValue - p.actualValue), 0) / resolved.length
    : null
  const mapeRows = resolved.filter((p) => p.actualValue > 0)
  const mape = mapeRows.length
    ? mapeRows.reduce((s, p) => s + Math.abs(p.predictedValue - p.actualValue) / p.actualValue, 0) / mapeRows.length
    : null

  const byLead = LEAD_BUCKETS.map(({ bucket, min, max }) => {
    const rows = resolved.filter((p) => p.leadTimeDays >= min && p.leadTimeDays <= max)
    const mrows = rows.filter((p) => p.actualValue > 0)
    return {
      bucket,
      n: rows.length,
      mae: rows.length ? rows.reduce((s, p) => s + Math.abs(p.predictedValue - p.actualValue), 0) / rows.length : null,
      mape: mrows.length ? mrows.reduce((s, p) => s + Math.abs(p.predictedValue - p.actualValue) / p.actualValue, 0) / mrows.length : null,
    }
  })

  const hit = computeHitRate(windowRows, { modelName, threshold })
  const hitPendingN = windowRows.filter((p) => p.resolved && p.actualHit == null).length

  return {
    months,
    windowStart,
    windowEnd,
    n: windowRows.length,
    resolvedN: resolved.length,
    mae,
    mape,
    bias,
    byLead,
    hit,
    hitPendingN,
  }
}

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
