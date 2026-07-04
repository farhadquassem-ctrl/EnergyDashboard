import { CONF, fmtDay, fmtInt } from '../calculations'
import CurtailStrip from './CurtailStrip'
import SelectBadge from './SelectBadge'
import WeatherChip from './WeatherChip'

export default function PeakCard({ p }) {
  const conf = CONF[p.confidence] ?? CONF.low
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-white p-4 dark:bg-panel ${
        p.wouldRankTop5
          ? 'border-amber-400/60 dark:border-amber-500/40'
          : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold text-zinc-900 dark:text-zinc-100">{fmtDay(p.date)}</div>
          <div className="text-xs text-zinc-500">in {p.daysOut} days</div>
        </div>
        <SelectBadge selected={p.wouldRankTop5} rank={p.projectedRank} />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">HE{p.predictedPeakHourEnding}</span>
        <span className="text-sm text-zinc-500">
          ~<b className="tabular-nums text-zinc-700 dark:text-zinc-300">{fmtInt(p.predictedMw)}</b> MW · {p.tempC}°C
        </span>
      </div>

      <CurtailStrip hourStart={p.predictedPeakHourStart} windows={p.curtailmentWindows} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {p.curtailmentWindows.map((w) => (
          <span key={w.profile}>
            <b className="font-semibold text-zinc-600 dark:text-zinc-400">{w.profile}</b> {w.label}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <WeatherChip source={p.weatherSource} isForecast={p.isForecastWeather} />
        <span className={`text-[11px] font-semibold ${conf.cls}`}>confidence: {conf.label}</span>
      </div>
    </div>
  )
}
