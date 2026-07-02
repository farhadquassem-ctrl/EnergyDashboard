// Step 2: Environment Canada hourly weather (Toronto) via the MSC GeoMet OGC API.
//
// ECCC hourly obs are in Local Standard Time (EST year-round, no DST). We map
// each observation to a UTC hour key so it joins cleanly with the demand series.
//
// Filtering note: the OGC `datetime` param returns nothing on this collection,
// but property filters work (confirmed: CLIMATE_IDENTIFIER). So we filter by
// CLIMATE_IDENTIFIER + LOCAL_YEAR, one query per year in the window, and trim to
// the exact window client-side.
//
// Modes:
//   node src/fetch_weather.js                 -> fetch the configured station
//   node src/fetch_weather.js --list-stations -> print Toronto-area stations
//
// Output: pipeline/data/weather.json = [{ key, temp_c, dewpoint_c, humidex, wind_kmh }]

import { writeFileSync, mkdirSync } from 'node:fs'
import { DateTime } from 'luxon'
import { URLS, FILES, DATA_DIR, START_DATE, END_DATE, WEATHER_STATION, CANDIDATE_STATIONS } from './config.js'
import { fetchJson } from './lib/http.js'
import { estLocalToDateTime, utcHourKey } from './lib/time.js'
import { isMain } from './lib/is-main.js'

const EASTERN = 'America/Toronto'
// Window edges (Eastern day boundaries) — used to trim out-of-window obs.
const WINDOW_START = DateTime.fromISO(`${START_DATE}T00:00`, { zone: EASTERN })
const WINDOW_END = DateTime.fromISO(`${END_DATE}T23:59`, { zone: EASTERN })

const PAGE = 10000

function yearsInWindow(startIso, endIso) {
  const a = Number(startIso.slice(0, 4))
  const b = Number(endIso.slice(0, 4))
  const years = []
  for (let y = a; y <= b; y++) years.push(y)
  return years
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

// --- station discovery -----------------------------------------------------
// Toronto-area bounding box (name wildcards aren't reliable on the OGC API).
async function listStations() {
  const url = `${URLS.stationsItems}?bbox=-79.8,43.4,-79.1,44.0&limit=200&f=json`
  console.log(`fetch_weather --list-stations: ${url}`)
  const data = await fetchJson(url)
  const rows = (data.features ?? [])
    .map((f) => f.properties)
    .filter((p) => /TORONTO/i.test(p.STATION_NAME ?? ''))
    .map((p) => ({
      climateId: p.CLIMATE_IDENTIFIER,
      name: p.STATION_NAME,
      first: p.FIRST_DATE ?? p.HLY_FIRST_DATE ?? p.first_date,
      last: p.LAST_DATE ?? p.HLY_LAST_DATE ?? p.last_date,
    }))
  console.table(rows)
  console.log('Pick one with continuous recent hourly coverage; set it in config.js WEATHER_STATION.')
}

// --- per-station fetch -----------------------------------------------------
// Fetch one station's hourly obs within the window. The OGC `datetime` param and
// a LOCAL_YEAR filter both return nothing on this collection, but `sortby` works
// — so walk newest-first and stop once we pass the window start (~one 10k page).
async function fetchStationRows(climateId, { quiet = false } = {}) {
  const out = new Map()
  for (let offset = 0; ; offset += PAGE) {
    const url =
      `${URLS.weatherItems}?CLIMATE_IDENTIFIER=${climateId}` +
      `&sortby=-LOCAL_DATE&limit=${PAGE}&offset=${offset}&f=json`
    const data = await fetchJson(url)
    const feats = data.features ?? []
    let passedWindowStart = false
    for (const f of feats) {
      const p = f.properties
      if (p.LOCAL_YEAR == null || p.LOCAL_HOUR == null) continue
      const dt = estLocalToDateTime(+p.LOCAL_YEAR, +p.LOCAL_MONTH, +p.LOCAL_DAY, +p.LOCAL_HOUR)
      if (dt < WINDOW_START) {
        passedWindowStart = true // sorted desc, so the rest are older too
        break
      }
      if (dt > WINDOW_END) continue
      const key = utcHourKey(dt)
      out.set(key, {
        key,
        temp_c: num(p.TEMP),
        dewpoint_c: num(p.DEW_POINT_TEMP),
        humidex: num(p.HUMIDEX),
        wind_kmh: num(p.WIND_SPEED),
      })
    }
    if (!quiet) console.log(`  offset=${offset}: ${feats.length} obs (kept ${out.size})`)
    if (passedWindowStart || feats.length < PAGE) break
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// --- main fetch ------------------------------------------------------------
export async function fetchWeather() {
  const { climateId, name } = WEATHER_STATION
  console.log(`fetch_weather: station ${name} (${climateId}), ${START_DATE} .. ${END_DATE}`)
  const rows = await fetchStationRows(climateId)
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.weather, JSON.stringify(rows))
  console.log(`fetch_weather: wrote ${rows.length} hourly rows -> ${FILES.weather}`)
  if (rows.length === 0) console.warn('  WARNING: 0 rows — check the station id.')
  return rows
}

// --- compare candidate stations --------------------------------------------
// Fetch each candidate and print a coverage table so you can pick the station
// with the best hourly record for the model. Writes nothing.
const FEATURES = ['temp_c', 'dewpoint_c', 'humidex', 'wind_kmh']

async function compareStations() {
  const windowHours =
    Math.round(WINDOW_END.diff(WINDOW_START, 'hours').hours) + 1
  console.log(`Comparing stations over ${START_DATE} .. ${END_DATE} (${windowHours} hours)\n`)

  const table = []
  for (const s of CANDIDATE_STATIONS) {
    process.stdout.write(`  ${s.name} (${s.climateId})… `)
    let rows = []
    try {
      rows = await fetchStationRows(s.climateId, { quiet: true })
    } catch (e) {
      console.log(`failed: ${e.message}`)
      continue
    }
    const pct = (n) => `${(100 * (1 - n / windowHours)).toFixed(1)}%`
    const present = (feat) => rows.filter((r) => r[feat] != null).length
    console.log(`${rows.length} rows`)
    table.push({
      station: `${s.name} (${s.climateId})`,
      rows: rows.length,
      'temp missing': pct(present('temp_c')),
      'dewpt missing': pct(present('dewpoint_c')),
      'humidex missing': pct(present('humidex')),
      'wind missing': pct(present('wind_kmh')),
    })
  }
  console.log('')
  console.table(table)
  console.log('Lower "missing" is better. Set the winner with WEATHER_STATION_ID or in config.js.')
}

if (isMain(import.meta.url)) {
  const arg = process.argv
  const run = arg.includes('--list-stations')
    ? listStations
    : arg.includes('--compare')
      ? compareStations
      : fetchWeather
  run().catch((e) => {
    console.error('fetch_weather failed:', e.message)
    console.error('NOTE: verify api.weather.gc.ca egress; blocked from the Claude sandbox.')
    process.exit(1)
  })
}
