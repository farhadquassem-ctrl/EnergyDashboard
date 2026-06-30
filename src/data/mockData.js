// Mock / fallback data for the IESO LMP dashboard.
//
// This is now the *fallback* source: the app prefers live IESO data (see
// iesoClient.js) and drops back to these values when the API is unreachable or
// a parse fails, so the UI always renders something sensible.
//
// Everything here stays within realistic Ontario bounds:
//   - prices: ~$20–$120 /MWh
//   - Ontario demand: ~12,000–18,000 MW

import { ZONES } from './zones'

// ---------------------------------------------------------------------------
// Deterministic pseudo-random helper so the mock data is stable across
// re-renders (no flicker) but still looks varied.
// ---------------------------------------------------------------------------
function seeded(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

// Representative fallback price ($/MWh) per zone.
const FALLBACK_LMP = {
  northwest: 28.4,
  northeast: 41.7,
  ottawa: 72.9,
  east: 58.3,
  west: 64.1,
  southwest: 88.6,
  toronto: 104.2,
}

// Zones decorated with a fallback price, matching the live `zones` shape.
export const MOCK_ZONES = ZONES.map((z) => ({
  ...z,
  lmp: FALLBACK_LMP[z.id] ?? 50,
}))

// ---------------------------------------------------------------------------
// Current-hour 5-minute price series for a zone (matches the live shape:
// zone price vs the province-wide Ontario price). 12 intervals.
// ---------------------------------------------------------------------------
export function getMockZoneSeries(zoneId) {
  const base = FALLBACK_LMP[zoneId] ?? 50
  const ontarioBase = 60
  const rand = seeded(
    String(zoneId)
      .split('')
      .reduce((acc, c) => acc + c.charCodeAt(0), 7),
  )

  const points = []
  for (let i = 0; i < 12; i++) {
    const drift = 6 * Math.sin(i / 2)
    points.push({
      label: `:${String(i * 5).padStart(2, '0')}`,
      zonePrice: round1(clampPrice(base + drift + (rand() - 0.5) * 8)),
      ontarioPrice: round1(clampPrice(ontarioBase + drift + (rand() - 0.5) * 6)),
    })
  }
  return points
}

// ---------------------------------------------------------------------------
// Fallback system snapshot: Ontario demand, reference price, system condition.
// `price` is the Ontario Zonal Price / OEMP (HOEP was retired May 2025).
// ---------------------------------------------------------------------------
export const MOCK_SNAPSHOT = {
  demandMW: 15820,
  price: 96.4,
  // One of: 'Normal' | 'Tight' | 'Emergency'
  systemCondition: 'Tight',
}

// ---------------------------------------------------------------------------
// GA (Global Adjustment) peak-risk indicator.
// Derived from provincial demand: a simple Green / Yellow / Red status.
// ---------------------------------------------------------------------------
export function getGAPeakRisk(demandMW = MOCK_SNAPSHOT.demandMW) {
  if (demandMW >= 16500) {
    return {
      level: 'Red',
      label: 'High peak risk',
      detail: 'Demand approaching a probable Top-5 GA coincident peak.',
    }
  }
  if (demandMW >= 15000) {
    return {
      level: 'Yellow',
      label: 'Elevated peak risk',
      detail: 'Demand trending high — monitor for a possible peak event.',
    }
  }
  return {
    level: 'Green',
    label: 'Low peak risk',
    detail: 'Demand well below peak-event thresholds.',
  }
}

// Derive a coarse system condition from demand (used for live data, which
// doesn't ship a single "condition" field).
export function deriveSystemCondition(demandMW) {
  if (demandMW >= 16500) return 'Emergency'
  if (demandMW >= 15000) return 'Tight'
  return 'Normal'
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clampPrice(v) {
  return Math.min(120, Math.max(20, v))
}
function round1(v) {
  return Math.round(v * 10) / 10
}
