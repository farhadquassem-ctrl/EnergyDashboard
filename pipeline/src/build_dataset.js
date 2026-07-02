// Step 4: join demand + weather + peak labels onto one hourly Eastern index,
// add calendar/holiday features, write the dataset CSV, and print a QA summary.
//
// Reads the three intermediates (run the fetch steps first). Everything joins on
// the UTC hour key so the three different clocks (EPT / EST / EST) line up.
//
// Output: pipeline/data/peak_dataset.csv

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { FILES, DATA_DIR, START_DATE, END_DATE } from './config.js'
import { toCsv } from './lib/csv.js'
import { easternHourlyIndex, calendarFeatures, easternIso } from './lib/time.js'
import { isOntarioHoliday } from './lib/holidays.js'
import { isMain } from './lib/is-main.js'

const COLUMNS = [
  'timestamp',
  'ontario_demand_mw',
  'market_demand_mw',
  'temp_c',
  'dewpoint_c',
  'humidex',
  'wind_kmh',
  'hour_of_day',
  'day_of_week',
  'month',
  'is_weekend',
  'is_holiday',
  'is_top5_peak',
  'is_top10_peak',
]

function loadJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`missing ${label} (${path}). Run the fetch step first.`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function buildDataset() {
  const demand = loadJson(FILES.demand, 'demand.json')
  const weather = loadJson(FILES.weather, 'weather.json')
  const peaks = loadJson(FILES.peaks, 'peaks.json')

  const demandByKey = new Map(demand.map((r) => [r.key, r]))
  const weatherByKey = new Map(weather.map((r) => [r.key, r]))
  const top5 = new Set(peaks.top5)
  const top10 = new Set(peaks.top10)

  const index = easternHourlyIndex(START_DATE, END_DATE)
  const rows = index.map(({ key, eastern }) => {
    const d = demandByKey.get(key)
    const w = weatherByKey.get(key)
    const cal = calendarFeatures(eastern)
    return {
      timestamp: easternIso(eastern),
      ontario_demand_mw: d?.ontario_demand_mw ?? '',
      market_demand_mw: d?.market_demand_mw ?? '',
      temp_c: w?.temp_c ?? '',
      dewpoint_c: w?.dewpoint_c ?? '',
      humidex: w?.humidex ?? '',
      wind_kmh: w?.wind_kmh ?? '',
      ...cal,
      is_holiday: isOntarioHoliday(eastern),
      is_top5_peak: top5.has(key) ? 1 : 0,
      is_top10_peak: top10.has(key) ? 1 : 0,
    }
  })

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.dataset, toCsv(COLUMNS, rows))
  printSummary(rows, peaks)
  return rows
}

function printSummary(rows, peaks) {
  const n = rows.length
  console.log(`\n=== peak_dataset.csv — ${n} hourly rows ===`)
  console.log(`date range: ${rows[0]?.timestamp} -> ${rows.at(-1)?.timestamp}`)

  console.log('\nmissing values per column:')
  for (const c of COLUMNS) {
    const miss = rows.filter((r) => r[c] === '' || r[c] === null || r[c] === undefined).length
    if (miss > 0) console.log(`  ${c.padEnd(20)} ${miss} (${((miss / n) * 100).toFixed(1)}%)`)
  }

  console.log('\ntop-5 peak hours per base period (ICI Peak Tracker, live=demand MW, fallback=AQEW MWh):')
  if (!peaks.peaks?.length) {
    console.log('  (none — re-check fetch_peaks / base period)')
  } else {
    for (const p of peaks.peaks) {
      console.log(
        `  ${p.baseYear ?? '?'} #${p.rank}: ${p.date} HE${p.hour}  ${Math.round(p.value)}  [${p.source ?? p.status}]`,
      )
    }
  }
  console.log('\nSanity-check these against known 2025/26 Ontario peak days (hot summer weekday afternoons, HE13–HE19).')
}

if (isMain(import.meta.url)) {
  try {
    buildDataset()
  } catch (e) {
    console.error('build_dataset failed:', e.message)
    process.exit(1)
  }
}
