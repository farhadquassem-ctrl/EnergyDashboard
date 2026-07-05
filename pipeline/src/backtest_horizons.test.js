import test from 'node:test'
import assert from 'node:assert/strict'
import { poolDiagnostics } from './backtest_horizons.js'

// Two fabricated base years at one lead: pooled ratios must be Σhits/Σtruths,
// not the mean of per-year ratios (5 positives/year makes means noisy — H5).
const results = [
  {
    baseYear: 2024,
    horizons: [{
      leadDays: 3,
      top5Days: 5, top5DayHits: 4,
      actualTop5Hours: 5, cpHoursSurvivingFilter: 5,
      profileResults: [{ profile: 'Balanced', top5Hits: 2 }],
    }],
  },
  {
    baseYear: 2025,
    horizons: [{
      leadDays: 3,
      top5Days: 5, top5DayHits: 0,
      actualTop5Hours: 5, cpHoursSurvivingFilter: 3,
      profileResults: [{ profile: 'Balanced', top5Hits: 0 }],
    }],
  },
]

test('poolDiagnostics pools counts across years, not yearly ratios', () => {
  const pooled = poolDiagnostics(results)
  assert.equal(pooled.length, 1)
  const p = pooled[0]
  assert.equal(p.leadDays, 3)
  assert.equal(p.years, 2)
  assert.equal(p.pooledDayRecall, 4 / 10) // (4+0)/(5+5), not mean(0.8, 0)
  assert.equal(p.pooledBalancedRecall, 2 / 10)
  assert.equal(p.cpHourFilterSurvival, 8 / 10)
})

test('poolDiagnostics sorts leads ascending and handles missing Balanced rows', () => {
  const twoLeads = [{
    baseYear: 2025,
    horizons: [
      { leadDays: 7, top5Days: 5, top5DayHits: 1, actualTop5Hours: 5, cpHoursSurvivingFilter: 2, profileResults: [] },
      { leadDays: 0, top5Days: 5, top5DayHits: 5, actualTop5Hours: 5, cpHoursSurvivingFilter: 5, profileResults: [{ profile: 'Balanced', top5Hits: 4 }] },
    ],
  }]
  const pooled = poolDiagnostics(twoLeads)
  assert.deepEqual(pooled.map((p) => p.leadDays), [0, 7])
  assert.equal(pooled[1].pooledBalancedRecall, 0) // no Balanced row -> 0 hits counted
})
