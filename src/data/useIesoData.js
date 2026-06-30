import { useEffect, useState } from 'react'
import { fetchSnapshot, fetchZoneSeries } from './iesoClient'

const REFRESH_MS = 5 * 60 * 1000 // IESO real-time reports update every 5 min.

/**
 * Loads the market snapshot (zones + bottom-bar stats) and refreshes it on the
 * IESO update cadence. Always resolves to renderable data (live or mock).
 */
export function useSnapshot() {
  const [state, setState] = useState({
    zones: [],
    snapshot: null,
    asOf: null,
    isLive: false,
    loading: true,
  })

  useEffect(() => {
    let active = true
    const load = async () => {
      const data = await fetchSnapshot()
      if (active) setState({ ...data, loading: false })
    }
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  return state
}

/**
 * Loads the 24h price series for the selected zone, re-fetching when it changes.
 */
export function useZoneSeries(zoneId) {
  const [state, setState] = useState({
    series: [],
    isLive: false,
    loading: true,
  })

  useEffect(() => {
    let active = true
    setState((s) => ({ ...s, loading: true }))
    fetchZoneSeries(zoneId).then((data) => {
      if (active) setState({ ...data, loading: false })
    })
    return () => {
      active = false
    }
  }, [zoneId])

  return state
}
