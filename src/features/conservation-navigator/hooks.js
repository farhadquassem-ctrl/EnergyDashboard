// Data hooks for the Conservation Navigator — the curated program catalog and
// the residential rate reference, both through the shared useMarketQuery
// pattern (query-key convention [market, zone, dateRange]).

import { useMarketQuery } from '../../lib/query/useMarketQuery'
import { fetchConservationPrograms, fetchResidentialRates } from '../../lib/programs'

const unwrap = (fetcher) => async (opts) => {
  const r = await fetcher(opts)
  if (r.error) throw new Error(r.error)
  return r.data
}

export function usePrograms() {
  return useMarketQuery({ market: 'CONSERVATION', zone: 'ontario', dateRange: 'programs' }, unwrap(fetchConservationPrograms))
}

export function useResidentialRates() {
  return useMarketQuery({ market: 'CONSERVATION', zone: 'ontario', dateRange: 'rates' }, unwrap(fetchResidentialRates))
}
