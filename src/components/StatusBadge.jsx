/**
 * Header status pill: shows whether the dashboard is on live IESO data or
 * mock fallback, plus the "as of" time when live.
 */
export default function StatusBadge({ isLive, loading, asOf }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-zinc-300 bg-zinc-200/60 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
        Loading IESO data…
      </div>
    )
  }

  if (isLive) {
    const time = asOf
      ? new Date(asOf).toLocaleTimeString('en-CA', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null
    return (
      <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
        Live · IESO public reports{time ? ` · ${time}` : ''}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-600 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
      Mock data — IESO feed unavailable
    </div>
  )
}
