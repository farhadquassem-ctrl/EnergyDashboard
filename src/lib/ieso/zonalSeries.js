// Adapter: rolling ~24h real-time zonal price series (5-min) with the
// day-ahead hourly clearing price repeated across each hour's intervals, via
// /api/ieso?report=series&zone=<id>. Mock fallback keeps the chart rendering.

import { getJson } from './http'
import { getMockZoneSeries } from '../../data/mockData'

/**
 * 24h Real-Time vs Day-Ahead series for one zone.
 * @returns {Promise<{ series, isLive }>}
 */
export async function fetchZoneSeries(zoneId) {
  try {
    const data = await getJson(
      `/api/ieso?report=series&zone=${encodeURIComponent(zoneId)}`,
    )
    const series = (data.series ?? []).filter(
      (p) => p.zonePrice != null || p.dayAhead != null,
    )
    if (series.length === 0) throw new Error('empty series')
    return { series, isLive: true }
  } catch {
    return { series: getMockZoneSeries(zoneId), isLive: false }
  }
}

/**
 * Normalize a zone series to the shared `IntervalPrice[]` shape: one 'RT' row
 * per 5-min point plus one 'DA' row per point (the hourly DA price repeated).
 *
 * ⚠ Contract deviation (flagged, upstream fix needed): the /api/ieso series
 * payload carries only an `HH:MM` label per point — no date — so `timestamp`
 * here is NOT ISO8601 yet. Emitting real timestamps requires the serverless
 * proxy to include the delivery date, which is an API change outside this
 * no-behavior-change refactor. Consumers needing true ISO timestamps (Prompt 1
 * spread math across days) must extend api/ieso.js first.
 *
 * @param {{ label: string, zonePrice: number|null, dayAhead: number|null }[]} series
 * @param {string} zone
 * @returns {import('../../types/market').IntervalPrice[]}
 */
export function zoneSeriesToIntervalPrices(series, zone) {
  const out = []
  for (const p of series ?? []) {
    if (p.zonePrice != null) {
      out.push({ timestamp: p.label, zone, market: 'RT', price: p.zonePrice, unit: '$/MWh' })
    }
    if (p.dayAhead != null) {
      out.push({ timestamp: p.label, zone: 'ontario', market: 'DA', price: p.dayAhead, unit: '$/MWh' })
    }
  }
  return out
}
