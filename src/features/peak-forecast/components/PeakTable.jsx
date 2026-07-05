import { CONF, fmtDay, fmtInt, fmtProb } from '../calculations'
import CurtailStrip from './CurtailStrip'
import SelectBadge from './SelectBadge'
import WeatherChip from './WeatherChip'

export default function PeakTable({ peaks }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-panel">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
            <th className="px-4 py-3 font-semibold">Day</th>
            <th className="px-4 py-3 font-semibold">Peak</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Balanced window</th>
            <th className="px-4 py-3 font-semibold">Weather</th>
            <th className="px-4 py-3 font-semibold">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {peaks.map((p) => {
            const conf = CONF[p.confidence] ?? CONF.low
            const bal = p.curtailmentWindows.find((w) => w.profile === 'Balanced')
            return (
              <tr key={p.date} className="border-b border-zinc-100 last:border-none dark:border-zinc-800">
                <td className="px-4 py-3">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">{fmtDay(p.date)}</div>
                  <div className="text-xs text-zinc-500">in {p.daysOut} days</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-bold text-zinc-900 dark:text-zinc-100">HE{p.predictedPeakHourEnding}</div>
                  <div className="text-xs text-zinc-500 tabular-nums">~{fmtInt(p.predictedMw)} MW · {p.tempC}°C</div>
                </td>
                <td className="px-4 py-3"><SelectBadge selected={p.wouldRankTop5} rank={p.projectedRank} /></td>
                <td className="px-4 py-3">
                  <CurtailStrip hourStart={p.predictedPeakHourStart} windows={p.curtailmentWindows} compact />
                  <div className="mt-1 text-xs tabular-nums text-zinc-500">{bal?.label}</div>
                </td>
                <td className="px-4 py-3"><WeatherChip source={p.weatherSource} isForecast={p.isForecastWeather} /></td>
                <td className="px-4 py-3">
                  <span className={`font-semibold ${conf.cls}`}>{conf.label}</span>
                  {p.probability != null && (
                    <div className="text-xs text-zinc-500">P(top-5) {fmtProb(p.probability)}</div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
