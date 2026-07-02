// Central configuration for the peak-prediction pipeline.
// Everything you'd want to tweak (station, date window, URLs, paths) lives here.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = join(here, '..', 'data')

// --- Date window -----------------------------------------------------------
// Trailing 12 months. Override END with e.g. PIPELINE_END=2026-04-30.
// Everything downstream is anchored to these two dates (Eastern calendar days).
export const END_DATE = process.env.PIPELINE_END ?? isoToday()
export const START_DATE = shiftMonths(END_DATE, -12)

// The ICI base period(s) the window overlaps. Base period = May 1 – Apr 30,
// labelled by the year it ends in (May 2025–Apr 2026 => "2026"). A trailing
// 12-month window usually spans two. The still-in-progress period has no year
// file yet — it's the no-year current tracker (see URLS.peaksCurrent).
export const PEAK_YEARS = baseYearsForWindow(START_DATE, END_DATE)
export const CURRENT_BASE_YEAR = baseYearOf(END_DATE)

// --- Weather station -------------------------------------------------------
// Active Toronto hourly stations (all reporting as of 2026-06-30):
//   6158355 TORONTO CITY        - downtown load-centroid; the demand-weather
//                                 literature uses "City of Toronto" (default).
//   6158731 TORONTO INTL A       - Pearson (current); most complete airport
//                                 record — the completeness backup.
//   6158359 TORONTO CITY CENTRE  - island airport.
// (The old 6158733 Pearson "INT'L A" was decommissioned; data ends 2013.)
// If build_dataset reports a high weather-missing %, switch to 6158731.
// Verify coverage anytime with `npm run stations`.
export const WEATHER_STATION = {
  climateId: '6158355',
  name: 'TORONTO CITY',
}

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
}

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
function baseYearOf(iso) {
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
