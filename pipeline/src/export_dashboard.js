// Step F3: the pipeline -> dashboard bridge. Runs the forecast and writes the
// app-facing JSON to public/peak-forecast/forecast.json, so the dashboard's
// Peak Forecast tab can read it as a static file (no backend, no serving
// convention needed -- it deploys with the app on Vercel).
//
// This is the ONE intentional coupling between the otherwise-independent
// pipeline and app: everything else in pipeline/ stays self-contained. Re-run
// `npm run export:dashboard` after refreshing the dataset (and, on a real
// machine, `npm run fetch:forecast`) and commit the regenerated JSON.
//
// The JSON carries its own freshness (generatedAt, datasetThrough, staleNote)
// so the tab can show a "generated N ago" banner and never present stale
// numbers as live.

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runForecast } from './forecast.js'
import { isMain } from './lib/is-main.js'

const SCHEMA_VERSION = 1
const here = dirname(fileURLToPath(import.meta.url))
// pipeline/src -> repo root -> public/peak-forecast
const PUBLIC_DIR = join(here, '..', '..', 'public', 'peak-forecast')
const OUT_FILE = join(PUBLIC_DIR, 'forecast.json')

export function exportDashboard() {
  const forecast = runForecast()
  const payload = { schemaVersion: SCHEMA_VERSION, ...forecast }
  mkdirSync(PUBLIC_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2))
  console.log(`\nexport:dashboard: wrote ${OUT_FILE}`)
  console.log('  commit this file so the dashboard ships the latest forecast.')
  return payload
}

if (isMain(import.meta.url)) {
  try {
    exportDashboard()
  } catch (e) {
    console.error('export:dashboard failed:', e.message)
    process.exit(1)
  }
}
