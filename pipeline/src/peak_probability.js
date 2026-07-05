// Empirical peak probability (replaces the days-out `confidence` heuristic).
//
// WHY: the forecast's old `confidence` field was a pure lead-time label
// (daysOut<=3 ? moderate : <=7 ? low : very low) — never a probability, never
// calibrated. This module produces a genuine, calibrated number:
//
//   P(a candidate day ends up an actual 5CP top-5 day | its predicted-peak
//     percentile, forecast lead)
//
// estimated as the observed frequency of top-5 outcomes at that percentile,
// from the SAME walk-forward backtest that already scores recall
// (backtest_horizons.js). It reuses that file's `buildLeadCandidates` so the
// (percentile, lead, wasTop5) tuples come from one construction, not a copy.
//
// DESIGN DECISIONS (agreed):
//   * Axis = percentile × forecast lead (decision A). A per-day's x is the
//     percentile of its predicted peak MW within a fixed per-lead REFERENCE
//     distribution (all candidate-day peaks pooled across the evaluated years).
//     The reference is fixed so the x means the same thing at fit time and at
//     live-scoring time. Per-base-period-relative percentiling (early in the
//     period a lower MW cracks the unfilled board) is the v2 running-board
//     refinement — see CLAUDE.md / the forecast reframe.
//   * Operational fit = 1-D logistic (decision A). Isotonic (PAV) and quantile
//     buckets are ALSO computed and emitted, purely so the logistic can be
//     visually compared against them before the fit form is locked. Only the
//     logistic feeds `probabilityFor`.
//
// Positives are scarce (~5 top-5 days/year × the evaluated years per lead), so
// the logistic carries light ridge regularization and everything degrades
// gracefully: a missing/again-untrained lead falls back to the next-nearest.
//
// Output (npm run calibrate): pipeline/data/peak_probability.json (consumed by
// forecast.js) + pipeline/data/calibration_report.html (the visual compare).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { FILES, DATA_DIR, FORECAST_LEAD_DAYS } from './config.js'
import { fitModel, isCandidateRow } from './peak_model.js'
import { loadDataset } from './backtest.js'
import { buildLeadCandidates } from './backtest_horizons.js'
import { buildClimatology, indexObservationsByUtcHour } from './forecast_weather.js'
import { isMain } from './lib/is-main.js'

// --- primitives -------------------------------------------------------------

export const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const clamp01 = (p) => Math.min(1, Math.max(0, p))

/**
 * Percentile (in [0,1]) of `v` within a sorted-ascending reference array:
 * the fraction of reference values <= v. Empty reference -> 0.5 (no signal).
 */
export function percentileOf(sortedRef, v) {
  const n = sortedRef.length
  if (n === 0) return 0.5
  // binary search for the count of ref <= v
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedRef[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo / n
}

/**
 * 1-D logistic regression p = sigmoid(b0 + b1*x) via IRLS (Newton-Raphson on
 * the 2x2 normal equations) with light ridge on the slope for small samples.
 * Returns { b0, b1, iters, converged }.
 */
export function fitLogistic(points, { ridge = 1e-3, maxIter = 100, tol = 1e-8 } = {}) {
  if (points.length === 0) return { b0: 0, b1: 0, iters: 0, converged: false }
  let b0 = 0
  let b1 = 0
  let iters = 0
  let converged = false
  for (; iters < maxIter; iters++) {
    // Accumulate X'WX (2x2, symmetric) and X'(y-mu) gradient.
    let h00 = ridge
    let h01 = 0
    let h11 = ridge
    let g0 = 0
    let g1 = 0
    for (const { x, y } of points) {
      const mu = sigmoid(b0 + b1 * x)
      const w = Math.max(mu * (1 - mu), 1e-9)
      h00 += w
      h01 += w * x
      h11 += w * x * x
      g0 += y - mu
      g1 += (y - mu) * x
    }
    g0 -= ridge * b0
    g1 -= ridge * b1
    const det = h00 * h11 - h01 * h01
    if (Math.abs(det) < 1e-12) break
    const d0 = (h11 * g0 - h01 * g1) / det
    const d1 = (h00 * g1 - h01 * g0) / det
    b0 += d0
    b1 += d1
    if (Math.abs(d0) < tol && Math.abs(d1) < tol) {
      converged = true
      iters++
      break
    }
  }
  return { b0, b1, iters, converged }
}

export const logisticProbability = ({ b0, b1 }, x) => clamp01(sigmoid(b0 + b1 * x))

/**
 * Isotonic regression (pool-adjacent-violators) of y on x. Returns a
 * non-decreasing step function as blocks [{ x, p }] (x = block's max input x,
 * p = pooled mean), suitable for step-plotting and lookup.
 */
export function fitIsotonic(points) {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => a.x - b.x)
  // Each block: { sumY, n, maxX }. Merge left while the running mean decreases.
  const blocks = []
  for (const { x, y } of sorted) {
    let blk = { sumY: y, n: 1, maxX: x }
    while (blocks.length && blocks.at(-1).sumY / blocks.at(-1).n >= blk.sumY / blk.n) {
      const prev = blocks.pop()
      blk = { sumY: prev.sumY + blk.sumY, n: prev.n + blk.n, maxX: Math.max(prev.maxX, blk.maxX) }
    }
    blocks.push(blk)
  }
  return blocks.map((b) => ({ x: b.maxX, p: clamp01(b.sumY / b.n) }))
}

