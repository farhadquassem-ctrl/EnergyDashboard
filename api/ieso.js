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
  // Per-virtual-zone 5-min energy prices. The base file is the current hour
  // (used for the map); the directory holds dated hourly archives we stitch
  // into a rolling 24h chart series.
  zonalPrices:
    'https://reports-public.ieso.ca/public/RealtimeZonalEnergyPrices/PUB_RealtimeZonalEnergyPrices.xml',
  zonalPricesDir:
    'https://reports-public.ieso.ca/public/RealtimeZonalEnergyPrices/',
  // Province-wide real-time Ontario Zonal Price (headline price tile).
  ontarioPrice:
    'https://reports-public.ieso.ca/public/RealtimeOntarioZonalPrice/PUB_RealtimeOntarioZonalPrice.xml',
  // Day-ahead hourly Ontario Zonal Price (chart "Day-Ahead" reference line).
  daPrice:
    'https://reports-public.ieso.ca/public/DAHourlyOntarioZonalPrice/PUB_DAHourlyOntarioZonalPrice.xml',
  // Real-time 5-min nodal LMP for all ~1000 pricing locations (Nodal tab).
  // Header: Delivery Hour,Interval,Pricing Location,LMP,Energy Loss Price,
  // Energy Congestion Price. Directory name best-effort — verify on deploy.
  nodal:
    'https://reports-public.ieso.ca/public/RealtimeEnergyLMP/PUB_RealtimeEnergyLMP.csv',
  // Hourly Ontario demand (demand tile + GA risk). The zonal-demand report
  // carries scaled/test magnitudes, so we use the standard Demand report which
  // has real provincial values. Header: Date,Hour,Market Demand,Ontario Demand.
  demand: 'https://reports-public.ieso.ca/public/Demand/PUB_Demand.csv',
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

const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100)

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

// Day-ahead hourly Ontario Zonal Price: Document>DocBody>HourlyPriceComponents[]
//   { PricingHour, ZonalPrice, LossPriceCapped, CongestionPriceCapped }.
// Returns { deliveryDate, byHour: Map<hour, price> }.
function parseDAHourly(tree) {
  const body = tree?.Document?.DocBody ?? {}
  const byHour = new Map()
  for (const c of toArray(body.HourlyPriceComponents)) {
    const hour = toNum(c?.PricingHour)
    const price = toNum(c?.ZonalPrice)
    if (hour != null && price != null) byHour.set(hour, price)
  }
  return { deliveryDate: body.DeliveryDate, byHour }
}

