// Time alignment — the crux of this pipeline.
//
// Three different clocks feed the dataset:
//   * IESO Hourly Demand  -> EPT: America/Toronto wall time, DST-aware.
//                            "Hour" is hour-ENDING 1..24 (HE1 covers 00:00-01:00).
//   * ECCC hourly weather -> LST: Local Standard Time = EST year-round (NO DST).
//   * ICI Peak Tracker    -> deliveryHour empirically matches IESO demand's own
//                            EPT (DST-aware) hour-ending, NOT fixed EST, despite
//                            the report XML's own metadata timestamps using a
//                            constant -0500 offset. Confirmed by cross-referencing
//                            three independent real peak entries (2022-07-19 HE18,
//                            2023-09-05 HE17, 2025-06-24 HE19) against demand.json:
//                            each source's reported peak *value* only matches the
//                            demand row when deliveryHour is converted via the
//                            same DST-aware Eastern zone as demand, not EST_FIXED
//                            -- the earlier "EST year-round" assumption here was
//                            wrong and silently shifted every peak label 1 hour
//                            late for the entire DST season (i.e. every real
//                            peak in this dataset, since they're all summer).
//
// Strategy: convert every source to a UTC epoch-hour key, join on that, and
// emit the human-facing `timestamp` in Eastern wall time (America/Toronto).

import { DateTime } from 'luxon'

const EASTERN = 'America/Toronto'
const EST_FIXED = 'UTC-5' // Local Standard Time / ICI convention (no DST)

// Stable join key: UTC truncated to the hour, e.g. "2025-07-15T18:00Z".
export function utcHourKey(dt) {
  return dt.toUTC().startOf('hour').toISO({ suppressMilliseconds: true, suppressSeconds: true })
}

/**
 * IESO hour-ending (EPT) -> DateTime. HE h covers [h-1, h); we anchor the row
 * at the interval START (h-1) in Eastern wall time so it lines up with the
 * clock hour weather is reported on.
 * Returns null for the non-existent spring-forward hour (invalid wall time).
 */
export function iesoHourEndingToDateTime(dateStr, hourEnding) {
  const startHour = Number(hourEnding) - 1 // HE1 -> 00:00
  // IESO uses HE24 as the last hour of the day; startHour 23 stays same day.
  const dt = DateTime.fromISO(`${dateStr}T00:00`, { zone: EASTERN }).plus({
    hours: startHour,
  })
  return dt.isValid ? dt : null
}

/**
 * ECCC weather local timestamp (LST = EST, no DST) -> DateTime.
 * GeoMet's LOCAL_DATE is Local Standard Time year-round.
 */
export function estLocalToDateTime(year, month, day, hour) {
  return DateTime.fromObject(
    { year, month, day, hour },
    { zone: EST_FIXED },
  )
}

/**
 * ICI Peak Tracker deliveryDate + deliveryHour -> DateTime. Same hour-ending
 * convention as IESO demand (EPT, DST-aware) -- see the file-level comment
 * for how this was confirmed against real demand values.
 */
export function iciPeakToDateTime(deliveryDate, deliveryHour) {
  return iesoHourEndingToDateTime(deliveryDate, deliveryHour)
}

// Build the full hourly index (inclusive start, exclusive end) as UTC-hour keys
// paired with their Eastern wall-time DateTime, over [startIso, endIso] days.
export function easternHourlyIndex(startIso, endIso) {
  let cur = DateTime.fromISO(`${startIso}T00:00`, { zone: EASTERN })
  const end = DateTime.fromISO(`${endIso}T00:00`, { zone: EASTERN }).plus({ days: 1 })
  const out = []
  while (cur < end) {
    out.push({ key: utcHourKey(cur), eastern: cur })
    cur = cur.plus({ hours: 1 })
  }
  return out
}

// Calendar features from an Eastern DateTime.
export function calendarFeatures(easternDt) {
  const dow = easternDt.weekday // 1=Mon..7=Sun
  return {
    hour_of_day: easternDt.hour,
    day_of_week: dow,
    month: easternDt.month,
    is_weekend: dow >= 6 ? 1 : 0,
  }
}

export function easternIso(dt) {
  return dt.setZone(EASTERN).toISO({ suppressMilliseconds: true })
}
