// Ontario statutory holidays, computed for any year (no hard-coded year lists).
// Peaks cluster on summer weekday afternoons; holidays behave like weekends and
// are a useful exclusion/feature for the model.

import { DateTime } from 'luxon'

const EASTERN = 'America/Toronto'

// nth weekday of a month, e.g. Family Day = 3rd Monday of February.
function nthWeekday(year, month, weekday, n) {
  let dt = DateTime.fromObject({ year, month, day: 1 }, { zone: EASTERN })
  const shift = (weekday - dt.weekday + 7) % 7
  return dt.plus({ days: shift + (n - 1) * 7 })
}

// Easter Sunday (Anonymous Gregorian algorithm) -> Good Friday is 2 days before.
function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return DateTime.fromObject({ year, month, day }, { zone: EASTERN })
}

// Monday strictly before a date (Victoria Day = Monday preceding May 25).
function mondayBefore(dt) {
  const back = ((dt.weekday - 1 + 7) % 7) || 7 // >=1 day back, never same day
  return dt.minus({ days: back })
}

// Set of "yyyy-mm-dd" Ontario stat holidays for a given year.
export function ontarioHolidays(year) {
  const may25 = DateTime.fromObject({ year, month: 5, day: 25 }, { zone: EASTERN })
  const days = [
    DateTime.fromObject({ year, month: 1, day: 1 }, { zone: EASTERN }), // New Year's
    nthWeekday(year, 2, 1, 3), // Family Day (3rd Mon Feb)
    easterSunday(year).minus({ days: 2 }), // Good Friday
    mondayBefore(may25), // Victoria Day
    DateTime.fromObject({ year, month: 7, day: 1 }, { zone: EASTERN }), // Canada Day
    nthWeekday(year, 9, 1, 1), // Labour Day (1st Mon Sep)
    nthWeekday(year, 10, 1, 2), // Thanksgiving (2nd Mon Oct)
    DateTime.fromObject({ year, month: 12, day: 25 }, { zone: EASTERN }), // Christmas
    DateTime.fromObject({ year, month: 12, day: 26 }, { zone: EASTERN }), // Boxing Day
  ]
  return new Set(days.map((d) => d.toFormat('yyyy-MM-dd')))
}

// Cache holiday sets per year so build_dataset can call isHoliday cheaply.
const cache = new Map()
export function isOntarioHoliday(easternDt) {
  const y = easternDt.year
  if (!cache.has(y)) cache.set(y, ontarioHolidays(y))
  return cache.get(y).has(easternDt.toFormat('yyyy-MM-dd')) ? 1 : 0
}
