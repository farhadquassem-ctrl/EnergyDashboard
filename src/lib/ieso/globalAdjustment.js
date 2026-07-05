// Adapter: Global Adjustment reference data for the GA Exposure tab.
// Two static files (the pipeline/static-JSON pattern peakForecast.js uses —
// no backend, deploys with the app):
//
//  - /ga/monthly_ga.json      — monthly Class A GA pool + Class B rate
//    assumptions. ⚠ ILLUSTRATIVE until real IESO monthly figures are
//    substituted (ieso.ca blocks unauthenticated scraping from the pipeline
//    sandbox; the file carries `illustrative: true` + `source`, and the tab
//    exposes both knobs as editable assumptions — nothing here is presented
//    as a live IESO number).
//  - /ga/historical_5cp.json  — the OFFICIAL final 5CP per base period
//    (IESO ICI Peak Tracker ranks 1–5, AQEW), exported by the pipeline's
//    `npm run export:historical5cp` from its consolidated fixture. This is
//    IESO's ranking — never a re-rank of raw demand.

async function readStatic(path, { bustCache = false } = {}) {
  const url = bustCache ? `${path}?t=${Date.now()}` : path
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchMonthlyGA(opts) {
  try {
    const data = await readStatic('/ga/monthly_ga.json', opts)
    if (data?.annualClassAGADollars == null && !data?.months?.length) throw new Error('malformed monthly_ga.json')
    return { data, error: null }
  } catch {
    return { data: null, error: 'GA assumptions not found (public/ga/monthly_ga.json).' }
  }
}

export async function fetchHistorical5CP(opts) {
  try {
    const data = await readStatic('/ga/historical_5cp.json', opts)
    if (!data?.byBaseYear) throw new Error('malformed historical_5cp.json')
    return { data, error: null }
  } catch {
    return {
      data: null,
      error: 'Historical 5CP labels not found. Run `npm run export:historical5cp` in the pipeline and commit public/ga/historical_5cp.json.',
    }
  }
}

/**
 * Normalize one base year's peaks to the CoincidentPeak shape the
 * calculations consume ({ rank, date, hourEnding, ontarioMw }).
 * @returns {import('../../features/ga-exposure-simulator/calculations').CoincidentPeak[]|null}
 */
export function historicalPeaksFor(historical, baseYear) {
  const list = historical?.byBaseYear?.[String(baseYear)] ?? historical?.byBaseYear?.[baseYear]
  if (!list?.length) return null
  return list.map((p) => ({ rank: p.rank, date: p.date, hourEnding: p.hourEnding, ontarioMw: p.ontarioMw }))
}

/**
 * The in-progress base period's running board (forecast.json `running5CP`)
 * in the same CoincidentPeak shape, so forward mode shares the PDF math.
 */
export function runningBoardToPeaks(forecast) {
  return (forecast?.running5CP ?? []).map((p) => ({
    rank: p.rank, date: p.date, hourEnding: p.hourEnding, ontarioMw: p.mw,
  }))
}
