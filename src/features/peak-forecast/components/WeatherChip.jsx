export default function WeatherChip({ source, isForecast }) {
  if (isForecast) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        ECCC forecast
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-amber-500/60 px-2 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
      Climatology — estimate
    </span>
  )
}
