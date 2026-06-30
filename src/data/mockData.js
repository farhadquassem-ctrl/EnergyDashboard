// Mock data for the IESO LMP dashboard.
//
// Everything here is synthetic but kept within realistic Ontario bounds:
//   - HOEP / LMP: ~$20–$120 /MWh
//   - Ontario demand: ~12,000–18,000 MW
//
// This module is the single seam to replace when wiring in the real IESO
// public reports API (see README "Next step"). Keep the exported shapes
// stable so the components don't need to change.

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

// ---------------------------------------------------------------------------
// IESO pricing zones with approximate map coordinates and a current mock LMP.
// ---------------------------------------------------------------------------
export const ZONES = [
  { id: 'northwest', name: 'Northwest', lat: 48.38, lng: -89.25, lmp: 28.4 },
  { id: 'northeast', name: 'Northeast', lat: 46.49, lng: -80.99, lmp: 41.7 },
  { id: 'ottawa', name: 'Ottawa', lat: 45.42, lng: -75.69, lmp: 72.9 },
  { id: 'east', name: 'East', lat: 44.23, lng: -76.49, lmp: 58.3 },
  { id: 'west', name: 'West', lat: 42.98, lng: -81.24, lmp: 64.1 },
  { id: 'southwest', name: 'Southwest', lat: 42.31, lng: -83.04, lmp: 88.6 },
  { id: 'toronto', name: 'Toronto', lat: 43.65, lng: -79.38, lmp: 104.2 },
]

// Geographic centre used to frame the Leaflet map over Ontario.
export const ONTARIO_CENTER = [46.5, -82.0]
export const ONTARIO_ZOOM = 5

// ---------------------------------------------------------------------------
// 24h price series (Real-Time vs Day-Ahead) for a given zone.
// Returns 24 hourly points; values stay within the realistic $/MWh band.
// ---------------------------------------------------------------------------
export function getZonePriceSeries(zoneId) {
  const zone = ZONES.find((z) => z.id === zoneId) ?? ZONES[0]
  // Seed from the zone so each zone has a distinct but stable shape.
  const rand = seeded(
    zone.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 7),
  )

  const base = zone.lmp
  const points = []
  for (let hour = 0; hour < 24; hour++) {
    // Diurnal shape: morning ramp + evening peak around 18:00.
    const diurnal =
      18 * Math.sin(((hour - 6) / 24) * Math.PI * 2) +
      22 * Math.exp(-Math.pow(hour - 18, 2) / 6)

    const rtNoise = (rand() - 0.5) * 16
    const daNoise = (rand() - 0.5) * 8

    const realTime = clampPrice(base + diurnal + rtNoise)
    // Day-ahead is smoother and tracks the real-time signal loosely.
    const dayAhead = clampPrice(base + diurnal * 0.85 + daNoise)

    points.push({
      hour: `${String(hour).padStart(2, '0')}:00`,
      realTime: round1(realTime),
      dayAhead: round1(dayAhead),
    })
  }
  return points
}

// ---------------------------------------------------------------------------
// GA (Global Adjustment) peak-risk indicator.
// In reality this is driven by forecast top-5 demand peaks; here we derive a
// simple Green / Yellow / Red status from the mock provincial demand.
// ---------------------------------------------------------------------------
export function getGAPeakRisk(demandMW = SYSTEM_SNAPSHOT.demandMW) {
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

// ---------------------------------------------------------------------------
// Bottom-bar system snapshot: Ontario demand, HOEP, and system condition.
// ---------------------------------------------------------------------------
export const SYSTEM_SNAPSHOT = {
  demandMW: 15820,
  hoep: 96.4,
  // One of: 'Normal' | 'Tight' | 'Emergency'
  systemCondition: 'Tight',
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
