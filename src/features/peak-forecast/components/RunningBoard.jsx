import { fmtDay, fmtInt } from '../calculations'

export default function RunningBoard({ running5CP, threshold }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Current base-period peaks (5CP so far)</h3>
        <span className="text-[11px] text-zinc-500">
          threshold to beat: <b className="tabular-nums text-zinc-700 dark:text-zinc-300">{fmtInt(threshold)} MW</b>
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        {running5CP.map((p) => (
          <div
            key={p.rank}
            className={`flex items-center gap-3 px-3 py-2 text-sm ${
              p.rank % 2 ? 'bg-zinc-50 dark:bg-zinc-800/40' : ''
            } ${p.rank === running5CP.length ? 'border-t-2 border-amber-500/50' : ''}`}
          >
            <span className="w-6 font-bold tabular-nums text-zinc-400">#{p.rank}</span>
            <span className="w-28 text-zinc-700 dark:text-zinc-300">{fmtDay(p.date)}</span>
            <span className="w-16 text-zinc-500">HE{p.hourEnding}</span>
            <span className="ml-auto font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtInt(p.mw)} MW</span>
            {p.rank === running5CP.length && (
              <span className="ml-2 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">5th · threshold</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
