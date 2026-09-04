// Unit tests for the weather-forecast archive pure core. Run: npm test
// (node --test). Modeled on prediction_log.test.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  snapshotFromCitypage, snapshotKey, mergeSnapshots,
} from './forecast_archive.js'
import { parseCitypage } from './fetch_forecast.js'

const here = dirname(fileURLToPath(import.meta.url))

// The shape written to data/forecast_citypage.json (fetch_forecast.js `out`).
const citypage = {
  fetchedAt: '2026-07-03T16:00:00Z',
  sourceUrl: 'https://dd.weather.gc.ca/today/citypage_weather/ON/15/20260703T153000Z_MSC_CitypageWeather_s0000458_en.xml',
  issuedAt: '2026-07-03T15:30:00Z',
  siteId: 's0000458',
  days: [
    { date: '2026-07-03', highC: 31, lowC: 18 },
    { date: '2026-07-04', highC: 30, lowC: 19 },
  ],
}

test('snapshotFromCitypage picks exactly the durable fields', () => {
  const s = snapshotFromCitypage(citypage)
  assert.deepEqual(s, {
    issuedAt: '2026-07-03T15:30:00Z',
    fetchedAt: '2026-07-03T16:00:00Z',
    siteId: 's0000458',
    sourceUrl: citypage.sourceUrl,
    days: [
      { date: '2026-07-03', highC: 31, lowC: 18 },
      { date: '2026-07-04', highC: 30, lowC: 19 },
    ],
  })
})

test('snapshotFromCitypage defaults missing sourceUrl/issuedAt to null', () => {
  const s = snapshotFromCitypage({ siteId: 's0000458', fetchedAt: '2026-07-03T16:00:00Z', days: [{ date: '2026-07-03', highC: 31, lowC: 18 }] })
  assert.equal(s.sourceUrl, null)
  assert.equal(s.issuedAt, null)
})

test('snapshotFromCitypage throws on missing/empty days (never archive empty)', () => {
  assert.throws(() => snapshotFromCitypage({ siteId: 's0000458', days: [] }), /no days/)
  assert.throws(() => snapshotFromCitypage({ siteId: 's0000458' }), /no days/)
})

test('snapshotKey uses siteId|issuedAt, falling back to fetchedAt when issuedAt is null', () => {
  assert.equal(snapshotKey({ siteId: 's0000458', issuedAt: '2026-07-03T15:30:00Z', fetchedAt: 'x' }), 's0000458|2026-07-03T15:30:00Z')
  assert.equal(snapshotKey({ siteId: 's0000458', issuedAt: null, fetchedAt: '2026-07-03T16:00:00Z' }), 's0000458|2026-07-03T16:00:00Z')
})

test('mergeSnapshots is idempotent by key', () => {
  const s = snapshotFromCitypage(citypage)
  const merged = mergeSnapshots([s], [s])
  assert.equal(merged.length, 1, 're-archiving the same issuance adds nothing')
})

test('mergeSnapshots appends distinct issuances, sorted ascending', () => {
  const a = snapshotFromCitypage(citypage)
  const b = snapshotFromCitypage({ ...citypage, issuedAt: '2026-07-04T15:30:00Z', fetchedAt: '2026-07-04T16:00:00Z' })
  // feed newest-first; expect ascending order out
  const merged = mergeSnapshots([b], [a])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged.map((s) => s.issuedAt), ['2026-07-03T15:30:00Z', '2026-07-04T15:30:00Z'])
})

test('mergeSnapshots keeps the FIRST snapshot when a later one shares the key', () => {
  const first = snapshotFromCitypage(citypage)
  const sameKeyDifferentDays = { ...first, days: [{ date: '2026-07-03', highC: 99, lowC: 99 }] }
  const merged = mergeSnapshots([first], [sameKeyDifferentDays])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].days[0].highC, 31, 'keep-first: original days retained')
})

test('null-issuedAt snapshots key + sort on fetchedAt', () => {
  const a = snapshotFromCitypage({ ...citypage, issuedAt: null, fetchedAt: '2026-07-03T16:00:00Z' })
  const b = snapshotFromCitypage({ ...citypage, issuedAt: null, fetchedAt: '2026-07-05T16:00:00Z' })
  const merged = mergeSnapshots([], [b, a])
  assert.equal(merged.length, 2, 'distinct fetchedAt keys are not merged')
  assert.deepEqual(merged.map((s) => s.fetchedAt), ['2026-07-03T16:00:00Z', '2026-07-05T16:00:00Z'])
})

test('fixture round-trip: parseCitypage -> snapshotFromCitypage -> mergeSnapshots', () => {
  const xml = readFileSync(join(here, '..', 'fixtures', 'citypage_sample_SYNTHETIC.xml'), 'utf8')
  const parsed = parseCitypage(xml) // { issuedAt, siteId, days } — no fetchedAt/sourceUrl
  const snap = snapshotFromCitypage(parsed)
  assert.ok(snap.days.length > 0)
  assert.equal(snap.siteId, 's0000458')
  assert.equal(snap.sourceUrl, null) // bare parse has no sourceUrl
  const archive = mergeSnapshots([], [snap])
  assert.equal(archive.length, 1)
  assert.equal(archive[0].issuedAt, snap.issuedAt)
})
