// Client-side data access for the dashboard.
//
// Calls our own /api/ieso serverless proxy and normalizes the result into the
// shapes the components consume. On any failure (network, parse, empty data)
// it falls back to the mock data so the UI always renders.

import { ZONES } from './zones'
import {
  MOCK_ZONES,
  MOCK_SNAPSHOT,
  getMockZoneSeries,
  deriveSystemCondition,
} from './mockData'

const TIMEOUT_MS = 8000

async function getJson(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`API ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/**
 * Snapshot for the map + bottom bar.
 * @returns {{ zones, snapshot, asOf, isLive }}
 */
export async function fetchSnapshot() {
  try {
    const data = await getJson('/api/ieso?report=snapshot')
    const livePrices = Object.fromEntries(
      (data.zones ?? []).map((z) => [z.id, z.lmp]),
    )
    // Merge live prices onto our canonical zone geography. If a zone is
    // missing from the feed, fall back to its mock price so the map stays full.
    const mockById = Object.fromEntries(MOCK_ZONES.map((z) => [z.id, z.lmp]))
    const zones = ZONES.map((z) => ({
      ...z,
      lmp: livePrices[z.id] ?? mockById[z.id] ?? 50,
    }))

    const haveLivePrices = Object.keys(livePrices).length > 0
    const demandMW = data.snapshot?.demandMW ?? MOCK_SNAPSHOT.demandMW
    const price = data.snapshot?.price ?? MOCK_SNAPSHOT.price

    if (!haveLivePrices && demandMW == null) {
      throw new Error('empty snapshot')
    }

    return {
      zones,
      snapshot: {
        demandMW,
        price,
        systemCondition:
          data.snapshot?.systemCondition ?? deriveSystemCondition(demandMW),
      },
      asOf: data.asOf ?? new Date().toISOString(),
      isLive: true,
    }
  } catch {
    return {
      zones: MOCK_ZONES,
      snapshot: MOCK_SNAPSHOT,
      asOf: null,
      isLive: false,
    }
  }
}

/**
 * 24h Real-Time vs Day-Ahead series for one zone.
 * @returns {{ series, isLive }}
 */
export async function fetchZoneSeries(zoneId) {
  try {
    const data = await getJson(
      `/api/ieso?report=series&zone=${encodeURIComponent(zoneId)}`,
    )
    const series = (data.series ?? []).filter(
      (p) => p.zonePrice != null || p.ontarioPrice != null,
    )
    if (series.length === 0) throw new Error('empty series')
    return { series, isLive: true }
  } catch {
    return { series: getMockZoneSeries(zoneId), isLive: false }
  }
}
