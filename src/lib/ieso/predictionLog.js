// Adapter: the prospective prediction log — the pipeline's durable record of
// what each model predicted, exported to public/peak-forecast/prediction_log.json
// (see pipeline `npm run log:predictions`). Read as a static file, same as the
// forecast. Rows are already in the shared ModelPrediction shape, so this just
// fetches + filters; the model-agnostic scoring lives in
// src/features/model-backtest/calculations.js.
//
// The log accumulates over time and lags reality (a 5CP outcome is only final
// at the base period's close), so it may be empty/sparse until runs bank up —
// callers should render an "accruing" state, not an error, when it's short.

export async function fetchPredictionLog({ bustCache = false } = {}) {
  try {
    const url = bustCache
      ? `/peak-forecast/prediction_log.json?t=${Date.now()}`
      : '/peak-forecast/prediction_log.json'
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return { predictions: data?.predictions ?? [], updatedAt: data?.updatedAt ?? null, error: null }
  } catch {
    // A missing/short log is a normal "not accrued yet" state, not a failure.
    return { predictions: [], updatedAt: null, error: null }
  }
}

/** Predictions for one model (default: the GA 5CP peak model). */
export function predictionsForModel(predictions, modelName = 'ga-5cp-peak') {
  return (predictions ?? []).filter((p) => p.modelName === modelName)
}
