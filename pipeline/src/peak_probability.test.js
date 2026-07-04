// Unit tests for the empirical peak-probability fitters. Run: npm test
// (node --test). These pin the pure math independent of any dataset.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  percentileOf, fitLogistic, logisticProbability, fitIsotonic, isotonicProbability,
  bucketFrequencies, buildCalibration, probabilityFor, confidenceLabel, sigmoid,
} from './peak_probability.js'

test('sigmoid is centered and monotone', () => {
  assert.equal(sigmoid(0), 0.5)
  assert.ok(sigmoid(3) > sigmoid(1))
  assert.ok(sigmoid(-3) < 0.1)
})

test('percentileOf: fraction of reference <= v', () => {
  const ref = [10, 20, 30, 40] // pre-sorted
  assert.equal(percentileOf(ref, 5), 0) // below all
  assert.equal(percentileOf(ref, 20), 0.5) // two of four <= 20
  assert.equal(percentileOf(ref, 100), 1) // above all
  assert.equal(percentileOf([], 5), 0.5) // no signal
})

test('fitLogistic recovers a monotone separable trend', () => {
  // y flips from 0 to 1 around x=0.5 -> positive slope, p(0.5)~0.5.
  const points = []
  for (let i = 0; i < 200; i++) {
    const x = i / 199
    points.push({ x, y: x > 0.5 ? 1 : 0 })
  }
  const fit = fitLogistic(points)
  assert.ok(fit.converged, 'should converge')
  assert.ok(fit.b1 > 0, 'slope positive for increasing risk')
  assert.ok(logisticProbability(fit, 0.9) > logisticProbability(fit, 0.1), 'monotone increasing')
  assert.ok(Math.abs(logisticProbability(fit, 0.5) - 0.5) < 0.15, 'crossing near mid')
})

test('logisticProbability clamps to [0,1]', () => {
  const fit = { b0: -50, b1: 100 }
  assert.ok(logisticProbability(fit, 1) <= 1)
  assert.ok(logisticProbability(fit, 0) >= 0)
})

test('fitLogistic handles all-zero labels without NaN', () => {
  const points = Array.from({ length: 50 }, (_, i) => ({ x: i / 49, y: 0 }))
  const fit = fitLogistic(points)
  const p = logisticProbability(fit, 0.9)
  assert.ok(Number.isFinite(p) && p >= 0 && p < 0.5)
})

test('fitIsotonic returns a non-decreasing step function', () => {
  // noisy but upward: low x mostly 0, high x mostly 1, with violators.
  const points = [
    { x: 0.1, y: 0 }, { x: 0.2, y: 1 }, { x: 0.3, y: 0 }, // violator
    { x: 0.6, y: 1 }, { x: 0.7, y: 0 }, { x: 0.8, y: 1 }, { x: 0.9, y: 1 },
  ]
  const blocks = fitIsotonic(points)
  for (let i = 1; i < blocks.length; i++) {
    assert.ok(blocks[i].p >= blocks[i - 1].p - 1e-9, 'p must be non-decreasing')
  }
  assert.ok(isotonicProbability(blocks, 0.95) >= isotonicProbability(blocks, 0.05))
})

test('bucketFrequencies: Laplace-smoothed, right counts, sums coverage', () => {
  const points = [
    { x: 0.05, y: 0 }, { x: 0.15, y: 0 }, // bucket 0
    { x: 0.95, y: 1 }, { x: 0.85, y: 1 }, // bucket 4
  ]
  const buckets = bucketFrequencies(points, 5)
  assert.equal(buckets.length, 5)
  assert.equal(buckets[0].n, 2)
  assert.equal(buckets[0].positives, 0)
  assert.equal(buckets[0].p, (0 + 1) / (2 + 2)) // 0.25, off the 0 rail
  assert.equal(buckets[4].n, 2)
  assert.equal(buckets[4].p, (2 + 1) / (2 + 2)) // 0.75, off the 1 rail
  assert.equal(buckets.reduce((s, b) => s + b.n, 0), 4)
})

test('buildCalibration + probabilityFor: higher MW -> higher P(top-5)', () => {
  // Synthetic per-lead raw records: peak MW correlated with top-5 outcome.
  const raw = []
  for (let i = 0; i < 300; i++) {
    const mw = 18000 + (i / 300) * 6000 // 18000..24000
    const wasTop5 = mw > 22500 ? (i % 3 === 0 ? 1 : 1) : 0 // top end mostly positive
    raw.push({ topPredicted: mw, wasTop5: mw > 22500 ? 1 : 0 })
  }
  const cal = buildCalibration(new Map([[7, raw]]))
  assert.ok(cal[7].n === 300)
  assert.ok(cal[7].positives > 0)
  const lo = probabilityFor(cal, { predictedMw: 19000, lead: 7 })
  const hi = probabilityFor(cal, { predictedMw: 23500, lead: 7 })
  assert.ok(hi.probability > lo.probability, 'higher predicted MW is likelier top-5')
  assert.ok(hi.percentile > lo.percentile)
})

test('probabilityFor falls back to nearest available lead', () => {
  const raw = Array.from({ length: 100 }, (_, i) => ({
    topPredicted: 20000 + i * 20, wasTop5: i > 80 ? 1 : 0,
  }))
  const cal = buildCalibration(new Map([[7, raw]]))
  const scored = probabilityFor(cal, { predictedMw: 21000, lead: 3 }) // 3 not calibrated
  assert.equal(scored.lead, 7, 'nearest available lead used')
  assert.ok(Number.isFinite(scored.probability))
  assert.equal(probabilityFor(null, { predictedMw: 21000, lead: 3 }), null)
})

test('confidenceLabel maps probability to the dashboard enum', () => {
  assert.equal(confidenceLabel(0.7), 'moderate')
  assert.equal(confidenceLabel(0.3), 'low')
  assert.equal(confidenceLabel(0.05), 'very low')
})
