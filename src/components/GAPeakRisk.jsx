import { getGAPeakRisk } from '../data/mockData'

const STYLES = {
  Green: {
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-500/30',
    text: 'text-emerald-400',
  },
  Yellow: {
    dot: 'bg-amber-500',
    ring: 'ring-amber-500/30',
    text: 'text-amber-400',
  },
  Red: {
    dot: 'bg-red-500',
    ring: 'ring-red-500/30',
    text: 'text-red-400',
  },
}

/**
 * Compact Global Adjustment peak-risk indicator (Green / Yellow / Red).
 */
export default function GAPeakRisk({ demandMW }) {
  const risk = getGAPeakRisk(demandMW)
  const style = STYLES[risk.level] ?? STYLES.Green

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-zinc-800 bg-panel p-4 ring-1 ${style.ring}`}
    >
      <span className="relative flex h-3 w-3">
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${style.dot} opacity-60`}
        />
        <span
          className={`relative inline-flex h-3 w-3 rounded-full ${style.dot}`}
        />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          GA Peak Risk
        </div>
        <div className={`text-sm font-semibold ${style.text}`}>
          {risk.level} — {risk.label}
        </div>
        <div className="truncate text-xs text-zinc-500">{risk.detail}</div>
      </div>
    </div>
  )
}
