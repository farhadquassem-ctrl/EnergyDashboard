import { leadHeadlineRecall, leadDiagnostics, recallColorClass } from '../../model-backtest/calculations'

// Measured accuracy by lead time — renders the pipeline's walk-forward
// backtest results (accuracyByLead + accuracyBaseline in forecast.json). The
// scoring lives pipeline-side (backtest_horizons.js); the presentation
// transforms are the model-agnostic module's, so this panel stays a pure
// renderer of its output.
//
// Reframed per the 2026-07 root-cause investigation (docs/findings/
// accuracy-by-lead-2026-07.md): the near-zero surrogate-lead recalls are the
// EXPECTED cost of forecasting weather days ahead (H1), not model breakage —
// the lead-0 "known weather" ceiling is shown as the anchor, pooled counts
// expose the tiny denominators (H5), and the 14-day bar is explicitly
// labelled climatology-only so a bare "0%" can never read as "broken".
export default function AccuracyPanel({ accuracyByLead, accuracyBaseline, horizons }) {
  const baseline = leadDiagnostics(accuracyBaseline)
  const fmtPct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`)

  const bars = [
    ...(baseline
      ? [{
          key: 'ceiling',
          label: '0-day',
          sub: 'known weather',
          recall: baseline.windowedRecall,
          counts: baseline.actualTop5Hours,
          ceiling: true,
        }]
      : []),
    ...horizons.map((h) => {
      const diag = leadDiagnostics(accuracyByLead?.[String(h)])
      return {
        key: String(h),
        label: `${h}-day`,
        sub: 'surrogate',
        recall: leadHeadlineRecall(accuracyByLead, h),
        dayRecall: diag?.dayRecall ?? null,
        counts: diag?.actualTop5Hours ?? null,
        ceiling: false,
      }
    }),
  ]

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Measured accuracy by lead time</h3>
        <span className="text-[11px] text-zinc-500">Balanced profile · top-5 recall · walk-forward backtest</span>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="flex items-end gap-4" style={{ height: 150 }}>
          {bars.map((b) => (
            <div key={b.key} className="flex flex-1 flex-col items-center justify-end gap-1.5" style={{ height: '100%' }}>
              <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtPct(b.recall)}</span>
              <div
                className={`w-full max-w-[56px] rounded-t ${
                  b.ceiling
                    ? 'border-2 border-dashed border-emerald-500/70 bg-emerald-500/15'
                    : recallColorClass(b.recall)
                }`}
                style={{ height: `${(b.recall ?? 0) * 100}%`, minHeight: b.recall != null && b.recall > 0 ? 2 : 0 }}
                title={
                  b.ceiling
                    ? `Model skill with the day's weather known — the ceiling the forecast leads degrade from (${b.counts ?? '?'} CP hours pooled).`
                    : `Pooled recall across all backtest base years${b.counts ? ` (${b.counts} CP hours)` : ''}${b.dayRecall != null ? `; right DAY flagged ${fmtPct(b.dayRecall)}` : ''}.`
                }
              />
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{b.label}</span>
              <span className={`text-[10px] ${b.ceiling ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>{b.sub}</span>
            </div>
          ))}
        </div>
        <ul className="space-y-2 text-xs text-zinc-500">
          <li>
            <b className="text-zinc-700 dark:text-zinc-300">The gap IS the finding, and it's honest.</b>{' '}
            With the day's weather known the model catches {baseline ? fmtPct(baseline.windowedRecall) : 'most'} of CP
            hours; the drop at 3/7/14 days is the cost of not knowing the weather yet — measured, not assumed, and
            nothing is tuned to flatten it.
          </li>
          <li>
            <b className="text-zinc-700 dark:text-zinc-300">3/7-day are lower bounds.</b> The backtest can only use a
            climatology surrogate (no public archive of past weather forecasts exists); live runs use the real ECCC
            forecast, which beats the surrogate at these leads.
          </li>
          <li>
            <b className="text-zinc-700 dark:text-zinc-300">14-day ≈ 0% by design.</b> Two weeks out is climatology
            only — no forecast product reaches that far, and naming the specific peak day from climatology is
            near-impossible. Treat it as "no day-level signal yet", not "broken".
          </li>
          <li>
            <b className="text-zinc-700 dark:text-zinc-300">Small denominators.</b> Only ~5 top-5 hours exist per base
            year, so yearly recalls are lumpy; the bars pool every backtest year when the data carries counts.
          </li>
        </ul>
      </div>
    </div>
  )
}
