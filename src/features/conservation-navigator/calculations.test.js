import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterPrograms, groupByCategory, freshness, normalizeSplit, planCosts,
} from './calculations.js'
import { DateTime } from 'luxon'

const RATES = {
  oerPercent: 0.235,
  tou: { offPeak: 0.076, midPeak: 0.122, onPeak: 0.158 },
  ulo: { ulo: 0.039, offPeak: 0.076, midPeak: 0.122, onPeak: 0.391 },
  tiered: { threshold: 600, tier1: 0.093, tier2: 0.108 },
}

const PROGRAMS = [
  { id: 'a', name: 'Peak Perks', audience: ['residential'], category: 'demand-response', useCase: 'central A/C + smart thermostat', keyDetail: '$75 enrollment', tags: ['thermostat', 'summer'] },
  { id: 'b', name: 'Retrofit Program', audience: ['commercial'], category: 'rebate', useCase: 'HVAC lighting DERs', keyDetail: 'prescriptive incentives', tags: ['hvac', 'lighting'] },
  { id: 'c', name: 'Rate Plan Optimization', audience: ['residential'], category: 'billing', useCase: 'EV charging pool pumps', keyDetail: 'ULO overnight', tags: ['ev', 'ulo'] },
]

// --- curation ---------------------------------------------------------------

test('filterPrograms: audience filter', () => {
  assert.deepEqual(filterPrograms(PROGRAMS, { audience: 'residential' }).map((p) => p.id), ['a', 'c'])
  assert.deepEqual(filterPrograms(PROGRAMS, { audience: 'commercial' }).map((p) => p.id), ['b'])
  assert.equal(filterPrograms(PROGRAMS, { audience: 'all' }).length, 3)
})

test('filterPrograms: multi-term query matches across name/useCase/keyDetail/tags', () => {
  assert.deepEqual(filterPrograms(PROGRAMS, { query: 'ev' }).map((p) => p.id), ['c'])
  assert.deepEqual(filterPrograms(PROGRAMS, { query: 'smart thermostat' }).map((p) => p.id), ['a'])
  assert.deepEqual(filterPrograms(PROGRAMS, { query: 'hvac lighting' }).map((p) => p.id), ['b'])
  assert.equal(filterPrograms(PROGRAMS, { query: 'nonexistent' }).length, 0)
})

test('groupByCategory buckets programs', () => {
  const g = groupByCategory(PROGRAMS)
  assert.deepEqual([...g.keys()].sort(), ['billing', 'demand-response', 'rebate'])
})

// --- freshness --------------------------------------------------------------

test('freshness flags stale after 8 days', () => {
  const now = DateTime.fromISO('2026-07-10')
  assert.equal(freshness('2026-07-10', now).label, 'today')
  assert.equal(freshness('2026-07-09', now).label, 'yesterday')
  assert.equal(freshness('2026-07-04', now).stale, false) // 6 days
  assert.equal(freshness('2026-07-01', now).stale, true) // 9 days
  assert.equal(freshness('garbage', now).stale, true)
})

// --- rate comparator (hand-worked) ------------------------------------------

test('normalizeSplit sums to 1, falls back to a typical profile', () => {
  const s = normalizeSplit({ off: 65, mid: 18, on: 17 })
  assert.ok(Math.abs(s.off + s.mid + s.on - 1) < 1e-9)
  assert.ok(Math.abs(s.off - 0.65) < 1e-9)
  assert.deepEqual(normalizeSplit({ off: 0, mid: 0, on: 0 }), { off: 0.65, mid: 0.18, on: 0.17 })
})

// 1000 kWh/mo, split 65/18/17, no overnight shift:
//   TOU  = 1000×(.65×.076+.18×.122+.17×.158) = 98.22 ; ×.765 = 75.1383
//   Tier = 600×.093 + 400×.108 = 99.00       ; ×.765 = 75.735
//   ULO  = 1000×(0)+1000×(.65×.076+.18×.122+.17×.391) = 108.75 ; ×.765 = 83.19
//   → cheapest after OER is TOU.
test('planCosts: unshifted profile → TOU is cheapest, OER applied', () => {
  const r = planCosts({ monthlyKwh: 1000, split: { off: 0.65, mid: 0.18, on: 0.17 }, uloOvernightShare: 0 }, RATES)
  assert.ok(Math.abs(r.plans.tou.monthly - 98.22) < 1e-6)
  assert.ok(Math.abs(r.plans.tou.monthlyAfterOer - 75.1383) < 1e-4)
  assert.ok(Math.abs(r.plans.tiered.monthly - 99.0) < 1e-6)
  assert.equal(r.recommended, 'tou')
})

// Shift 70% overnight, remaining 30% mostly off-peak (80/10/10):
//   ULO = 1000×(.7×.039 + .3×(.8×.076+.1×.122+.1×.391)) = 27.3 + 300×...
//       remaining energy 300: .8×300=240×.076=18.24; .1×300=30×.122=3.66; 30×.391=11.73
//       = 27.3+18.24+3.66+11.73 = 60.93  → ULO clearly cheapest.
test('planCosts: heavy overnight shift → ULO wins (the point of surfacing it)', () => {
  const r = planCosts({ monthlyKwh: 1000, split: { off: 0.8, mid: 0.1, on: 0.1 }, uloOvernightShare: 0.7 }, RATES)
  assert.ok(Math.abs(r.plans.ulo.monthly - 60.93) < 1e-6)
  assert.equal(r.recommended, 'ulo')
  assert.ok(r.annualSavingsVsWorst > 0)
})

test('planCosts: tiered threshold math (usage below vs above threshold)', () => {
  const below = planCosts({ monthlyKwh: 500, split: { off: 1, mid: 0, on: 0 }, uloOvernightShare: 0 }, RATES)
  assert.ok(Math.abs(below.plans.tiered.monthly - 500 * 0.093) < 1e-6)
  const above = planCosts({ monthlyKwh: 1000, split: { off: 1, mid: 0, on: 0 }, uloOvernightShare: 0 }, RATES)
  assert.ok(Math.abs(above.plans.tiered.monthly - (600 * 0.093 + 400 * 0.108)) < 1e-6)
})