/** Look up isotonic p for an x: first block whose maxX >= x (last block clamps). */
export function isotonicProbability(blocks, x) {
  if (blocks.length === 0) return 0.5
  for (const b of blocks) if (x <= b.x) return b.p
  return blocks.at(-1).p
}

/**
 * Quantile-bucket observed frequencies with Laplace (add-1) smoothing.
 * Returns [{ loPct, hiPct, n, positives, p }], nBuckets buckets over x∈[0,1].
 */
export function bucketFrequencies(points, nBuckets = 5) {
  const buckets = Array.from({ length: nBuckets }, (_, i) => ({
    loPct: i / nBuckets,
    hiPct: (i + 1) / nBuckets,
    n: 0,
    positives: 0,
  }))
  for (const { x, y } of points) {
    let i = Math.floor(x * nBuckets)
    if (i >= nBuckets) i = nBuckets - 1
    if (i < 0) i = 0
    buckets[i].n += 1
    buckets[i].positives += y ? 1 : 0
  }
  // Laplace: (positives+1)/(n+2) keeps empty/tiny buckets off the 0/1 rails.
  return buckets.map((b) => ({ ...b, p: (b.positives + 1) / (b.n + 2) }))
}

// --- walk-forward tuple collection -----------------------------------------

// Gather, per lead, the reference distribution of candidate-day peak MW and the
// (percentile, wasTop5) training tuples — walk-forward: model + climatology fit
// only on base years strictly before each test year (no leakage).
export function collectTuples(rows, leads) {
  const years = [...new Set(rows.map((r) => r.baseYear))].sort((a, b) => a - b)
  const obsByKey = indexObservationsByUtcHour(rows)
  // Per lead: raw candidate-day records { topPredicted, wasTop5 } across years.
  const rawByLead = new Map(leads.map((l) => [l, []]))

  for (const testYear of years) {
    const trainingRows = rows.filter((r) => r.baseYear < testYear)
    if (trainingRows.length === 0) continue // 1st year is training-only
    const testRows = rows.filter((r) => r.baseYear === testYear)
    const model = fitModel(trainingRows.filter(isCandidateRow))
    const climatology = buildClimatology(trainingRows)

    for (const leadDays of leads) {
      const { dayGroups, actualTop5 } = buildLeadCandidates({
        model, climatology, obsByKey, testRows, leadDays,
      })
      const top5Days = new Set(actualTop5.map((r) => r.day))
      for (const g of dayGroups) {
        rawByLead.get(leadDays).push({
          topPredicted: g.topPredicted,
          wasTop5: top5Days.has(g.day) ? 1 : 0,
        })
      }
    }
  }
  return rawByLead
}

/**
 * Build the full calibration from raw per-lead records: a fixed per-lead
 * reference distribution, the (percentile, wasTop5) points, and all three
 * fitted curves (logistic operational; isotonic + buckets for comparison).
 */
export function buildCalibration(rawByLead, { nBuckets = 5 } = {}) {
  const byLead = {}
  for (const [lead, raw] of rawByLead.entries()) {
    const reference = raw.map((r) => r.topPredicted).sort((a, b) => a - b)
    const points = raw.map((r) => ({ x: percentileOf(reference, r.topPredicted), y: r.wasTop5 }))
    const positives = points.reduce((s, p) => s + p.y, 0)
    byLead[lead] = {
      n: points.length,
      positives,
      reference,
      points,
      logistic: fitLogistic(points),
      isotonic: fitIsotonic(points),
      buckets: bucketFrequencies(points, nBuckets),
    }
  }
  return byLead
}