// Parse the standard hourly Demand report (Date,Hour,Market Demand,Ontario
// Demand) and return the most recent row's Ontario Demand. The header is read
// rather than assumed, so a column reorder won't silently break it.
async function fetchOntarioDemand() {
  try {
    const text = await fetchText(REPORTS.demand)
    const lines = text.split('\n').map((l) => l.trim())
    const headerIdx = lines.findIndex(
      (l) => /(^|,)\s*Date\s*,/i.test(l) && /Ontario Demand/i.test(l),
    )
    if (headerIdx === -1) return null
    const cols = lines[headerIdx].split(',').map((c) => c.trim().toLowerCase())
    const ontarioCol = cols.indexOf('ontario demand')
    if (ontarioCol === -1) return null

    for (let i = lines.length - 1; i > headerIdx; i--) {
      const row = lines[i].split(',')
      const demand = toNum(row[ontarioCol])
      if (/\d{4}-\d{2}-\d{2}/.test(row[0] ?? '') && demand != null) return demand
    }
  } catch {
    // fall through to null -> mock fallback
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

// Fetch the most recent `hours` hourly zonal-price files from the report's
// directory autoindex (highest revision per hour) and parse them. Stateless —
// no storage. Returns parsed trees oldest→newest, or [] if the index can't be
// read (caller falls back to the current-hour file).
async function fetchZonalArchive(hours = 24) {
  const html = await fetchText(REPORTS.zonalPricesDir)
  const re = /PUB_RealtimeZonalEnergyPrices_(\d{10})_v(\d+)\.xml/g
  const latest = new Map() // stamp -> { v, file }
  let m
  while ((m = re.exec(html))) {
    const [file, stamp, v] = [m[0], m[1], Number(m[2])]
    const cur = latest.get(stamp)
    if (!cur || v > cur.v) latest.set(stamp, { v, file })
  }
  const stamps = [...latest.keys()].sort().slice(-hours)
  const trees = await Promise.all(
    stamps.map((s) =>
      fetchXml(REPORTS.zonalPricesDir + latest.get(s).file).catch(() => null),
    ),
  )
  return trees.filter(Boolean).map(parseZonalPrices)
}

async function handleSeries(zoneIdParam, debug) {
  const [archive, daTree, currentTree] = await Promise.all([
    fetchZonalArchive(24).catch(() => []),
    fetchXml(REPORTS.daPrice).catch(() => null),
    fetchXml(REPORTS.zonalPrices).catch(() => null), // current-hour fallback
  ])

  const da = daTree ? parseDAHourly(daTree) : { byHour: new Map() }

  // Prefer the rolling 24h archive; fall back to just the current hour.
  let hourly = archive
  let usedArchive = archive.length > 0
  if (!usedArchive && currentTree) hourly = [parseZonalPrices(currentTree)]

  const series = []
  for (const h of hourly) {
    const intervals = h.byZone?.[zoneIdParam]?.intervals ?? []
    // Day-ahead clears once per hour; repeat it across that hour's 5-min steps.
    const dayAhead = da.byHour.get(h.deliveryHour) ?? null
    for (const p of intervals) {
      if (p.price == null) continue
      series.push({
        label: intervalLabel(h.deliveryHour, p.interval),
        zonePrice: p.price,
        dayAhead,
      })
    }
  }

  const payload = { series, asOf: new Date().toISOString() }
  if (debug) {
    payload.debug = {
      usedArchive,
      hoursFetched: hourly.length,
      points: series.length,
    }
  }
  return payload
}

// Infer a location class from the pricing-location name. The report has no
// type field, so this is heuristic (confirmed against the sample's naming).
function inferLocationType(name) {
  const n = String(name).toUpperCase()
  if (n.endsWith('_DRA')) return 'DRA'
  // Match the storage resource token, not any "BATT" substring (e.g. the
  // place-name BATTERSEA is a load, not storage).
  if (/BATT_(LF|TG)/.test(n)) return 'Storage'
  if (/:LMP$/.test(n)) return 'Node'
  if (n.includes('LF')) return 'Load'
  if (/(\.AG|\.G\d|\.SG|\.T\d|_TG|\.TT)/.test(n)) return 'Generator'
  return 'Other'
}

// Parse the nodal LMP CSV. Two preamble lines, then a header, then rows of
// Delivery Hour,Interval,Pricing Location,LMP,Loss,Congestion. Keeps the latest
// interval per location. Returns { byNode: Map, asOf }.
function parseNodal(text) {
  const lines = text.split('\n')
  const headerIdx = lines.findIndex((l) => /Pricing Location/i.test(l))
  const createdLine = lines.find((l) => /CREATED AT/i.test(l)) ?? ''
  const asOf = (createdLine.match(/\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}/) ?? [])[0] ?? null

  const byNode = new Map()
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = lines[i].split(',')
    if (row.length < 6) continue
    const interval = toNum(row[1])
    const name = (row[2] ?? '').trim()
    const lmp = toNum(row[3])
    const loss = toNum(row[4])
    const cong = toNum(row[5])
    if (!name || interval == null || lmp == null) continue
    const prev = byNode.get(name)
    if (!prev || interval > prev.interval) {
      byNode.set(name, { interval, lmp, loss, cong })
    }
  }
  return { byNode, asOf }
}

async function handleNodal(debug) {
  const [nodalText, ontarioTree] = await Promise.all([
    fetchText(REPORTS.nodal),
    fetchXml(REPORTS.ontarioPrice).catch(() => null),
  ])

  const { byNode, asOf } = parseNodal(nodalText)
  const ontario = ontarioTree ? parseOntarioPrice(ontarioTree) : null
  const onzp = ontario?.price ?? ontario?.average ?? null

  const rows = []
  for (const [name, v] of byNode) {
    const energy =
      v.lmp != null && v.loss != null && v.cong != null
        ? round2(v.lmp - v.loss - v.cong)
        : null
    rows.push({
      nodeId: name,
      nodeName: name,
      locationType: inferLocationType(name),
      zone: null, // not published per-node; see README
      lmp: v.lmp,
      energy,
      congestion: v.cong,
      loss: v.loss,
      basis: onzp != null && v.lmp != null ? round2(v.lmp - onzp) : null,
      congestionPct:
        v.lmp != null && Math.abs(v.lmp) > 1 && v.cong != null
          ? round2((v.cong / v.lmp) * 100)
          : null,
    })
  }

  const payload = { rows, onzp, asOf, count: rows.length }
  if (debug) payload.debug = { onzp, asOf, count: rows.length }
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
    } else if (report === 'nodal') {
      payload = await handleNodal(wantDebug)
    } else {
      res.status(400).json({ error: `unknown report: ${report}` })
      return
    }
    res.status(200).json(payload)
  } catch (err) {
    res.status(502).json({ error: String(err?.message ?? err) })
  }
}
