import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTimeline, groupByMeter, sortChrono } from './timeline.ts'
import type { Bill, Anomaly } from './types.ts'

const b = (id: string, meter: string, start: string, end: string, off: number, mid: number, on: number): Bill => ({
  id, meterId: meter, startDate: start, endDate: end, offPeakKwh: off, midPeakKwh: mid, onPeakKwh: on, totalBilledAmount: 100,
})

test('sortChrono orders ascending by start date', () => {
  const out = sortChrono([b('c', 'M', '2026-03-01', '2026-03-31', 1, 1, 1), b('a', 'M', '2026-01-01', '2026-01-31', 1, 1, 1)])
  assert.deepEqual(out.map((x) => x.id), ['a', 'c'])
})

test('groupByMeter splits by meter and keeps each group sorted', () => {
  const g = groupByMeter([
    b('x2', 'M2', '2026-02-01', '2026-03-01', 1, 1, 1),
    b('x1', 'M1', '2026-01-01', '2026-01-31', 1, 1, 1),
    b('x1b', 'M1', '2026-02-01', '2026-03-01', 1, 1, 1),
  ])
  assert.deepEqual([...g.keys()].sort(), ['M1', 'M2'])
  assert.deepEqual(g.get('M1')!.map((x) => x.id), ['x1', 'x1b'])
})

test('buildTimeline attaches anomaly types per bill and plots daily averages', () => {
  const bills = [b('b0', 'M', '2026-06-01', '2026-07-01', 300, 180, 120)] // 30 days, total 600
  const anomalies: Anomaly[] = [{ type: 'VOLUME_SPIKE', severity: 'HIGH', billId: 'b0', message: 'x', metric: 40 }]
  const [row] = buildTimeline(bills, anomalies)
  assert.equal(row!.label, 'Jun 2026') // labelled by the month usage started in
  assert.equal(row!.billingDays, 30)
  assert.equal(row!.totalKwh, 600)
  assert.equal(row!.dailyTotalKwh, 20)
  assert.equal(row!.dailyOnPeakKwh, 4)
  assert.deepEqual(row!.anomalies, ['VOLUME_SPIKE'])
})
