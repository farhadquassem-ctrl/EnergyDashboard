import { dailyCurtailmentSignal, fmtDay } from '../calculations'

// "Today's signal" — deliberately standalone: everything it needs arrives as
// props (GAForecast rows + threshold), no coupling to the GA tab's local
// state, so it can be promoted to a shared header/alerting component later.
// The recommendation always shows the calibrated probability behind it —
// never a bare flag.

const LEVELS = {
  curtail: {
    label: 'CURTAIL',
    box: 'border-amber-500/60 bg-amber-500/10',
    chip: 'bg-amber-500 text-white',
    text: 'text-amber-800 dark:text-amber-200',
  },
  prepare: {
    label: 'PREPARE',
    box: 'border-sky-500/50 bg-sky-500/10',
    chip: 'bg-sky-500 text-white',
    text: 'text-sky-800 dark:text-sky-200',
  },
  monitor: {
    label: 'MONITOR',
    box: 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-panel',
    chip: 'bg-zinc-400 text-white dark:bg-zinc-600',
    text: 'text-zinc-600 dark:text-zinc-300',
  },
}

export default function SignalBanner({ predictedPeaks, threshold, horizonDays = 7 }) {
  const sig = dailyCurtailmentSignal({ predictedPeaks, threshold }, { horizonDays })
  const L = LEVELS[sig.level] ?? LEVELS.monitor
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${L.box}`}>
      <span className={`rounded-md px-2.5 py-1 text-xs font-bold tracking-wide ${L.chip}`}>{L.label}</span>
      <span className={`text-sm ${L.text}`}>{sig.reason}</span>
      <span className="ml-auto text-xs tabular-nums text-zinc-500">
        {sig.peak
          ? <>P(top-5) <b className="text-zinc-700 dark:text-zinc-300">{sig.probability == null ? 'n/a' : `${Math.round(sig.probability * 100)}%`}</b>
            {' · '}{fmtDay(sig.peak.date)}</>
          : 'next 14 days clear'}
      </span>
    </div>
  )
}
