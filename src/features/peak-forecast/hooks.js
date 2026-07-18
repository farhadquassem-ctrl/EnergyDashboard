// Data hook for the Peak Forecast tab: the GA forecast file via the lib/ieso
// adapter, keyed with the shared query-key convention.

import { useMarketQuery } from '../../lib/query/useMarketQuery'
import { fetchPeakForecast } from '../../lib/ieso/peakForecast'
import { fetchPredictionLog } from '../../lib/ieso/predictionLog'

// The adapter resolves { data, error } instead of throwing; the shared hook
// wants a throw to keep prior data visible on a failed refresh.
async function loadForecast({ bustCache } = {}) {
  const r = await fetchPeakForecast({ bustCache })
  if (r.error) throw new Error(r.error)
  return r.data
}

export function usePeakForecast() {
  return useMarketQuery(
    { market: 'GA', zone: 'ontario', dateRange: 'forecast' },
    loadForecast,
  )
}

// The prospective prediction log for the live trailing-accuracy panel. Unlike
// loadForecast, fetchPredictionLog NEVER rejects — a missing/short log is the
// normal "not accrued yet" state, resolving to { predictions: [], updatedAt } —
// so this loader passes its result straight through (no throw-on-error wrapper).
async function loadPredictionLog({ bustCache } = {}) {
  return fetchPredictionLog({ bustCache })
}

export function usePredictionLog() {
  return useMarketQuery(
    { market: 'GA', zone: 'ontario', dateRange: 'prediction-log' },
    loadPredictionLog,
  )
}
