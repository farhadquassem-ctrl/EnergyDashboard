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
import { URLS, FILES, DATA_DIR, START_DATE, END_DATE, WEATHER_STATION } from './config.js'
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

// --- main fetch ------------------------------------------------------------
export async function fetchWeather() {
  const { climateId, name } = WEATHER_STATION
  console.log(`fetch_weather: station ${name} (${climateId}), ${START_DATE} .. ${END_DATE}`)

  const out = new Map()
  for (const year of yearsInWindow(START_DATE, END_DATE)) {
    for (let offset = 0; ; offset += PAGE) {
      const url =
        `${URLS.weatherItems}?CLIMATE_IDENTIFIER=${climateId}&LOCAL_YEAR=${year}` +
        `&limit=${PAGE}&offset=${offset}&f=json`
      const data = await fetchJson(url)
      const feats = data.features ?? []
      for (const f of feats) {
        const p = f.properties
        if (p.LOCAL_YEAR == null || p.LOCAL_HOUR == null) continue
        const dt = estLocalToDateTime(+p.LOCAL_YEAR, +p.LOCAL_MONTH, +p.LOCAL_DAY, +p.LOCAL_HOUR)
        const key = utcHourKey(dt)
        // keep only the requested window (year queries include out-of-window months)
        if (dt < WINDOW_START || dt > WINDOW_END) continue
        out.set(key, {
          key,
          temp_c: num(p.TEMP),
          dewpoint_c: num(p.DEW_POINT_TEMP),
          humidex: num(p.HUMIDEX),
          wind_kmh: num(p.WIND_SPEED),
        })
      }
      console.log(`  ${year} offset=${offset}: ${feats.length} obs (kept ${out.size})`)
      if (feats.length < PAGE) break
    }
  }

  const rows = [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.weather, JSON.stringify(rows))
  console.log(`fetch_weather: wrote ${rows.length} hourly rows -> ${FILES.weather}`)
  if (rows.length === 0) console.warn('  WARNING: 0 rows — check the station id / LOCAL_YEAR filter.')
  return rows
}

if (isMain(import.meta.url)) {
  const run = process.argv.includes('--list-stations') ? listStations : fetchWeather
  run().catch((e) => {
    console.error('fetch_weather failed:', e.message)
    console.error('NOTE: verify api.weather.gc.ca egress; blocked from the Claude sandbox.')
    process.exit(1)
  })
}
