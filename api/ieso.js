// Vercel serverless function: IESO public-reports proxy + normalizer.
//
// The browser can't fetch reports.ieso.ca directly (no CORS headers, and the
// legacy host is http). This function runs on Vercel's servers, fetches the
// public XML reports over HTTPS, parses them, and returns clean JSON in the
// shapes the dashboard's components expect.
//
// Endpoints (all under /api/ieso):
//   ?report=snapshot          -> { zones:[{id,name,lmp}], snapshot:{demandMW,price,systemCondition}, asOf }
//   ?report=series&zone=<id>  -> { series:[{hour,realTime,dayAhead}], asOf }
//   &debug=1                  -> also include the raw parsed XML tree(s) for
//                                inspecting the real element names
//
// NOTE: the exact XML element names below are best-effort and were written
// without a live sample (the dev sandbox can't reach the IESO host). The
// extraction is deliberately tolerant, and `?debug=1` lets us confirm the real
// structure on the deployed function and tighten the mapping. See README.

import { XMLParser } from 'fast-xml-parser'

// --- Report sources --------------------------------------------------------
// Public (no-login) IESO reports live on the reports-public.ieso.ca host.
const REPORTS = {
  rtZonal:
    'https://reports-public.ieso.ca/public/RealtimeOntarioZonalPrice/PUB_RealtimeOntarioZonalPrice.xml',
  daZonal:
    'https://reports-public.ieso.ca/public/DAHourlyOntarioZonalPrice/PUB_DAHourlyOntarioZonalPrice.xml',
  demand:
    'https://reports-public.ieso.ca/public/RealtimeTotals/PUB_RealtimeTotals.xml',
}

// IESO zone display name (lower-cased) -> dashboard zone id.
const ZONE_NAME_TO_ID = {
  northwest: 'northwest',
  northeast: 'northeast',
  ottawa: 'ottawa',
  east: 'east',
  west: 'west',
  southwest: 'southwest',
  toronto: 'toronto',
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: true,
  trimValues: true,
})

// --- Generic XML helpers ---------------------------------------------------

async function fetchXml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ieso-lmp-dashboard/1.0 (+portfolio)' },
  })
  if (!res.ok) throw new Error(`IESO responded ${res.status} for ${url}`)
  const text = await res.text()
  return parser.parse(text)
}

// Depth-first visit of every plain object in a parsed tree.
function walk(node, visit) {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit))
  } else if (node && typeof node === 'object') {
    visit(node)
    for (const key of Object.keys(node)) walk(node[key], visit)
  }
}

const toNum = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

// Find, anywhere in `obj`, the first value whose key matches `re`.
function findValueByKey(obj, re) {
  let found
  walk(obj, (node) => {
    if (found !== undefined) return
    for (const key of Object.keys(node)) {
      if (re.test(key) && typeof node[key] !== 'object') {
        found = node[key]
        return
      }
    }
  })
  return found
}

// --- Normalizers (best-effort; confirm via ?debug=1) -----------------------

// Pull a price-per-zone map { id: number } from the RT zonal-price tree.
function extractZonePrices(tree) {
  const prices = {}
  walk(tree, (node) => {
    // Look for an object that names a zone and carries a numeric price.
    const zoneRaw =
      node.ZoneName ?? node.Zone ?? node.PricingZone ?? node.Name
    if (zoneRaw == null) return
    const id = ZONE_NAME_TO_ID[String(zoneRaw).trim().toLowerCase()]
    if (!id) return

    // Prefer an explicit energy/price field; fall back to any *Price key.
    const price =
      toNum(node.ZonalPrice) ??
      toNum(node.EnergyPrice) ??
      toNum(node.LMP) ??
      toNum(node.Price) ??
      toNum(findValueByKey(node, /price|lmp|energy/i))
    if (price == null) return

    // Reports list many intervals per zone; keep the latest we encounter.
    prices[id] = price
  })
  return prices
}

