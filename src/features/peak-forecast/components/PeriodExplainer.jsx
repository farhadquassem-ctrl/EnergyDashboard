export default function PeriodExplainer({ basePeriod, billingPeriod }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-panel">
      <p className="text-zinc-600 dark:text-zinc-300">
        Curtailing during this base period's <b className="font-semibold text-zinc-900 dark:text-zinc-100">5 Coincident Peaks</b>{' '}
        lowers next year's Global Adjustment bill.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Base period (set peaks now)</div>
          <div className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
            May 1 {basePeriod.baseYear} – Apr 30 {basePeriod.baseYear + 1}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Bills this GA period</div>
          <div className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">{billingPeriod.label}</div>
        </div>
      </div>
    </div>
  )
}
