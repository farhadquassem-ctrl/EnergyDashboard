// Adapter: real-time market snapshot (zonal prices + Ontario demand) via
// /api/ieso?report=snapshot. On any failure it falls back to mock data so the
// UI always renders (isLive:false marks the fallback).

import { getJson } from './http'
import { ZONES } from '../../data/zones'
import { MOCK_ZONES, MOCK_SNAPSHOT, deriveSystemCondition } from '../../data/mockData'

/**
 * Snapshot for the map + bottom bar.
 * @returns {Promise<{ zones, snapshot, asOf, isLive }>}
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
 * Normalize a snapshot result to the shared `DemandInterval` shape.
 * @param {{ snapshot: { demandMW: number }, asOf: string|null }} result
 * @returns {import('../../types/market').DemandInterval|null}
 */
export function snapshotToDemandInterval(result) {
  if (result?.snapshot?.demandMW == null) return null
  return {
    timestamp: result.asOf ?? new Date().toISOString(),
    ontarioDemand: result.snapshot.demandMW,
  }
}

/**
 * Normalize a snapshot's zonal prices to `IntervalPrice[]` (market 'RT').
 * @returns {import('../../types/market').IntervalPrice[]}
 */
export function snapshotToIntervalPrices(result) {
  const ts = result?.asOf ?? new Date().toISOString()
  return (result?.zones ?? [])
    .filter((z) => z.lmp != null)
    .map((z) => ({
      timestamp: ts,
      zone: z.id,
      market: 'RT',
      price: z.lmp,
      unit: '$/MWh',
    }))
}