// Pull a 24-point { hour, value } series for one zone from a tree.
function extractZoneSeries(tree, zoneId) {
  const series = []
  walk(tree, (node) => {
    const zoneRaw =
      node.ZoneName ?? node.Zone ?? node.PricingZone ?? node.Name
    if (zoneRaw == null) return
    const id = ZONE_NAME_TO_ID[String(zoneRaw).trim().toLowerCase()]
    if (id !== zoneId) return

    const hour = toNum(
      node.DeliveryHour ?? node.Hour ?? node.Interval ?? node.IntervalNumber,
    )
    const value =
      toNum(node.ZonalPrice) ??
      toNum(node.EnergyPrice) ??
      toNum(node.LMP) ??
      toNum(node.Price) ??
      toNum(findValueByKey(node, /price|lmp|energy/i))
    if (hour == null || value == null) return
    series.push({ hour, value })
  })
  return series
}

function extractDemand(tree) {
  // RealtimeTotals carries a provincial total demand/load figure.
  const v =
    toNum(findValueByKey(tree, /ontario.*demand|total.*demand|total.*load/i)) ??
    toNum(findValueByKey(tree, /demand|total/i))
  return v
}

function deriveSystemCondition(demandMW) {
  if (demandMW == null) return 'Normal'
  if (demandMW >= 16500) return 'Emergency'
  if (demandMW >= 15000) return 'Tight'
  return 'Normal'
}

// --- Handlers --------------------------------------------------------------

async function handleSnapshot(debug) {
  const [rt, dem] = await Promise.all([
    fetchXml(REPORTS.rtZonal),
    fetchXml(REPORTS.demand).catch(() => null),
  ])

  const prices = extractZonePrices(rt)
  const zones = Object.entries(prices).map(([id, lmp]) => ({ id, lmp }))

  const demandMW = dem ? extractDemand(dem) : null
  // Reference price for the headline tile: Toronto if present, else first zone.
  const price = prices.toronto ?? Object.values(prices)[0] ?? null

  const payload = {
    zones,
    snapshot: {
      demandMW,
      price,
      systemCondition: deriveSystemCondition(demandMW),
    },
    asOf: new Date().toISOString(),
    source: 'reports-public.ieso.ca',
  }
  if (debug) payload.raw = { rtZonal: rt, demand: dem }
  return payload
}

async function handleSeries(zoneId, debug) {
  const [rt, da] = await Promise.all([
    fetchXml(REPORTS.rtZonal).catch(() => null),
    fetchXml(REPORTS.daZonal).catch(() => null),
  ])

  const rtSeries = rt ? extractZoneSeries(rt, zoneId) : []
  const daSeries = da ? extractZoneSeries(da, zoneId) : []

  // Align both onto an hourly axis keyed by hour-of-day.
  const byHour = new Map()
  for (const { hour, value } of daSeries) {
    byHour.set(hour, { hour, dayAhead: value })
  }
  for (const { hour, value } of rtSeries) {
    byHour.set(hour, { ...(byHour.get(hour) ?? { hour }), realTime: value })
  }

  const series = [...byHour.values()]
    .sort((a, b) => a.hour - b.hour)
    .map((p) => ({
      hour: `${String(p.hour).padStart(2, '0')}:00`,
      realTime: p.realTime ?? null,
      dayAhead: p.dayAhead ?? null,
    }))

  const payload = { series, asOf: new Date().toISOString() }
  if (debug) payload.raw = { rtZonal: rt, daZonal: da }
  return payload
}

// --- Entry point -----------------------------------------------------------

export default async function handler(req, res) {
  const { report = 'snapshot', zone, debug } = req.query ?? {}
  const wantDebug = debug === '1' || debug === 'true'

  // Cache at the edge: IESO real-time reports refresh every 5 minutes.
  res.setHeader(
    'Cache-Control',
    's-maxage=120, stale-while-revalidate=300',
  )

  try {
    let payload
    if (report === 'series') {
      const zoneId = String(zone ?? '').toLowerCase()
      if (!ZONE_NAME_TO_ID[zoneId]) {
        res.status(400).json({ error: `unknown or missing zone: ${zone}` })
        return
      }
      payload = await handleSeries(zoneId, wantDebug)
    } else if (report === 'snapshot') {
      payload = await handleSnapshot(wantDebug)
    } else {
      res.status(400).json({ error: `unknown report: ${report}` })
      return
    }
    res.status(200).json(payload)
  } catch (err) {
    // Surface a clean error; the client falls back to mock data on non-200.
    res.status(502).json({ error: String(err?.message ?? err) })
  }
}
