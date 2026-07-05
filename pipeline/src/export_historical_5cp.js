// Export the official historical 5CP labels for the dashboard's GA Exposure
// tab (Actual/historical mode) — part of the same sanctioned pipeline -> app
// static-JSON bridge as export_dashboard.js.
//
// Source: fixtures/historical_peaks_top5.csv — the consolidated OFFICIAL ICI
// Peak Tracker ranking (ranks 1-5 are AQEW_MWh, the exact quantity the IESO
// uses as the Peak Demand Factor denominator; see the ICI settlement
// methodology). This is IESO's ranking, never a re-rank of raw demand
// (CLAUDE.md rule). Only ranks 1-5 are exported: ranks 6-10 exist for a few
// years but use a different metric (Demand_MW) and play no role in the PDF.
//
// The delivery "Hour Ending (EST)" column follows the ICI report's labelling,
// but per the verified iciPeakToDateTime finding (CLAUDE.md task 2) delivery
// hours resolve on the DST-aware Eastern clock, same as demand — consumers of
// this JSON must interpret hourEnding in America/Toronto local time.
//
// Output: public/ga/historical_5cp.json. Static history — regenerate only
// when a base period closes and its Final ranking lands in the fixture.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCsv, columnIndex } from './lib/csv.js'
import { HISTORICAL_TOP5_FILE } from './config.js'
import { isMain } from './lib/is-main.js'

const here = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(here, '..', '..', 'public', 'ga')
const OUT_FILE = join(PUBLIC_DIR, 'historical_5cp.json')

export function exportHistorical5CP() {
  const text = readFileSync(HISTORICAL_TOP5_FILE, 'utf8')
  const { header, rows } = parseCsv(text)
  const idx = {
    baseYear: columnIndex(header, 'Base Year'),
    rank: columnIndex(header, 'Rank'),
    date: columnIndex(header, 'Date'),
    hourEnding: columnIndex(header, 'Hour Ending (EST)'),
    value: columnIndex(header, 'Value'),
    metric: columnIndex(header, 'Metric'),
  }

  const byBaseYear = {}
  for (const cols of rows) {
    const rank = Number(cols[idx.rank])
    if (rank > 5) continue // 6-10 are Demand_MW context rows, not PDF peaks
    const baseYear = Number(cols[idx.baseYear].split('-')[0])
    const list = (byBaseYear[baseYear] ??= [])
    list.push({
      rank,
      date: cols[idx.date],
      hourEnding: Number(cols[idx.hourEnding]),
      // AQEW_MWh over one hour == average MW for that hour; the PDF denominator.
      ontarioMw: Number(cols[idx.value]),
      metric: cols[idx.metric],
    })
  }
  for (const list of Object.values(byBaseYear)) list.sort((a, b) => a.rank - b.rank)

  const out = {
    source:
      'IESO ICI Peak Tracker final rankings (consolidated fixture pipeline/fixtures/historical_peaks_top5.csv); ranks 1-5, AQEW_MWh',
    note: 'hourEnding is on the DST-aware Eastern clock (America/Toronto), not fixed EST — see pipeline lib/time.js iciPeakToDateTime.',
    generatedAt: new Date().toISOString(),
    baseYears: Object.keys(byBaseYear).map(Number).sort((a, b) => a - b),
    byBaseYear,
  }

  mkdirSync(PUBLIC_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2))
  console.log(`export:historical5cp: ${out.baseYears.length} base periods -> ${OUT_FILE}`)
  return out
}

if (isMain(import.meta.url)) {
  try {
    exportHistorical5CP()
  } catch (e) {
    console.error('export:historical5cp failed:', e.message)
    process.exit(1)
  }
}
