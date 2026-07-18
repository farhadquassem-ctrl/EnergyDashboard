// Unit tests for the model-agnostic accuracy scoring. Run: npm test
// (node --test). Plain JS (no JSX) so it runs under node's test runner.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  leadRecall, leadDiagnostics, leadHeadlineRecall, recallColorClass,
  computeHitRate, computeCalibration, computeTrendOverTime,
  filterTrailingWindow, computeTrailingSummary,
  RECALL_GOOD, RECALL_OK,
} from './calculations.js'

// --- extracted presentation helpers (must match the old inline logic) -------

test('leadRecall reads the aggregate mean, null when absent', () => {
  const acc = { 3: { balancedTop5Recall: { mean: 0.8 } }, 7: null }
  assert.equal(leadRecall(acc, 3), 0.8)
  assert.equal(leadRecall(acc, 7), null)
  assert.equal(leadRecall(acc, 14), null)
  assert.equal(leadRecall(null, 3), null)
})

test('recallColorClass matches the shipped thresholds', () => {
  assert.equal(recallColorClass(null), 'bg-zinc-400')
  assert.equal(recallColorClass(RECALL_GOOD), 'bg-emerald-500')
  assert.equal(recallColorClass(0.9), 'bg-emerald-500')
  assert.equal(recallColorClass(RECALL_OK), 'bg-amber-500')
  assert.equal(recallColorClass(0.5), 'bg-amber-500')
  assert.equal(recallColorClass(0.2), 'bg-red-500')
})

test('leadDiagnostics reads schemaVersion-2 pooled fields, null on v1 entries', () => {
  const v2 = { pooled: { dayRecall: 0.07, balancedRecall: 0.03, cpHourFilterSurvival: 0.55, top5Days: 29, actualTop5Hours: 29 } }
  assert.deepEqual(leadDiagnostics(v2), {
    dayRecall: 0.07, windowedRecall: 0.03, cpHourFilterSurvival: 0.55, top5Days: 29, actualTop5Hours: 29,
  })
  assert.equal(leadDiagnostics({ balancedTop5Recall: { mean: 0.03 } }), null) // v1 shape
  assert.equal(leadDiagnostics(null), null)
})

test('leadHeadlineRecall prefers pooled (v2), falls back to yearly mean (v1)', () => {
  const acc = {
    3: { balancedTop5Recall: { mean: 0.05 }, pooled: { balancedRecall: 0.03 } },
    7: { balancedTop5Recall: { mean: 0.03 } },
  }
  assert.equal(leadHeadlineRecall(acc, 3), 0.03) // pooled wins
  assert.equal(leadHeadlineRecall(acc, 7), 0.03) // v1 fallback
  assert.equal(leadHeadlineRecall(acc, 14), null)
})

// --- generalized log scoring ------------------------------------------------

const mk = (o) => ({
  modelName: 'ga-5cp-peak', targetDate: '2026-07-10', predictedAt: '2026-07-03T10:00:00Z',
  predictedValue: 22000, predictedProbability: 0.5, resolved: true, leadTimeDays: 7, ...o,
})

test('computeHitRate: recall & precision at a probability threshold, by model', () => {
  const preds = [
    mk({ predictedProbability: 0.9, actualHit: true }), // flagged hit
    mk({ predictedProbability: 0.8, actualHit: false }), // flagged, false alarm
    mk({ predictedProbability: 0.2, actualHit: true }), // missed positive
    mk({ predictedProbability: 0.1, actualHit: false }), // correct reject
    mk({ modelName: 'other', predictedProbability: 0.9, actualHit: true }), // filtered out
  ]
  const r = computeHitRate(preds, { modelName: 'ga-5cp-peak', threshold: 0.5 })
  assert.equal(r.resolved, 4)
  assert.equal(r.positives, 2)
  assert.equal(r.flagged, 2)
  assert.equal(r.hits, 1)
  assert.equal(r.recall, 0.5) // 1 of 2 positives caught
  assert.equal(r.precision, 0.5) // 1 of 2 flags correct
})

test('computeHitRate ignores unresolved (actualHit null) rows', () => {
  const r = computeHitRate([mk({ actualHit: null }), mk({ actualHit: true, predictedProbability: 0.9 })])
  assert.equal(r.resolved, 1)
  assert.equal(r.recall, 1)
})

test('computeCalibration: bins, observed frequency, Brier', () => {
  const preds = [
    mk({ predictedProbability: 0.05, actualHit: false }),
    mk({ predictedProbability: 0.15, actualHit: false }),
    mk({ predictedProbability: 0.95, actualHit: true }),
    mk({ predictedProbability: 0.85, actualHit: true }),
  ]
  const c = computeCalibration(preds, { bins: 10 })
  assert.equal(c.resolved, 4)
  // perfectly-separated & confident => low Brier
  assert.ok(c.brier < 0.05)
  const first = c.bins[0]
  assert.equal(first.n, 1)
  assert.equal(first.observedFreq, 0)
  const last = c.bins[9]
  assert.equal(last.n, 1)
  assert.equal(last.observedFreq, 1)
  // empty bins report null, not 0
  assert.equal(c.bins[5].n, 0)
  assert.equal(c.bins[5].observedFreq, null)
})

test('computeCalibration needs both probability and actualHit', () => {
  const c = computeCalibration([mk({ predictedProbability: null, actualHit: true }), mk({ actualHit: null })])
  assert.equal(c.resolved, 0)
  assert.equal(c.brier, null)
})

