// Shared client-side data-fetching hook — the one sanctioned fetch pattern
// for tabs. Implements the contract's query-key convention
// `[market, zone, dateRange]` so all tabs key their data the same way.
//
// ⚠ Contract deviation (deliberate, flagged): the contract says "React Query
// or SWR — pick whichever the GA tool already uses". The GA tool used
// neither — every tab hand-rolled useEffect + fetch + setInterval. Adding a
// caching library inside a no-behavior-change refactor buys nothing today
// (no two tabs share a key yet), so this hook centralizes the existing
// pattern instead. If/when cross-tab cache sharing is needed (Prompt 1 + 2
// share DA/RT prices), swap the internals of THIS file for React Query —
// callers already speak the query-key convention, so nothing else moves.
//
// Semantics (matching the tabs it replaced):
//  - initial load and key changes set `loading`; previous data stays visible
//  - interval + manual refreshes are background (`refreshing`, no flicker)
//  - a failed refresh keeps the last good data; `error` is only surfaced
//    when there is no data to show
//  - adapters that fall back to mock data never reject, so `error` normally
//    only fires for adapters without a fallback (e.g. the forecast file)

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Canonical query key. `market` is one of types/market.js MARKETS (or a
 * report-family id), `zone` a zone/node id or 'ontario', `dateRange` a preset
 * string or {start,end}.
 */
export function marketQueryKey({ market, zone = 'ontario', dateRange = 'latest' }) {
  return JSON.stringify([market, zone, dateRange])
}

/**
 * @param {{ market: string, zone?: string, dateRange?: any }} keyParts
 * @param {(opts: { bustCache: boolean }) => Promise<any>} fetcher resolves the
 *   tab's data; throw to signal "keep previous data" (see semantics above)
 * @param {{ refreshMs?: number }} [opts] refreshMs > 0 enables auto-refresh
 * @returns {{ data, error, loading, refreshing, refresh }}
 */
export function useMarketQuery(keyParts, fetcher, { refreshMs = 0 } = {}) {
  const key = marketQueryKey(keyParts)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  // Epoch guards against out-of-order/unmounted commits: bumped on key change
  // and unmount, and every in-flight run only commits if its epoch is current.
  const epochRef = useRef(0)

  const [state, setState] = useState({
    data: null,
    error: null,
    loading: true,
    refreshing: false,
  })

  const run = useCallback(async ({ background = false, bustCache = false } = {}) => {
    const epoch = epochRef.current
    const commit = (updater) => {
      if (epochRef.current === epoch) setState(updater)
    }
    commit((s) => (background ? { ...s, refreshing: true } : { ...s, loading: true }))
    try {
      const data = await fetcherRef.current({ bustCache })
      commit({ data, error: null, loading: false, refreshing: false })
      return { data, error: null }
    } catch (e) {
      const error = e?.message ?? String(e)
      commit((s) => ({
        ...s,
        error: s.data ? s.error : error,
        loading: false,
        refreshing: false,
      }))
      return { data: null, error }
    }
  }, [])

  useEffect(() => {
    epochRef.current += 1
    run()
    const id = refreshMs > 0 ? setInterval(() => run({ background: true }), refreshMs) : null
    return () => {
      epochRef.current += 1
      if (id) clearInterval(id)
    }
    // `key` is the serialized query key — the whole point of the convention.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshMs, run])

  /** Manual refresh (background; pass { bustCache:true } to skip edge caches). */
  const refresh = useCallback(
    ({ bustCache = false } = {}) => run({ background: true, bustCache }),
    [run],
  )

  return { ...state, refresh }
}
