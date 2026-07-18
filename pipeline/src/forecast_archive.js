// Append-only archive of the ECCC citypage weather forecasts we download.
//
// WHY THIS EXISTS (the gap it closes): the multi-horizon backtest
// (backtest_horizons.js) has to score every lead time with a climatology
// SURROGATE because ECCC publishes no archive of its past forecasts — and,
// until now, neither did we. Each `npm run fetch:forecast` OVERWRITES
// pipeline/data/forecast_citypage.json (gitignored intermediate), so the real
// forecast that was actually issued on a given morning was lost the next day.
// This module snapshots each downloaded forecast into a committed, append-only
// file so a historical-forecast dataset finally accrues from today forward.
//
// D1 — location: public/peak-forecast/weather_archive.json (committed, publicly
//   served). It sits beside forecast.json / prediction_log.json — the two files
//   the refresh workflow already diffs + commits — and follows prediction_log.js's
//   precedent of resolving PUBLIC_DIR locally for durable committed artifacts
//   (NOT config.js FILES, which is the gitignored-intermediates set). Growth is
//   ~0.6 KB/day (~220 KB/yr): fine for years. Pruning / raw-XML retention /
//   multi-site are far-future and deliberately OUT OF SCOPE here.
//
// D3 — we store the PARSED per-day highs/lows (`days:[{date,highC,lowC}]`),
//   which is exactly what predictDayPeak consumes, not the raw XML (~100×
//   larger). Tradeoff: a parser bug loses the raw source — accepted, and
//   mitigated by the fixture-tested parser (parseCitypage). `sourceUrl` is kept
//   for provenance.
//
// V2 CONTRACT (out of scope here — this module only guarantees the schema
// supports the lookup): a future backtest that swaps the surrogate for the real
// archived forecast (backtest_horizons.js buildLeadCandidates, ~line 73) would,
// for a target day + lead, pick the NEWEST snapshot with
// `issuedAt <= (targetDate − leadDays)` and read
// `snapshot.days.find(d => d.date === targetDate)`, falling back to the
// surrogate when no snapshot covers that day. Needs ≥1 summer of accrual before
// it's worth building; the point of committing now is that backfilling is
// impossible.
//
// Pure core (snapshotFromCitypage / snapshotKey / mergeSnapshots) is
// unit-tested; the IO wrapper (updateWeatherArchive) is the
// `npm run archive:forecast` entry point.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FILES } from './config.js'
import { isMain } from './lib/is-main.js'

export const SCHEMA_VERSION = 1

const here = dirname(fileURLToPath(import.meta.url))
// pipeline/src -> repo root -> public/peak-forecast (same derivation as
// prediction_log.js — committed durable artifacts live here, not in data/).
const PUBLIC_DIR = join(here, '..', '..', 'public', 'peak-forecast')
export const ARCHIVE_FILE = join(PUBLIC_DIR, 'weather_archive.json')

/**
 * Reduce a parsed citypage forecast (the shape written to
 * data/forecast_citypage.json — fetchedAt/sourceUrl/issuedAt/siteId/days) to a
 * single archive snapshot, picking exactly the fields we durably keep (D3).
 * Throws if `days` is missing/empty — an empty snapshot is never archived.
 *
 * @param {{ issuedAt?: string|null, fetchedAt?: string|null, siteId?: string,
 *   sourceUrl?: string|null, days?: {date:string,highC:number|null,lowC:number|null}[] }} parsed
 * @returns {{ issuedAt: string|null, fetchedAt: string|null, siteId: string,
 *   sourceUrl: string|null, days: {date:string,highC:number|null,lowC:number|null}[] }}
 */
export function snapshotFromCitypage(parsed) {
  const days = parsed?.days
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error('snapshotFromCitypage: parsed forecast has no days — refusing to archive an empty snapshot')
  }
  return {
    issuedAt: parsed.issuedAt ?? null,
    fetchedAt: parsed.fetchedAt ?? null,
    siteId: parsed.siteId,
    sourceUrl: parsed.sourceUrl ?? null,
    days: days.map((d) => ({ date: d.date, highC: d.highC ?? null, lowC: d.lowC ?? null })),
  }
}

/**
 * De-dupe key (D2): one entry per distinct ECCC issuance. `issuedAt` can be
 * null when parseCitypage can't find a forecastIssue element, so fall back to
 * `fetchedAt`. Mirrors prediction_log's keyOf/mergePredictions semantics.
 */
export function snapshotKey(s) {
  return `${s.siteId}|${s.issuedAt ?? s.fetchedAt}`
}

/**
 * Append incoming snapshots to the existing archive, keep-first by snapshotKey
 * (re-archiving the same issuance is idempotent), sorted ascending by
 * (issuedAt ?? fetchedAt) then siteId. Pure — returns a new array.
 */
export function mergeSnapshots(existing, incoming) {
  const byKey = new Map((existing ?? []).map((s) => [snapshotKey(s), s]))
  for (const s of incoming ?? []) {
    if (!byKey.has(snapshotKey(s))) byKey.set(snapshotKey(s), s)
  }
  const ord = (s) => s.issuedAt ?? s.fetchedAt ?? ''
  return [...byKey.values()].sort(
    (a, b) => ord(a).localeCompare(ord(b)) || String(a.siteId).localeCompare(String(b.siteId)),
  )
}

/** Load the committed archive, or an empty envelope (missing/corrupt -> empty). */
function loadArchive() {
  if (!existsSync(ARCHIVE_FILE)) return { schemaVersion: SCHEMA_VERSION, snapshots: [] }
  try {
    const parsed = JSON.parse(readFileSync(ARCHIVE_FILE, 'utf8'))
    return { schemaVersion: SCHEMA_VERSION, snapshots: parsed.snapshots ?? [] }
  } catch {
    return { schemaVersion: SCHEMA_VERSION, snapshots: [] }
  }
}

// IO entry point (npm run archive:forecast): snapshot the freshly-fetched
// citypage forecast and append it to the committed append-only archive.
export function updateWeatherArchive() {
  if (!existsSync(FILES.forecastCitypage)) {
    throw new Error(`no ${FILES.forecastCitypage} — run npm run fetch:forecast first`)
  }
  const parsed = JSON.parse(readFileSync(FILES.forecastCitypage, 'utf8'))
  const incoming = snapshotFromCitypage(parsed)

  const prior = loadArchive()
  const before = prior.snapshots.length
  const snapshots = mergeSnapshots(prior.snapshots, [incoming])
  const added = snapshots.length - before

  const out = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    siteIds: [...new Set(snapshots.map((s) => s.siteId))],
    snapshots,
  }

  mkdirSync(PUBLIC_DIR, { recursive: true })
  writeFileSync(ARCHIVE_FILE, JSON.stringify(out, null, 2))
  console.log(`archive:forecast: ${snapshots.length} snapshots (+${added} new) -> ${ARCHIVE_FILE}`)
  return out
}

if (isMain(import.meta.url)) {
  try {
    updateWeatherArchive()
  } catch (e) {
    console.error('archive:forecast failed:', e.message)
    process.exit(1)
  }
}
