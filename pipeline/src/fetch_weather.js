// Step 2: Environment Canada hourly weather (Toronto) via the MSC GeoMet OGC API.
//
// ECCC hourly obs are in Local Standard Time (EST year-round, no DST). We map
// each observation to a UTC hour key so it joins cleanly with the demand series.
//
// Modes:
//   node src/fetch_weather.js                -> fetch the configured station
//   node src/fetch_weather.js --list-stations -> print Toronto station candidates
//
// Output: pipeline/data/weather.json = [{ key, temp_c, dewpoint_c, humidex, wind_kmh }]

import { writeFileSync, mkdirSync } from 'node:fs'
import { URLS, FILES, DATA_DIR, START_DATE, END_DATE, WEATHER_STATION } from './config.js'
import { fetchJson } from './lib/http.js'
import { estLocalToDateTime, utcHourKey } from './lib/time.js'
import { isMain } from './lib/is-main.js'

const PAGE = 10000

// --- station discovery -----------------------------------------------------
// Helps you verify the right Toronto station (continuous hourly coverage)
// before committing to a CLIMATE_IDENTIFIER in config.js.
async function listStations() {
  const url = `${URLS.stationsItems}?STATION_NAME=TORONTO*&f=json&limit=100`
  console.log(`fetch_weather --list-stations: ${url}`)
  const data = await fetchJson(url)
  const rows = (data.features ?? [])
    .map((f) => f.properties)
    .filter((p) => /TORONTO/i.test(p.STATION_NAME ?? ''))
    .map((p) => ({
      climateId: p.CLIMATE_IDENTIFIER,
      name: p.STATION_NAME,
      first: p.FIRST_DATE ?? p.HLY_FIRST_DATE,
      last: p.LAST_DATE ?? p.HLY_LAST_DATE,
    }))
  console.table(rows)
  console.log('Pick one with continuous recent hourly coverage; set it in config.js WEATHER_STATION.')
}

// --- main fetch ------------------------------------------------------------
function propHour(p) {
  // Prefer explicit LOCAL_* parts; fall back to parsing LOCAL_DATE.
  if (p.LOCAL_YEAR && p.LOCAL_MONTH && p.LOCAL_DAY && p.LOCAL_HOUR != null) {
    return { y: +p.LOCAL_YEAR, mo: +p.LOCAL_MONTH, d: +p.LOCAL_DAY, h: +p.LOCAL_HOUR }
  }
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/.exec(p.LOCAL_DATE ?? '')
  if (!m) return null
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4] }
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

export async function fetchWeather() {
  const { climateId, name } = WEATHER_STATION
  console.log(`fetch_weather: station ${name} (${climateId})`)

  const out = new Map()
  for (let offset = 0; ; offset += PAGE) {
    const url =
      `${URLS.weatherItems}?CLIMATE_IDENTIFIER=${climateId}` +
      `&datetime=${START_DATE}T00:00:00Z/${END_DATE}T23:59:59Z` +
      `&sortby=LOCAL_DATE&limit=${PAGE}&offset=${offset}&f=json`
    const data = await fetchJson(url)
    const feats = data.features ?? []
    for (const f of feats) {
      const p = f.properties
      const t = propHour(p)
      if (!t) continue
      const dt = estLocalToDateTime(t.y, t.mo, t.d, t.h)
      out.set(utcHourKey(dt), {
        key: utcHourKey(dt),
        temp_c: num(p.TEMP),
        dewpoint_c: num(p.DEW_POINT_TEMP),
        humidex: num(p.HUMIDEX),
        wind_kmh: num(p.WIND_SPEED),
      })
    }
    console.log(`  page offset=${offset}: ${feats.length} obs (running ${out.size})`)
    if (feats.length < PAGE) break
  }

  const rows = [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.weather, JSON.stringify(rows))
  console.log(`fetch_weather: wrote ${rows.length} hourly rows -> ${FILES.weather}`)
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