// --- operational scorer (logistic; decision A) ------------------------------

/**
 * P(top-5) for a live predicted peak. `calibration` is the peak_probability.json
 * `byLead` map (values carry { reference, logistic }). Falls back to the
 * nearest available lead if the exact bucket wasn't calibrated.
 * @returns {{ probability: number, percentile: number, lead: number }|null}
 */
export function probabilityFor(calibration, { predictedMw, lead }) {
  if (!calibration) return null
  const avail = Object.keys(calibration).map(Number).sort((a, b) => a - b)
  if (avail.length === 0) return null
  const useLead = calibration[lead] ? lead : avail.reduce((best, l) =>
    Math.abs(l - lead) < Math.abs(best - lead) ? l : best, avail[0])
  const cal = calibration[useLead]
  const percentile = percentileOf(cal.reference, predictedMw)
  return { probability: logisticProbability(cal.logistic, percentile), percentile, lead: useLead }
}

// Categorical label for the dashboard UI (CONF map), gated on the NORMALIZED
// per-lead percentile — not the absolute P(top-5). P(top-5) is intrinsically
// small (~5 winners out of dozens of candidate days per base period), so the
// old absolute gates (>=0.5 moderate, >=0.2 low) collapsed everything into
// "very low" — a display artifact, not model weakness. The percentile is
// anchored on the fixed per-lead historical reference (probabilityFor), so
// "High" means the same thing run to run: "top-ranked vs history at this
// lead", NOT "likely to be a top-5 peak". The honest absolute probability
// must stay visible next to the word wherever this label renders.
// Thresholds tunable.
export function confidenceLabel(percentile) {
  if (percentile >= 0.5) return 'high'
  if (percentile >= 0.2) return 'moderate'
  return 'low'
}

// --- runner -----------------------------------------------------------------

export function runCalibration() {
  const rows = loadDataset()
  const leads = [...FORECAST_LEAD_DAYS].sort((a, b) => a - b)
  const rawByLead = collectTuples(rows, leads)
  const byLead = buildCalibration(rawByLead)

  const out = {
    generatedAt: new Date().toISOString(),
    axis: 'percentile x forecast-lead',
    operationalFit: 'logistic',
    leads,
    byLead,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.peakProbability, JSON.stringify(out, null, 2))
  writeFileSync(FILES.calibrationReport, renderCalibrationReport(out))

  console.log(`calibrate: axis=${out.axis}, operational fit=${out.operationalFit}`)
  for (const lead of leads) {
    const c = byLead[lead]
    const { b0, b1 } = c.logistic
    console.log(
      `  lead ${String(lead).padStart(2)}d: n=${c.n} positives=${c.positives} ` +
        `logistic p=σ(${b0.toFixed(2)}${b1 >= 0 ? '+' : ''}${b1.toFixed(2)}·pctl) ` +
        `[p@50th=${logisticProbability(c.logistic, 0.5).toFixed(2)}, p@90th=${logisticProbability(c.logistic, 0.9).toFixed(2)}]`,
    )
  }
  console.log(`\ncalibrate: wrote ${FILES.peakProbability}`)
  console.log(`           wrote ${FILES.calibrationReport} (open to compare logistic vs isotonic vs buckets)`)
  return out
}

/** Load the calibration for forecast.js; null if not yet generated. */
export function loadCalibration() {
  try {
    return JSON.parse(readFileSync(FILES.peakProbability, 'utf8')).byLead
  } catch {
    return null
  }
}

// --- HTML report (self-contained; the visual compare) -----------------------

