// Step 1: IESO Hourly Demand -> normalized hourly demand keyed by UTC hour.
//
// The report is one CSV per calendar year with a "\\"-prefixed preamble before
// the real header: Date,Hour,Market Demand,Ontario Demand. "Hour" is hour-ending
// 1..24 in EPT (America/Toronto, DST-aware).
//
// Output: pipeline/data/demand.json = [{ key, ontario_demand_mw, market_demand_mw }]

import { writeFileSync, mkdirSync } from 'node:fs'
import { URLS, FILES, DATA_DIR, START_DATE, END_DATE } from './config.js'
import { fetchText } from './lib/http.js'
import { parseCsv, columnIndex } from './lib/csv.js'
import { iesoHourEndingToDateTime, utcHourKey } from './lib/time.js'
import { isMain } from './lib/is-main.js'

function yearsInWindow(startIso, endIso) {
  const a = Number(startIso.slice(0, 4))
  const b = Number(endIso.slice(0, 4))
  const years = []
  for (let y = a; y <= b; y++) years.push(y)
  return years
}

function parseDemandCsv(text) {
  const { header, rows } = parseCsv(text, { skipCommentPrefix: '\\' })
  const iDate = columnIndex(header, 'Date')
  const iHour = columnIndex(header, 'Hour')
  const iOnt = columnIndex(header, 'Ontario Demand')
  const iMkt = columnIndex(header, 'Market Demand')

  const out = []
  for (const r of rows) {
    const dt = iesoHourEndingToDateTime(r[iDate], r[iHour])
    if (!dt) continue // skip the non-existent spring-forward hour
    out.push({
      key: utcHourKey(dt),
      ontario_demand_mw: num(r[iOnt]),
      market_demand_mw: num(r[iMkt]),
    })
  }
  return out
}

const num = (v) => {
  const n = parseFloat(String(v).trim())
  return Number.isFinite(n) ? n : null
}

export async function fetchDemand() {
  const thisYear = new Date().getUTCFullYear()
  const merged = new Map() // key -> row (dedupe if year files overlap)

  for (const year of yearsInWindow(START_DATE, END_DATE)) {
    const url = year === thisYear ? URLS.demandCurrent : URLS.demandYear(year)
    console.log(`fetch_demand: ${url}`)
    try {
      const text = await fetchText(url)
      for (const row of parseDemandCsv(text)) merged.set(row.key, row)
    } catch (e) {
      // A missing/renamed archive year shouldn't abort the whole pull — the
      // window just loses those months (reported by build_dataset's QA summary).
      console.warn(`  skipped ${year} (${e.message}) — check archive filename if you need this range`)
    }
  }
  if (merged.size === 0) throw new Error('no demand rows fetched (all sources failed)')

  const rows = [...merged.values()].sort((a, b) => a.key.localeCompare(b.key))
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.demand, JSON.stringify(rows))
  console.log(`fetch_demand: wrote ${rows.length} hourly rows -> ${FILES.demand}`)
  return rows
}

// Run directly: `npm run fetch:demand`
if (isMain(import.meta.url)) {
  fetchDemand().catch((e) => {
    console.error('fetch_demand failed:', e.message)
    console.error('NOTE: reports-public.ieso.ca is blocked from the Claude sandbox; run this locally.')
    process.exit(1)
  })
}
