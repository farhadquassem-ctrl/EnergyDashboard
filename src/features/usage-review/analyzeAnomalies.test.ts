// Ground-truth tests for the anomaly engine. Run: npm test (node --test with
// Node 22 native type-stripping). Every expected number here is hand-worked in
// the comments — with no legacy tool to diff against, these ARE the spec.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeAnomalies, normalizeBill } from './analyzeAnomalies.ts'
import type { Bill, Anomaly } from './types.ts'

const MS_DAY = 86_400_000
const BASE = Date.UTC(2024, 0, 1)
const isoDay = (addDays: number): string => new Date(BASE + addDays * MS_DAY).toISOString().slice(0, 10)

/** A 30-day bill (start..end 30 days apart), spaced 35 days apart so the series stays chronological. */
function mkBill(i: number, total: number, on: number, mid: number, off: number, extra: Partial<Bill> = {}): Bill {
  return {
    id: `b${i}`, meterId: 'M1',
    startDate: isoDay(i * 35), endDate: isoDay(i * 35 + 30),
    offPeakKwh: off, midPeakKwh: mid, onPeakKwh: on, totalBilledAmount: total * 0.15,
    ...extra,
  }
}

const byType = (a: Anomaly[], t: string): Anomaly[] => a.filter((x) => x.type === t)

// ---------------------------------------------------------------------------
// Step 0 — normalization
// ---------------------------------------------------------------------------

test('normalizeBill: billingDays = End − Start, daily = total / days, total derived from buckets', () => {
  const n = normalizeBill({ id: 'x', meterId: 'M', startDate: '2024-01-01', endDate: '2024-01-31', offPeakKwh: 300, midPeakKwh: 180, onPeakKwh: 120, totalBilledAmount: 90 })
  assert.equal(n.billingDays, 30) // Jan 1 → Jan 31
  assert.equal(n.totalKwh, 600) // derived: 300+180+120
  assert.equal(n.dailyTotalKwh, 20)
  assert.equal(n.dailyOnPeakKwh, 4)
  assert.equal(n.dailyMidPeakKwh, 6)
  assert.equal(n.dailyOffPeakKwh, 10)
})

test('normalizeBill: explicit totalKwh overrides the bucket sum (ULO/tiered bills)', () => {
  const n = normalizeBill({ id: 'x', meterId: 'M', startDate: '2024-01-01', endDate: '2024-01-31', offPeakKwh: 300, midPeakKwh: 180, onPeakKwh: 120, totalKwh: 650, totalBilledAmount: 90 })
  assert.equal(n.totalKwh, 650)
  assert.ok(Math.abs(n.dailyTotalKwh - 650 / 30) < 1e-9)
})

test('normalizeBill: inverted or missing dates clamp to ≥1 day (never divide by zero)', () => {
  assert.equal(normalizeBill({ id: 'x', meterId: 'M', startDate: '2024-01-31', endDate: '2024-01-01', offPeakKwh: 1, midPeakKwh: 1, onPeakKwh: 1, totalBilledAmount: 1 }).billingDays, 1)
  assert.equal(normalizeBill({ id: 'x', meterId: 'M', startDate: '', endDate: '2024-01-01', offPeakKwh: 1, midPeakKwh: 1, onPeakKwh: 1, totalBilledAmount: 1 }).billingDays, 1)
})

// ---------------------------------------------------------------------------
// The three checks — a 5-bill dataset whose last bill trips ALL THREE.
//   dailyTotals = [20, 22, 24, 20, 40]  (all 30-day periods)
//   mean = 25.2, popSD = 7.5472
//   bill4: Z = 14.8/7.5472 = 1.961 (>1.5)      → VOLUME_SPIKE, +58.7%
//          on/total = 480/1200 = 0.40, hist on-peak = 996/3780 = 0.2635,
//          trigger 0.2635×1.3 = 0.3425, 0.40>0.3425 → PEAK_HEAVY, +51.8% vs hist
//          daily 40 vs prior 20 = +100% (>25%)  → RAPID_INCREASE, HIGH
// ---------------------------------------------------------------------------

const FIVE: Bill[] = [
  mkBill(0, 600, 120, 180, 300),
  mkBill(1, 660, 132, 198, 330),
  mkBill(2, 720, 144, 216, 360),
  mkBill(3, 600, 120, 180, 300),
  mkBill(4, 1200, 480, 360, 360),
]

