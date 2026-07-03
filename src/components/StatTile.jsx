/**
 * A single bottom-bar stat tile: label, large value, optional unit + accent.
 */
export default function StatTile({ label, value, unit, accentClass }) {
  return (
    <div className="flex flex-col justify-center rounded-xl border border-zinc-300 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold ${accentClass ?? 'text-zinc-900 dark:text-zinc-100'}`}>
          {value}
        </span>
        {unit && <span className="text-sm text-zinc-500">{unit}</span>}
      </div>
    </div>
  )
}
