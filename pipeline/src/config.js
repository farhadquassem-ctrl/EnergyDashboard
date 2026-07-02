// Central configuration for the peak-prediction pipeline.
// Everything you'd want to tweak (station, date window, URLs, paths) lives here.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = join(here, '..', 'data')

// --- Date window -----------------------------------------------------------
// Trailing window (default 12 months). Everything downstream — demand/weather
// year fans, PEAK_YEARS, the hourly index — is anchored to these two Eastern
// calendar days, so widening the window is all it takes to cover more history.
//   PIPELINE_END=2026-04-30      align the end to a complete base period
//   PIPELINE_MONTHS=24           window length in months (2 years)
//   PIPELINE_START=2024-05-01    pin the start explicitly (overrides MONTHS)
// For a 5CP backtest, prefer whole base periods (May 1 – Apr 30). Two periods:
//   PIPELINE_START=2024-05-01 PIPELINE_END=2026-04-30  (base years 2024 + 2025)
// Seven periods, using the historical fallback labels for 2020-2024:
//   PIPELINE_START=2020-05-01 PIPELINE_END=2026-04-30  (base years 2020-2026)
const WINDOW_MONTHS = Number(process.env.PIPELINE_MONTHS ?? 12)
export const END_DATE = process.env.PIPELINE_END ?? isoToday()
export const START_DATE = process.env.PIPELINE_START ?? shiftMonths(END_DATE, -WINDOW_MONTHS)

// The ICI base period(s) the window overlaps. Base period = May 1 – Apr 30,
// labelled by its START year (May 2025–Apr 2026 => "2025"; see baseYearOf).
// A trailing 12-month window usually spans two; a 24-month window spans two full
// periods, and fetch_peaks pulls one year file per base period listed here.
export const PEAK_YEARS = baseYearsForWindow(START_DATE, END_DATE)
export const CURRENT_BASE_YEAR = baseYearOf(END_DATE)

// --- Weather station -------------------------------------------------------
// Active Toronto hourly stations (all reporting as of 2026-06-30):
//   6158731 TORONTO INTL A       - Pearson (current); most complete airport
//                                 record, reports wind — the default, and the
//                                 station weather-normalization models weight.
//   6158355 TORONTO CITY         - downtown load-centroid; ~complete temp but
//                                 no wind (no downtown anemometer).
//   6158359 TORONTO CITY CENTRE  - island airport.
// (The old 6158733 Pearson "INT'L A" was decommissioned; data ends 2013.)
// Override without editing this file:  WEATHER_STATION_ID=6158355 npm run build
// Compare all candidates:              npm run weather:compare
const DEFAULT_STATION_ID = '6158731'
export const CANDIDATE_STATIONS = [
  { climateId: '6158731', name: 'TORONTO INTL A (Pearson)' },
  { climateId: '6158355', name: 'TORONTO CITY' },
  { climateId: '6158359', name: 'TORONTO CITY CENTRE' },
]
export const WEATHER_STATION = (() => {
  const id = process.env.WEATHER_STATION_ID ?? DEFAULT_STATION_ID
  const match = CANDIDATE_STATIONS.find((s) => s.climateId === id)
  return match ?? { climateId: id, name: `station ${id}` }
})()

// --- Source URLs (verified in DATA_PIPELINE.md — do not guess others) -------
export const URLS = {
  // IESO Hourly Demand (Ontario + Market demand). Current-year file:
  demandCurrent:
    'https://reports-public.ieso.ca/public/Demand/PUB_Demand.csv',
  // Prior full-year archives follow PUB_Demand_<YEAR>.csv in the same folder.
  demandYear: (year) =>
    `https://reports-public.ieso.ca/public/Demand/PUB_Demand_${year}.csv`,

  // ICI Peak Tracker — finalized per-base-period ranking (ground-truth labels).
  peaksYear: (year) =>
    `https://reports-public.ieso.ca/public/ICIPeakTracker/PUB_ICIPeakTracker_${year}.xml`,
  // The current, in-progress base period (no year suffix).
  peaksCurrent:
    'https://reports-public.ieso.ca/public/ICIPeakTracker/PUB_ICIPeakTracker.xml',

  // MSC GeoMet OGC API (Environment Canada).
  weatherItems: 'https://api.weather.gc.ca/collections/climate-hourly/items',
  stationsItems: 'https://api.weather.gc.ca/collections/climate-stations/items',
}

// Intermediate + final artifact paths.
export const FILES = {
  demand: join(DATA_DIR, 'demand.json'),
  weather: join(DATA_DIR, 'weather.json'),
  peaks: join(DATA_DIR, 'peaks.json'),
  dataset: join(DATA_DIR, 'peak_dataset.csv'),
  backtest: join(DATA_DIR, 'backtest_results.json'),
}

// Checked-in fallback labels — a single consolidated reference (top-5 AQEW,
// 2010-2011 onward, plus top 6-10 Demand_MW for a few years a live fetch has
// already confirmed) for base years where reports-public.ieso.ca has no
// per-year PUB_ICIPeakTracker_<year>.xml archive. Most years only have ranks
// 1-5, so is_top10_peak == is_top5_peak when falling back to those (see
// fetch_peaks.js for the exact per-year behavior and column meanings).
export const HISTORICAL_TOP5_FILE = join(here, '..', 'fixtures', 'historical_peaks_top5.csv')

// --- small date helpers (no deps; luxon is used where DST matters) ----------
function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function shiftMonths(iso, months) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}
// ICI files are labelled by the base period's START year: May 2025 – Apr 2026
// is "PUB_ICIPeakTracker_2025.xml" (confirmed against the real files). So a date
// in May–Dec belongs to that year's period; Jan–Apr to the prior year's.
// Exported: also used by backtest.js to group peak_dataset.csv rows by base year.
export function baseYearOf(iso) {
  const [y, m] = iso.split('-').map(Number)
  return m >= 5 ? y : y - 1
}
function baseYearsForWindow(startIso, endIso) {
  const a = baseYearOf(startIso)
  const b = baseYearOf(endIso)
  const years = []
  for (let y = a; y <= b; y++) years.push(y)
  return years
}