function renderCalibrationReport(out) {
  const W = 340
  const H = 240
  const pad = 36
  const sx = (x) => pad + x * (W - 2 * pad)
  const sy = (p) => H - pad - p * (H - 2 * pad)

  const panels = out.leads.map((lead) => {
    const c = out.byLead[lead]
    // logistic curve
    const logistic = Array.from({ length: 51 }, (_, i) => {
      const x = i / 50
      return `${sx(x).toFixed(1)},${sy(logisticProbability(c.logistic, x)).toFixed(1)}`
    }).join(' ')
    // isotonic step
    let iso = ''
    let prevX = 0
    for (const b of c.isotonic) {
      iso += `${sx(prevX).toFixed(1)},${sy(b.p).toFixed(1)} ${sx(b.x).toFixed(1)},${sy(b.p).toFixed(1)} `
      prevX = b.x
    }
    // bucket bars + observed dots
    const bars = c.buckets.map((b) => {
      const x0 = sx(b.loPct)
      const x1 = sx(b.hiPct)
      return `<rect x="${x0.toFixed(1)}" y="${sy(b.p).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(sy(0) - sy(b.p)).toFixed(1)}" fill="#38bdf8" opacity="0.16"/>` +
        `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${(sy(b.p) - 4).toFixed(1)}" font-size="9" fill="#94a3b8" text-anchor="middle">${(b.p * 100).toFixed(0)}%<tspan font-size="7" fill="#64748b"> n${b.n}</tspan></text>`
    }).join('')
    // axes ticks
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) =>
      `<text x="${sx(t).toFixed(1)}" y="${(H - pad + 14).toFixed(1)}" font-size="9" fill="#64748b" text-anchor="middle">${(t * 100).toFixed(0)}</text>` +
      `<text x="${(pad - 8).toFixed(1)}" y="${(sy(t) + 3).toFixed(1)}" font-size="9" fill="#64748b" text-anchor="end">${(t * 100).toFixed(0)}</text>`,
    ).join('')

    return `
    <div class="panel">
      <h2>Lead ${lead}-day <span>n=${c.n} · ${c.positives} top-5 events</span></h2>
      <svg viewBox="0 0 ${W} ${H}" width="100%">
        <rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="#334155"/>
        ${ticks}
        ${bars}
        <polyline points="${iso}" fill="none" stroke="#f59e0b" stroke-width="2" opacity="0.9"/>
        <polyline points="${logistic}" fill="none" stroke="#34d399" stroke-width="2.5"/>
        <text x="${W / 2}" y="${H - 6}" font-size="10" fill="#94a3b8" text-anchor="middle">forecast-demand percentile</text>
        <text x="12" y="${H / 2}" font-size="10" fill="#94a3b8" text-anchor="middle" transform="rotate(-90 12 ${H / 2})">P(top-5) %</text>
      </svg>
    </div>`
  }).join('')

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Peak probability calibration — logistic vs isotonic vs buckets</title>
<style>
  body{background:#0f172a;color:#e2e8f0;font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px}
  h1{font-size:18px;margin:0 0 4px}
  .sub{color:#94a3b8;font-size:13px;margin:0 0 20px;max-width:760px}
  .grid{display:flex;flex-wrap:wrap;gap:20px}
  .panel{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:12px 14px;flex:1 1 300px;min-width:280px}
  .panel h2{font-size:13px;margin:0 0 6px;font-weight:600}
  .panel h2 span{color:#64748b;font-weight:400;font-size:11px;margin-left:6px}
  .legend{display:flex;gap:18px;margin:14px 0 4px;font-size:12px;color:#cbd5e1;flex-wrap:wrap}
  .legend b{display:inline-block;width:22px;height:3px;vertical-align:middle;margin-right:6px;border-radius:2px}
  code{background:#334155;padding:1px 5px;border-radius:4px;font-size:12px}
</style></head><body>
  <h1>Peak-probability calibration — visual compare</h1>
  <p class="sub">Operational fit is the <b style="color:#34d399">logistic</b> (decision A). Isotonic and quantile buckets are shown only so you can eyeball whether the S-curve is the right shape before it's locked in. Axis: predicted-peak <em>percentile</em> × forecast <em>lead</em>. Generated ${out.generatedAt}.</p>
  <div class="legend">
    <span><b style="background:#34d399"></b>logistic (operational)</span>
    <span><b style="background:#f59e0b"></b>isotonic (PAV)</span>
    <span><b style="background:#38bdf8;opacity:.5"></b>quantile buckets (observed freq, Laplace-smoothed)</span>
  </div>
  <div class="grid">${panels}</div>
</body></html>`
}

if (isMain(import.meta.url)) {
  try {
    runCalibration()
  } catch (e) {
    console.error('calibrate failed:', e.message)
    process.exit(1)
  }
}
