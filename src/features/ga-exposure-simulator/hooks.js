// Data hooks for the GA Exposure tab — all three static-JSON sources through
// the shared useMarketQuery pattern (query-key convention [market, zone,
// dateRange]). The uploaded meter file itself is deliberately NOT fetched or
// stored anywhere: it stays in component state, client-side only (it is a
// customer's load profile — privacy) — see index.jsx.

import { useMarketQuery } from '../../lib/query/useMarketQuery'
import { fetchPeakForecast } from '../../lib/ieso/peakForecast'
import { fetchMonthlyGA, fetchHistorical5CP } from '../../lib/ieso/globalAdjustment'

const unwrap = (fetcher) => async (opts) => {
  const r = await fetcher(opts)
  if (r.error) throw new Error(r.error)
  return r.data
}

export function useGAForecast() {
  return useMarketQuery(
    { market: 'GA', zone: 'ontario', dateRange: 'forecast' },
    unwrap(fetchPeakForecast),
  )
}

export function useMonthlyGA() {
  return useMarketQuery(
    { market: 'GA', zone: 'ontario', dateRange: 'monthly-ga' },
    unwrap(fetchMonthlyGA),
  )
}

export function useHistorical5CP() {
  return useMarketQuery(
    { market: 'GA', zone: 'ontario', dateRange: 'historical-5cp' },
    unwrap(fetchHistorical5CP),
  )
}
