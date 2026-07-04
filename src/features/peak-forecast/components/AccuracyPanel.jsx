// Measured accuracy by lead time — renders the pipeline's walk-forward
// backtest results (accuracyByLead in forecast.json). Prompt 5 target: the
// scoring itself lives pipeline-side (backtest_horizons.js); this panel is a
// pure renderer of its output.
export default function AccuracyPanel({ accuracyByLead, horizons }) {
  const recall = (h) => accuracyByLead?.[String(h)]?.balancedTop5Recall?.mean ?? null
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Measured accuracy by lead time</h3>
        <span className="text-[11px] text-zinc-500">Balanced profile · top-5 recall · walk-forward backtest</span>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="flex items-end gap-4" style={{ height: 130 }}>
          {horizons.map((h) => {
            const r = recall(h)
            const col = r == null ? 'bg-zinc-400' : r >= 0.6 ? 'bg-emerald-500' : r >= 0.4 ? 'bg-amber-500' : 'bg-red-500'
            return (
              <div key={h} className="flex flex-1 flex-col items-center justify-end gap-2" style={{ height: '100%' }}>
                <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {r == null ? '—' : `${Math.round(r * 100)}%`}
                </span>
                <div className={`w-full max-w-[56px] rounded-t ${col}`} style={{ height: `${(r ?? 0) * 100}%` }} />
                <span className="text-xs text-zinc-500">{h}-day</span>
              </div>
            )
          })}
        </div>
        <ul className="space-y-2 text-xs text-zinc-500">
          <li><b className="text-zinc-700 dark:text-zinc-300">Degradation is real, not assumed.</b> Each lead is scored with only the information available that far ahead — nothing tuned to flatten the curve.</li>
          <li><b className="text-zinc-700 dark:text-zinc-300">3 / 7-day are lower bounds.</b> The backtest uses the climatology surrogate for every lead; live 3/7-day runs use the real ECCC forecast and should beat these.</li>
          <li><b className="text-zinc-700 dark:text-zinc-300">14-day is climatology.</b> No public forecast product reaches two weeks — it's an estimate, never presented as a forecast.</li>
        </ul>
      </div>
    </div>
  )
}