test('computeTrendOverTime: monthly Brier + MAE, sorted', () => {
  const preds = [
    mk({ predictedAt: '2026-06-02T10:00:00Z', predictedProbability: 0.9, actualHit: true, predictedValue: 22000, actualValue: 22200 }),
    mk({ predictedAt: '2026-06-20T10:00:00Z', predictedProbability: 0.1, actualHit: false, predictedValue: 20000, actualValue: 20100 }),
    mk({ predictedAt: '2026-07-05T10:00:00Z', predictedProbability: 0.5, actualHit: true, predictedValue: 21000, actualValue: 23000 }),
  ]
  const trend = computeTrendOverTime(preds, { bucket: 'month' })
  assert.equal(trend.length, 2)
  assert.deepEqual(trend.map((t) => t.period), ['2026-06', '2026-07'])
  assert.equal(trend[0].n, 2)
  assert.equal(trend[1].mae, 2000) // |21000-23000|
  assert.ok(trend[0].brier < trend[1].brier) // June well-predicted, July a 0.5 on a hit
})

test('computeTrendOverTime skips unresolved and bad timestamps', () => {
  const trend = computeTrendOverTime([mk({ resolved: false }), mk({ predictedAt: 'not-a-date', resolved: true })])
  assert.equal(trend.length, 0)
})

// --- trailing-window summary ------------------------------------------------

const NOW = new Date('2026-07-18T12:00:00Z')

test('filterTrailingWindow keeps rows by targetDate, inclusive boundary + modelName', () => {
  const preds = [
    mk({ targetDate: '2026-07-10' }), // inside
    mk({ targetDate: '2026-01-18' }), // exactly the 6-month start boundary -> inside
    mk({ targetDate: '2026-01-17' }), // one day before start -> excluded
    mk({ targetDate: '2026-07-19' }), // after now -> excluded
    mk({ modelName: 'other', targetDate: '2026-07-10' }), // wrong model -> excluded
  ]
  const rows = filterTrailingWindow(preds, { modelName: 'ga-5cp-peak', months: 6, now: NOW })
  assert.deepEqual(rows.map((p) => p.targetDate).sort(), ['2026-01-18', '2026-07-10'])
})

test('filterTrailingWindow on empty input returns empty', () => {
  assert.deepEqual(filterTrailingWindow([], { now: NOW }), [])
  assert.deepEqual(filterTrailingWindow(undefined, { now: NOW }), [])
})

test('computeTrailingSummary: MAE/MAPE/signed bias on hand-checked resolved rows', () => {
  const preds = [
    mk({ targetDate: '2026-07-08', predictedValue: 20000, actualValue: 22000, leadTimeDays: 4 }), // err 2000, ape 2000/22000
    mk({ targetDate: '2026-07-10', predictedValue: 21000, actualValue: 24000, leadTimeDays: 2 }), // err 3000, ape 3000/24000
  ]
  const s = computeTrailingSummary(preds, { modelName: 'ga-5cp-peak', months: 6, now: NOW })
  assert.equal(s.n, 2)
  assert.equal(s.resolvedN, 2)
  assert.equal(s.mae, 2500) // (2000+3000)/2
  assert.equal(s.bias, -2500) // both under-predict -> negative
  const expectMape = ((2000 / 22000) + (3000 / 24000)) / 2
  assert.ok(Math.abs(s.mape - expectMape) < 1e-9)
  assert.equal(s.windowStart, '2026-01-18')
  assert.equal(s.windowEnd, '2026-07-18')
})

test('computeTrailingSummary: unresolved rows count in n, not resolvedN; metrics null when nothing resolved', () => {
  const preds = [
    mk({ targetDate: '2026-07-10', predictedValue: 21000, actualValue: null, resolved: false }),
    mk({ targetDate: '2026-07-12', predictedValue: 20000, actualValue: null, resolved: false }),
  ]
  const s = computeTrailingSummary(preds, { modelName: 'ga-5cp-peak', now: NOW })
  assert.equal(s.n, 2)
  assert.equal(s.resolvedN, 0)
  assert.equal(s.mae, null)
  assert.equal(s.mape, null)
  assert.equal(s.bias, null)
})

test('computeTrailingSummary: lead bucketing (2/5/10d) with a stable empty bucket', () => {
  const preds = [
    mk({ targetDate: '2026-07-08', predictedValue: 20000, actualValue: 22000, leadTimeDays: 2 }), // 1-3d
    mk({ targetDate: '2026-07-10', predictedValue: 21000, actualValue: 24000, leadTimeDays: 10 }), // 8-14d
  ]
  const s = computeTrailingSummary(preds, { modelName: 'ga-5cp-peak', now: NOW })
  assert.deepEqual(s.byLead.map((b) => b.bucket), ['1-3d', '4-7d', '8-14d'])
  assert.equal(s.byLead[0].n, 1)
  assert.equal(s.byLead[1].n, 0) // empty bucket present + stable
  assert.equal(s.byLead[1].mae, null)
  assert.equal(s.byLead[2].n, 1)
})

test('computeTrailingSummary: actualHit null keeps hit.resolved 0 and counts hitPendingN', () => {
  const preds = [
    mk({ targetDate: '2026-07-08', predictedValue: 20000, actualValue: 22000, actualHit: null, resolved: true }),
    mk({ targetDate: '2026-07-10', predictedValue: 21000, actualValue: 24000, actualHit: null, resolved: true }),
  ]
  const s = computeTrailingSummary(preds, { modelName: 'ga-5cp-peak', now: NOW })
  assert.equal(s.hit.resolved, 0)
  assert.equal(s.hitPendingN, 2)
})