test('empty input → no anomalies', () => {
  assert.deepEqual(analyzeAnomalies([]), [])
})

test('single bill → no anomalies (nothing to compare against)', () => {
  assert.deepEqual(analyzeAnomalies([FIVE[0]!]), [])
})

test('the spike bill trips all three checks, in check order, with hand-worked metrics', () => {
  const a = analyzeAnomalies(FIVE)
  assert.equal(a.length, 3, JSON.stringify(a))
  assert.ok(a.every((x) => x.billId === 'b4'))
  assert.deepEqual(a.map((x) => x.type), ['VOLUME_SPIKE', 'PEAK_HEAVY', 'RAPID_INCREASE'])

  const [vol, peak, rapid] = a as [Anomaly, Anomaly, Anomaly]
  assert.equal(vol.severity, 'LOW') // Z 1.96 (<2)
  assert.equal(vol.metric, 58.7)
  assert.match(vol.message, /58\.7% higher than your historical average/)

  assert.equal(peak.severity, 'LOW')
  assert.equal(peak.metric, 51.8)
  assert.match(peak.message, /On-peak share \(40%\)/)
  assert.match(peak.message, /after 7:00 PM/)

  assert.equal(rapid.severity, 'HIGH') // +100% (>0.75)
  assert.equal(rapid.metric, 100)
  assert.match(rapid.message, /jumped 100% versus your previous bill/)
})

test('the four normal bills raise nothing', () => {
  const a = analyzeAnomalies(FIVE)
  for (const id of ['b0', 'b1', 'b2', 'b3']) assert.equal(a.filter((x) => x.billId === id).length, 0)
})

test('ULO plan changes the PEAK_HEAVY advisory copy', () => {
  const withUlo = FIVE.map((b, i) => (i === 4 ? { ...b, ratePlan: 'ULO' as const } : b))
  const peak = byType(analyzeAnomalies(withUlo), 'PEAK_HEAVY')[0]!
  assert.match(peak.message, /Ultra-Low Overnight window/)
})

test('flat dataset (zero variance) raises no volume spike — no divide-by-zero', () => {
  const flat = [0, 1, 2, 3].map((i) => mkBill(i, 600, 120, 180, 300))
  assert.equal(byType(analyzeAnomalies(flat), 'VOLUME_SPIKE').length, 0)
})

// ---------------------------------------------------------------------------
// Check 3 seasonal edge case: with ≥12 bills, compare to N−12 (YoY), so a
// mid-series month-over-month jump is NOT flagged (it would be under N−1).
// ---------------------------------------------------------------------------

// 13 bills, all daily 30 except bill6 = 45 (a +50% MoM jump vs bill5) and
// bill12 = 39 (+30% vs bill0, same period last year).
const YEAR: Bill[] = Array.from({ length: 13 }, (_, i) => {
  const total = i === 6 ? 1350 : i === 12 ? 1170 : 900 // /30 = 45, 39, 30
  return mkBill(i, total, total * 0.2, total * 0.3, total * 0.5)
})

test('≥12 bills: velocity compares to N−12, so bill12 (+30% YoY) flags…', () => {
  const rapid = byType(analyzeAnomalies(YEAR), 'RAPID_INCREASE')
  assert.deepEqual(rapid.map((x) => x.billId), ['b12'])
  assert.equal(rapid[0]!.metric, 30)
  assert.match(rapid[0]!.message, /same period last year/)
})

test('…and the mid-series +50% MoM jump (bill6) is NOT flagged as velocity under the seasonal rule', () => {
  const rapid = byType(analyzeAnomalies(YEAR), 'RAPID_INCREASE')
  assert.equal(rapid.some((x) => x.billId === 'b6'), false)
})

test('contrast: the SAME jump IS flagged under N−1 when the dataset is < 12 bills', () => {
  const eleven = YEAR.slice(0, 11) // length 11 < 12 → month-over-month mode
  const rapid = byType(analyzeAnomalies(eleven), 'RAPID_INCREASE')
  assert.equal(rapid.some((x) => x.billId === 'b6'), true) // 45 vs 30 = +50%
  assert.match(rapid.find((x) => x.billId === 'b6')!.message, /previous bill/)
})
