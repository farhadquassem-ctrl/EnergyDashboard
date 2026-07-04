// Data hook for the Peak Forecast tab: the GA forecast file via the lib/ieso
// adapter, keyed with the shared query-key convention.

import { useMarketQuery } from '../../lib/query/useMarketQuery'
import { fetchPeakForecast } from '../../lib/ieso/peakForecast'

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
