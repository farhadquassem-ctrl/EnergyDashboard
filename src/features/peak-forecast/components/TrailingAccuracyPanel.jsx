import { useMemo, useState } from 'react'
import { computeTrailingSummary } from '../../model-backtest/calculations'

// Live trailing-accuracy panel — the prospective PREDICTION LOG scored against
// what actually happened, distinct from the AccuracyPanel above (which renders
// the walk-forward backtest recomputed from history each run). These are the
// model's real, timestamped predictions.
//
// Honesty split (see prediction_log.js): MW-error (MAE/MAPE/bias) is computable
// as soon as a target day passes — actualValue resolves the next day — but the
// top-5 hit label only becomes final when a base period closes (Apr 30). So the
// panel LEADS with MW error and renders hit rate as an explicit pending state
// until outcomes populate. Never fabricates a hit number.

const MODEL_NAME = 'ga-5cp-peak'
const MONTH_OPTS = [3, 6, 12]

const fmtMw = (v) => (v == null ? '—' : `${Math.round(v).toLocaleString()} MW`)
const fmtPct1 = (r) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`)

export default function TrailingAccuracyPanel({ predictions, updatedAt }) {
  const [months, setMonths] = useState(6)
  const summary = useMemo(
    () => computeTrailingSummary(predictions, { modelName: MODEL_NAME, months }),
    [predictions, months],
  )

  const { resolvedN, n, mae, mape, bias, byLead, hit, hitPendingN, windowStart, windowEnd } = summary
  const biasMw = bias == null ? null : Math.abs(Math.round(bias))
  const biasDir = bias == null ? '' : bias < 0 ? 'low' : 'high'

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Live accuracy — trailing record</h3>
          <p className="text-[11px] text-zinc-500">prospective prediction log · scored as reality arrives</p>
        </div>
        {/* 3/6/12-month selector, styled like the Horizon control (index.jsx) */}
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {MONTH_OPTS.map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`px-3 py-1.5 text-xs font-medium ${
                months === m
                  ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                  : 'bg-white text-zinc-500 hover:text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {m} mo
            </button>
          ))}
        </div>
      </div>

      {resolvedN === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
          The prospective log is young — predictions accrue daily; errors appear once target days pass.
          {n > 0 && <span className="ml-1">({n} logged, none resolved in this window yet.)</span>}
        </div>
      ) : (
        <>
          {/* headline MW-error stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">±{fmtPct1(mape)}</div>
              <div className="text-[11px] text-zinc-500">mean peak-MW error</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtMw(mae)}</div>
              <div className="text-[11px] text-zinc-500">mean absolute error</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtMw(biasMw)}</div>
              <div className="text-[11px] text-zinc-500">{bias == null ? 'bias' : `model runs ~${biasMw.toLocaleString()} MW ${biasDir}`}</div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{resolvedN}</div>
              <div className="text-[11px] text-zinc-500">predictions resolved</div>
            </div>
          </div>

          {/* by-lead breakdown */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {byLead.map((b) => (
              <div
                key={b.bucket}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40"
                title={`Lead ${b.bucket}: ${b.n} resolved prediction${b.n === 1 ? '' : 's'}${b.mae != null ? `, MAE ${Math.round(b.mae).toLocaleString()} MW` : ''}.`}
              >
                <div className="text-[11px] font-medium text-zinc-500">{b.bucket} out</div>
                <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">±{fmtPct1(b.mape)}</div>
                <div className="text-[11px] tabular-nums text-zinc-500">n = {b.n}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* hit-rate section — real when a base period has closed, else pending */}
      <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        {hit.resolved > 0 ? (
          <div className="text-xs text-zinc-600 dark:text-zinc-300">
            <b className="text-zinc-800 dark:text-zinc-100">Top-5 hit rate:</b>{' '}
            recall {fmtPct1(hit.recall)} · precision {fmtPct1(hit.precision)}{' '}
            <span className="text-zinc-500">({hit.hits}/{hit.positives} caught, {hit.flagged} flagged, {hit.resolved} scored)</span>
          </div>
        ) : (
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            <b className="text-zinc-800 dark:text-zinc-100">Top-5 hit rate: pending</b> — a day's top-5 outcome is only
            final when its base period closes (Apr 30). {hitPendingN} resolved prediction{hitPendingN === 1 ? '' : 's'}{' '}
            await that close.
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-zinc-500">
        Trailing window: {windowStart} → {windowEnd}, filtered by the day predicted.{updatedAt ? ` Log updated ${updatedAt.slice(0, 10)}.` : ''}
        {' '}Unlike the backtest panel above (recomputed from history), these are the model's real, timestamped
        predictions scored against what happened.
      </p>
    </div>
  )
}
