// Shared market data model — the architecture contract every tab builds on.
//
// The repo is plain JavaScript (no TypeScript toolchain), so the contract's
// types are expressed as JSDoc typedefs: editors type-check imports of these
// via `@type`/`@param` annotations without a build-system migration. If the
// app ever adopts TS, this file converts 1:1 to `types/market.ts`.
//
// Rules:
//  - Every price row that crosses a module boundary is an `IntervalPrice`.
//  - Chart components consume `PricePoint` rows — tabs must not invent their
//    own chart-row shapes (pivot with `toPricePoints`).
//  - Tab-specific parsing lives in `src/lib/ieso/`, never in components.

/** Markets an `IntervalPrice` can belong to. */
export const MARKETS = Object.freeze([
  'RT', // real-time (5-min) zonal/nodal LMP
  'DA', // day-ahead hourly clearing price
  'HOEP', // legacy pre-MRP hourly Ontario energy price (historical only)
  'GA', // global adjustment rate
  'OR_10S', // operating reserve, 10-min spinning
  'OR_10N', // operating reserve, 10-min non-spinning
  'OR_30', // operating reserve, 30-min
  'REG', // regulation
])

/**
 * One price observation for one interval in one market.
 *
 * @typedef {object} IntervalPrice
 * @property {string} timestamp ISO8601 interval start
 * @property {string} zone IESO virtual trading zone id (or 'ontario')
 * @property {string} [node] pricing-location id, when node-level
 * @property {'RT'|'DA'|'HOEP'|'GA'|'OR_10S'|'OR_10N'|'OR_30'|'REG'} market
 * @property {number} price
 * @property {'$/MWh'} unit
 */

/**
 * One demand observation.
 *
 * @typedef {object} DemandInterval
 * @property {string} timestamp ISO8601
 * @property {number} ontarioDemand MW
 * @property {string} [zone]
 */

/**
 * One GA 5CP peak prediction (a predicted-peak day/hour from the pipeline).
 *
 * `probability` is the pipeline's calibrated P(top-5) (empirical
 * percentile×lead model, `npm run calibrate`); `confidence` is the categorical
 * RELATIVE rung gated on the peak's per-lead percentile (not the absolute
 * probability — that's intrinsically small, so always show the number beside
 * the word). `probability` is null only for forecast.json that predates
 * calibration, where `confidence` still carries the signal. Legacy files may
 * carry the retired 'very low' rung.
 *
 * @typedef {object} GAForecast
 * @property {string} date YYYY-MM-DD target day
 * @property {number} hour hour-ending (HE1–HE24) of the predicted peak
 * @property {number} predictedRank projected rank on the running 5CP board
 * @property {number|null} probability
 * @property {'high'|'moderate'|'low'|'very low'} [confidence]
 * @property {number} [daysOut] lead time to the target day
 * @property {number} [predictedMw] predicted Ontario peak MW for the day
 * @property {boolean} [wouldRankTop5] would crack the running 5CP board (a
 *   curtailment target, not just a warm day) — the GA exposure tab's signal
 * @property {boolean} [actualPeak] set once the day resolves
 */

/**
 * Base chart-row shape shared by every chart component: one x-axis point with
 * one numeric column per series key.
 *
 * @typedef {object} PricePoint
 * @property {string} label x-axis label
 * @property {string} [timestamp] ISO8601, when the source rows carry one
 */

/**
 * One prospective model prediction, logged when it's made and scored once the
 * outcome is known. The model-agnostic record every model's accuracy tracking
 * builds on (peak 5CP today; DA/RT price + storage forecasts later) — see
 * `src/features/model-backtest/`. Written prospectively by the pipeline to
 * `public/peak-forecast/prediction_log.json` so accuracy accrues over time
 * (distinct from the walk-forward *backtest* aggregate in `accuracyByLead`,
 * which is recomputed from history each run).
 *
 * @typedef {object} ModelPrediction
 * @property {string} modelName e.g. 'ga-5cp-peak'
 * @property {string} targetDate YYYY-MM-DD the prediction is about
 * @property {string} predictedAt ISO8601 when the prediction was made
 * @property {number} predictedValue the model's point prediction (e.g. peak MW)
 * @property {number} [predictedProbability] calibrated P(event), when the model emits one
 * @property {number} [actualValue] observed value, filled once the day passes
 * @property {boolean} [actualHit] observed positive outcome (e.g. day ended up
 *   in the base period's top-5), filled once that's finally knowable
 * @property {boolean} resolved actualValue is known (the target day has passed)
 * @property {number} leadTimeDays days between predictedAt and targetDate
 */

/**
 * Nodal LMP decomposition row (the Nodal tab's grid shape).
 *
 * NOTE (flagged, see Prompt 4): this predates the contract and diverges from
 * `IntervalPrice` — it is a *decomposition* (energy/congestion/loss/basis)
 * with no per-row timestamp (the report is a single point in time; `asOf`
 * rides on the envelope). Reconciling it is a decision, not a silent migration.
 *
 * @typedef {object} NodalPriceComponent
 * @property {string} nodeId
 * @property {string} nodeName
 * @property {string} locationType
 * @property {string|null} zone
 * @property {number} lmp
 * @property {number} energy
 * @property {number} congestion
 * @property {number} loss
 * @property {number} basis LMP − Ontario Zonal Price
 * @property {number|null} congestionPct
 */

/**
 * Pivot normalized `IntervalPrice[]` into `PricePoint[]` chart rows: one row
 * per timestamp, one numeric column per market (e.g. `{ label, RT, DA }`).
 * Pure and unit-testable; keeps tabs from re-inventing chart-row shapes.
 *
 * @param {IntervalPrice[]} intervals
 * @param {{ labelOf?: (iso: string) => string }} [opts]
 * @returns {PricePoint[]}
 */
export function toPricePoints(intervals, { labelOf } = {}) {
  const rows = new Map()
  for (const ip of intervals ?? []) {
    if (ip?.timestamp == null || ip.price == null) continue
    let row = rows.get(ip.timestamp)
    if (!row) {
      row = {
        timestamp: ip.timestamp,
        label: labelOf ? labelOf(ip.timestamp) : ip.timestamp,
      }
      rows.set(ip.timestamp, row)
    }
    row[ip.market] = ip.price
  }
  return [...rows.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
