// Vercel serverless function: IESO public-reports proxy + normalizer.
//
// The browser can't fetch the IESO reports directly (no CORS headers), so this
// function runs on Vercel's servers, fetches the public XML/CSV reports over
// HTTPS, parses them, and returns clean JSON in the shapes the dashboard wants.
//
// Endpoints (all under /api/ieso):
//   ?report=snapshot          -> per-zone prices + province price + demand
//   ?report=series&zone=<id>  -> current-hour 5-min series for one zone
//   &debug=1                  -> also include the raw parsed report(s)
//
// Field mappings below were confirmed against real sample reports in
// docs/Sample-Reports/. See README "Live data" for the report catalogue.

import { XMLParser } from 'fast-xml-parser'

// --- Report sources (public, no login) -------------------------------------
const REPORTS = {
  // Per-virtual-zone 5-min energy prices (map + per-zone chart series).
  zonalPrices:
    'https://reports-public.ieso.ca/public/RealtimeZonalEnergyPrices/PUB_RealtimeZonalEnergyPrices.xml',
  // Province-wide Ontario Zonal Price (headline price tile + chart reference).
  ontarioPrice:
    'https://reports-public.ieso.ca/public/RealtimeOntarioZonalPrice/PUB_RealtimeOntarioZonalPrice.xml',
  // Per-zone 5-min demand (Ontario total used for the demand tile + GA risk).
  // This CSV is large; we range-fetch the tail. Path confirmed against the IESO
  // report index: RealtimeDemandZonal/PUB_RealtimeDemandZonal.csv.
  demand:
    'https://reports-public.ieso.ca/public/RealtimeDemandZonal/PUB_RealtimeDemandZonal.csv',
}

// Dashboard zone ids (subset of IESO's virtual zones we plot).
const KNOWN_ZONES = new Set([
  'northwest',
  'northeast',
  'ottawa',
  'east',
  'west',
  'southwest',
  'toronto',
])

// Column index of "Ontario Demand" in the zonal-demand CSV
// (Date,Hour,Interval,Ontario Demand,NORTHWEST,...).
const DEMAND_ONTARIO_COL = 3

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
})

// --- helpers ---------------------------------------------------------------

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

const toNum = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim())
  return Number.isFinite(n) ? n : null
}

// "NORTHWEST:HUB" / "Toronto" -> "northwest" / "toronto" (or null if unknown).
function zoneId(zoneName) {
  const base = String(zoneName ?? '')
    .split(':')[0]
    .trim()
    .toLowerCase()
  return KNOWN_ZONES.has(base) ? base : null
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ieso-lmp-dashboard/1.0 (+portfolio)', ...headers },
  })
  if (!res.ok && res.status !== 206) {
    throw new Error(`IESO responded ${res.status} for ${url}`)
  }
  return res.text()
}

async function fetchXml(url) {
  return parser.parse(await fetchText(url))
}

// --- parsers (confirmed against docs/Sample-Reports) -----------------------

// RealtimeZonalEnergyPrices: Document>DocBody>ZonalPrices>TransactionZone[]
//   each: ZoneName, IntervalPrice[] { Interval, ZonalPrice, EnergyLossPrice,
//   EnergyCongPrice, FlagNo }. Returns { deliveryHour, byZone:{id:{price,intervals[]}} }.
function parseZonalPrices(tree) {
  const body = tree?.Document?.DocBody ?? {}
  const deliveryHour = toNum(body.DELIVERYHOUR)
  const zones = toArray(body?.ZonalPrices?.TransactionZone)

  const byZone = {}
  for (const z of zones) {
    const id = zoneId(z?.ZoneName)
    if (!id) continue
    const intervals = toArray(z?.IntervalPrice)
      .map((ip) => ({
        interval: toNum(ip?.Interval),
        price: toNum(ip?.ZonalPrice),
        loss: toNum(ip?.EnergyLossPrice),
        cong: toNum(ip?.EnergyCongPrice),
      }))
      .filter((p) => p.interval != null)

    // Current price = last interval that has a numeric price.
    const priced = intervals.filter((p) => p.price != null)
    const latest = priced[priced.length - 1]
    byZone[id] = { price: latest?.price ?? null, intervals }
  }
  return { deliveryHour, byZone }
}

