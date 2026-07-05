import { fmtDay, fmtDollars, fmtMw } from '../calculations'

// The centerpiece: GA dollars decomposed by coincident peak. Each CP's bar
// splits into the saving (emerald — banked by curtailing to the target) and
// the residual (neutral — still paid), against the baseline contribution.
// Because the PDF is Σ/Σ, the five contributions are exactly additive, so
// "curtail 3 of 5" vs "all 5" is directly comparable — the quick-set buttons
// make that one click. All math in calculations.savingsByCoincidentPeak.

const inputCls =
  'w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-xs tabular-nums text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'

export default function SavingsByPeak({ savings, plan, onPlanChange, peakCustomerMwMax }) {
  const { rows, totalBaselineDollars, totalSavingDollars, totalResidualDollars } = savings
  const maxBaseline = Math.max(...rows.map((r) => r.baselineDollars), 1e-9)

  const setGlobal = (targetMw) => onPlanChange({ mode: 'global', targetMw })
  const setPerCp = (rank, mw) => {
    const targets = Object.fromEntries(rows.map((r) => [r.cpRank, r.curtailedToMw]))
    targets[rank] = mw
    onPlanChange({ mode: 'perCp', targets })
  }
  // Quick-sets: curtail the N largest contributions to the entered target.
  const quickSet = (n) => {
    const targetMw = plan.mode === 'global' ? plan.targetMw ?? 0 : 0
    const byContribution = [...rows].sort((a, b) => b.baselineDollars - a.baselineDollars)
    const chosen = new Set(byContribution.slice(0, n).map((r) => r.cpRank))
    onPlanChange({
      mode: 'perCp',
      targets: Object.fromEntries(rows.map((r) => [r.cpRank, chosen.has(r.cpRank) ? targetMw : null])),
    })
  }

  const globalTarget = plan.mode === 'global' && plan.targetMw != null ? plan.targetMw : ''

  return (
    <div className="rounded-xl border border-amber-400/50 bg-white p-4 dark:border-amber-500/30 dark:bg-panel">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Savings by coincident peak</h3>
        <span className="text-[11px] text-zinc-500">each CP's GA $ is independent — partial curtailment still banks real money</span>
      </div>

      {/* curtailment controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">Curtail to</span>
        <input
          type="number" min="0" step="0.1" className={inputCls}
          value={globalTarget}
          placeholder={plan.mode === 'perCp' ? 'per-CP' : 'no curtail'}
          onChange={(e) => setGlobal(e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="text-zinc-500">MW at</span>
        {[['all 5', 5], ['top 3', 3], ['top 1', 1]].map(([label, n]) => (
          <button
            key={label}
            onClick={() => quickSet(n)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setGlobal(null)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          no curtailment
        </button>
      </div>

      {/* per-CP bars: emerald = saved, neutral = residual */}
      <div className="space-y-2.5">
        {rows.map((r) => {
          const barPct = (r.baselineDollars / maxBaseline) * 100
          const savedPct = r.baselineDollars > 0 ? (r.savingDollars / r.baselineDollars) * 100 : 0
          return (
            <div key={r.cpRank} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3">
              <div className="text-xs">
                <div className="font-semibold text-zinc-800 dark:text-zinc-200">CP{r.cpRank} · {fmtDay(r.date)}</div>
                <div className="text-[10px] tabular-nums text-zinc-500">
                  HE{r.hourEnding} · {r.missing ? 'no data' : fmtMw(r.customerMw)} → {fmtMw(r.curtailedToMw)}
                </div>
              </div>
              <div className="relative h-5 rounded bg-zinc-100 dark:bg-zinc-800" title={`baseline ${fmtDollars(r.baselineDollars)} · saving ${fmtDollars(r.savingDollars)} · residual ${fmtDollars(r.residualDollars)}`}>
                <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded" style={{ width: `${barPct}%` }}>
                  <div className="h-full bg-emerald-500" style={{ width: `${savedPct}%` }} />
                  <div className="h-full flex-1 border-l-2 border-white bg-zinc-300 dark:border-panel dark:bg-zinc-600" />
                </div>
              </div>
              <div className="text-right text-xs tabular-nums">
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtDollars(r.savingDollars)}</div>
                <div className="text-[10px] text-zinc-500">Σ {fmtDollars(r.cumulativeSavingDollars)}</div>
              </div>
            </div>
          )
        })}
        {/* per-CP editable targets */}
        <details className="pt-1">
          <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            set a different target per CP…
          </summary>
          <div className="mt-2 flex flex-wrap gap-3">
            {rows.map((r) => (
              <label key={r.cpRank} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                CP{r.cpRank}
                <input
                  type="number" min="0" step="0.1" className={inputCls}
                  value={r.curtailedToMw}
                  onChange={(e) => setPerCp(r.cpRank, Math.max(0, Number(e.target.value) || 0))}
                />
                MW
              </label>
            ))}
          </div>
        </details>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-700">
        <span className="flex items-center gap-1.5 text-zinc-500">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> saved
          <b className="ml-1 text-sm tabular-nums text-emerald-600 dark:text-emerald-400">{fmtDollars(totalSavingDollars)}</b>
        </span>
        <span className="flex items-center gap-1.5 text-zinc-500">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-zinc-300 dark:bg-zinc-600" /> still paid
          <b className="ml-1 tabular-nums text-zinc-700 dark:text-zinc-300">{fmtDollars(totalResidualDollars)}</b>
        </span>
        <span className="ml-auto text-zinc-500">
          baseline exposure <b className="tabular-nums text-zinc-700 dark:text-zinc-300">{fmtDollars(totalBaselineDollars)}</b>
        </span>
      </div>
    </div>
  )
}
