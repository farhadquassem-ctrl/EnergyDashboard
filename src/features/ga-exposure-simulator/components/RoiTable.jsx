import { fmtDay, fmtDollars, fmtInt } from '../calculations'

// Forward-looking curtailment ROI: probability-weighted expected value per
// upcoming predicted peak (EV = P(top-5) × per-event saving − cost/event),
// ranked best-first. The probability shown is the forecast's calibrated
// number, never a binary flag. Inputs bind to the SHARED customerProfile so
// the storage-optimizer tab can read the same assumptions later.

const inputCls =
  'w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-xs tabular-nums text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'

export default function RoiTable({ rows, curtailableMw, costPerEvent, onProfileChange }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Curtailment ROI — upcoming predicted peaks</h3>
        <span className="text-[11px] text-zinc-500">EV = P(top-5) × per-event saving − cost per event</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        <label className="flex items-center gap-1.5">
          curtailable
          <input type="number" min="0" step="0.5" className={inputCls} value={curtailableMw}
            onChange={(e) => onProfileChange({ curtailableMw: Math.max(0, Number(e.target.value) || 0) })} />
          MW
        </label>
        <label className="flex items-center gap-1.5">
          cost per curtailment event
          <input type="number" min="0" step="500" className={inputCls} value={costPerEvent}
            onChange={(e) => onProfileChange({ curtailmentCostPerEvent: Math.max(0, Number(e.target.value) || 0) })} />
          $
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-500">No upcoming predicted peaks in the forecast window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                <th className="py-1.5 pr-2 font-semibold">Day</th>
                <th className="py-1.5 pr-2 font-semibold">Peak</th>
                <th className="py-1.5 pr-2 text-right font-semibold">P(top-5)</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Per-event saving</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Expected value</th>
                <th className="py-1.5 font-semibold">Call</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-b border-zinc-100 tabular-nums last:border-none dark:border-zinc-800">
                  <td className="py-2 pr-2">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">{fmtDay(r.date)}</span>
                    <span className="ml-1 text-[10px] text-zinc-500">+{r.daysOut}d</span>
                  </td>
                  <td className="py-2 pr-2 text-zinc-600 dark:text-zinc-400">HE{r.hourEnding} · ~{fmtInt(r.predictedMw)} MW</td>
                  <td className="py-2 pr-2 text-right text-zinc-800 dark:text-zinc-200">
                    {r.probability == null ? '—' : `${Math.round(r.probability * 100)}%`}
                  </td>
                  <td className="py-2 pr-2 text-right text-zinc-600 dark:text-zinc-400">{fmtDollars(r.perEventSavingDollars)}</td>
                  <td className={`py-2 pr-2 text-right font-semibold ${
                    r.expectedValueDollars == null ? 'text-zinc-500'
                      : r.expectedValueDollars > 0 ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {r.expectedValueDollars == null ? '—' : fmtDollars(r.expectedValueDollars)}
                  </td>
                  <td className="py-2">
                    {r.worthCurtailing ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">CURTAIL</span>
                    ) : (
                      <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">monitor</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-zinc-500">
        Per-event saving assumes the current running-board total as the final 5CP denominator (final peaks can only be
        higher, which would shrink savings slightly). A negative EV means the curtailment cost outweighs the
        probability-weighted GA saving — the honest "don't bother" signal.
      </p>
    </div>
  )
}