// RealtimeOntarioZonalPrice: Document>DocBody> DeliveryHour, ZonalPrice[]
//   { Interval, LmpCap, LossPriceCap, CongPriceCap }, AveragePrice{ LmpCap }.
function parseOntarioPrice(tree) {
  const body = tree?.Document?.DocBody ?? {}
  const deliveryHour = toNum(body.DeliveryHour)
  const intervals = toArray(body.ZonalPrice)
    .map((zp) => ({
      interval: toNum(zp?.Interval),
      price: toNum(zp?.LmpCap),
    }))
    .filter((p) => p.interval != null)

  const priced = intervals.filter((p) => p.price != null)
  const latest = priced[priced.length - 1]
  const average = toNum(body?.AveragePrice?.LmpCap)
  return {
    deliveryHour,
    price: latest?.price ?? average,
    average,
    intervals,
  }
}

// Range-fetch the tail of the (large) zonal-demand CSV and read the most
// recent row's Ontario Demand value. Returns a number or null.
async function fetchOntarioDemand() {
  try {
    const text = await fetchText(REPORTS.demand, { Range: 'bytes=-65536' })
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    // Walk backwards to the last line that looks like a data row.
    for (let i = lines.length - 1; i >= 0; i--) {
      const cols = lines[i].split(',')
      const demand = toNum(cols[DEMAND_ONTARIO_COL])
      // Data rows start with a date (col 0) and have many columns.
      if (cols.length > DEMAND_ONTARIO_COL && /\d{4}-\d{2}-\d{2}/.test(cols[0]) && demand != null) {
        return demand
      }
    }
  } catch {
    // fall through
  }
  return null
}

function deriveSystemCondition(demandMW) {
  if (demandMW == null) return 'Normal'
  if (demandMW >= 22000) return 'Emergency'
  if (demandMW >= 19000) return 'Tight'
  return 'Normal'
}

function intervalLabel(deliveryHour, interval) {
  // IESO delivery hour H covers (H-1):00–H:00; interval n is a 5-min step.
  const baseHour = ((deliveryHour ?? 1) - 1 + 24) % 24
  const minute = ((interval ?? 1) - 1) * 5
  return `${String(baseHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// --- handlers --------------------------------------------------------------

async function handleSnapshot(debug) {
  const [zonalTree, ontarioTree, demandMW] = await Promise.all([
    fetchXml(REPORTS.zonalPrices),
    fetchXml(REPORTS.ontarioPrice).catch(() => null),
    fetchOntarioDemand(),
  ])

  const zonal = parseZonalPrices(zonalTree)
  const ontario = ontarioTree ? parseOntarioPrice(ontarioTree) : null

  const zones = Object.entries(zonal.byZone)
    .filter(([, v]) => v.price != null)
    .map(([id, v]) => ({ id, lmp: v.price }))

  const price = ontario?.price ?? null

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
  if (debug) payload.raw = { zonalPrices: zonalTree, ontarioPrice: ontarioTree }
  return payload
}

async function handleSeries(zoneIdParam, debug) {
  const [zonalTree, ontarioTree] = await Promise.all([
    fetchXml(REPORTS.zonalPrices).catch(() => null),
    fetchXml(REPORTS.ontarioPrice).catch(() => null),
  ])

  const zonal = zonalTree ? parseZonalPrices(zonalTree) : { byZone: {} }
  const ontario = ontarioTree ? parseOntarioPrice(ontarioTree) : null

  const zoneIntervals = zonal.byZone[zoneIdParam]?.intervals ?? []
  const ontarioByInterval = new Map(
    (ontario?.intervals ?? []).map((p) => [p.interval, p.price]),
  )

  const series = zoneIntervals
    .filter((p) => p.price != null)
    .map((p) => ({
      label: intervalLabel(zonal.deliveryHour, p.interval),
      zonePrice: p.price,
      ontarioPrice: ontarioByInterval.get(p.interval) ?? null,
    }))

  const payload = { series, asOf: new Date().toISOString() }
  if (debug) payload.raw = { zonalPrices: zonalTree, ontarioPrice: ontarioTree }
  return payload
}

// --- entry point -----------------------------------------------------------

export default async function handler(req, res) {
  const { report = 'snapshot', zone, debug } = req.query ?? {}
  const wantDebug = debug === '1' || debug === 'true'

  // Edge cache: IESO real-time reports refresh every ~5 minutes, so cache for
  // 5 minutes and serve stale-while-revalidate for a smooth refresh.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

  try {
    let payload
    if (report === 'series') {
      const id = String(zone ?? '').toLowerCase()
      if (!KNOWN_ZONES.has(id)) {
        res.status(400).json({ error: `unknown or missing zone: ${zone}` })
        return
      }
      payload = await handleSeries(id, wantDebug)
    } else if (report === 'snapshot') {
      payload = await handleSnapshot(wantDebug)
    } else {
      res.status(400).json({ error: `unknown report: ${report}` })
      return
    }
    res.status(200).json(payload)
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err) })
  }
}
