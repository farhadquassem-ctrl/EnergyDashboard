// Overview-tab data hooks, built on the shared useMarketQuery hook (query-key
// convention [market, zone, dateRange]) over the lib/ieso adapters. Return
// shapes are unchanged from the original hand-rolled hooks.

import { useMarketQuery } from '../lib/query/useMarketQuery'
import { fetchSnapshot } from '../lib/ieso/snapshot'
import { fetchZoneSeries } from '../lib/ieso/zonalSeries'

const REFRESH_MS = 5 * 60 * 1000 // IESO real-time reports update every 5 min.

/**
 * Loads the market snapshot (zones + bottom-bar stats) and refreshes it on the
 * IESO update cadence. Always resolves to renderable data (live or mock).
 */
export function useSnapshot() {
  const { data, loading } = useMarketQuery(
    { market: 'RT', zone: 'ontario', dateRange: 'latest' },
    () => fetchSnapshot(),
    { refreshMs: REFRESH_MS },
  )
  return {
    zones: data?.zones ?? [],
    snapshot: data?.snapshot ?? null,
    asOf: data?.asOf ?? null,
    isLive: data?.isLive ?? false,
    loading,
  }
}

/**
 * Loads the 24h price series for the selected zone, re-fetching when it changes.
 */
export function useZoneSeries(zoneId) {
  const { data, loading } = useMarketQuery(
    { market: 'RT', zone: zoneId, dateRange: '24h' },
    () => fetchZoneSeries(zoneId),
  )
  return {
    series: data?.series ?? [],
    isLive: data?.isLive ?? false,
    loading,
  }
}
