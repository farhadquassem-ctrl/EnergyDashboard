import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchPeakForecast } from '../data/peakForecastClient'

// Peak Forecast tab — the ICI-consumer 5CP view. Renders the pipeline's
// forecast (public/peak-forecast/forecast.json): the current base period's
// running top-5 board, and up to 5 upcoming hours that would crack it (the
// curtailment targets). See pipeline/src/forecast.js for the model + shape.

// Candidate peak band is HE11–HE22 => interval-start hours 10..21.
const BAND_START = 10
const BAND_END = 21
const pct = (h) => `${(h / 24) * 100}%`

const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-CA'))

function fmtDay(iso) {
  // Noon local avoids any date rollover from timezone offset.
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
}

function relTime(iso) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 60) return `${Math.max(0, mins)} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.round(hrs / 24)} days ago`
}

const CONF = {
  moderate: { label: 'Moderate', cls: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500', w: '68%' },
  low: { label: 'Low', cls: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', w: '42%' },
  'very low': { label: 'Very low', cls: 'text-red-600 dark:text-red-400', bar: 'bg-red-500', w: '22%' },
}

// --- small shared bits ------------------------------------------------------
function WeatherChip({ source, isForecast }) {
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

// 24h rail with the candidate band, the three curtailment windows nested, and a
// peak marker. `compact` shows only the Balanced window (for the table view).
function CurtailStrip({ hourStart, windows, compact = false }) {
  const shown = compact ? windows.filter((w) => w.profile === 'Balanced') : windows
  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700/70 dark:bg-zinc-800/60 ${
        compact ? 'h-6' : 'h-10'
      }`}
    >
      <div className="absolute inset-y-0 bg-sky-500/10" style={{ left: pct(BAND_START), width: pct(BAND_END + 1 - BAND_START) }} />
      {shown.map((w, i) => {
        const inset = compact ? 3 : 6 + i * 4 // nest the widths visually
        return (
          <div
            key={w.profile}
            className="absolute rounded-sm"
            title={`${w.profile}: ${w.label}`}
            style={{
              left: pct(w.hourStart),
              width: pct(w.windowHours),
              top: inset,
              bottom: inset,
              background: 'rgba(245,158,11,0.16)',
              border: '1px solid rgba(245,158,11,0.5)',
            }}
          />
        )
      })}
      <div className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: pct(hourStart + 0.5) }}>
        <span className="absolute -left-[3px] -top-[3px] h-2 w-2 rounded-full bg-red-500" />
      </div>
    </div>
  )
}

function SelectBadge({ selected, rank }) {
  if (selected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Curtail · would be #{rank}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      Monitor · #{rank}
    </span>
  )
}

// --- panels -----------------------------------------------------------------
function PeriodExplainer({ basePeriod, billingPeriod }) {
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

function RunningBoard({ running5CP, threshold }) {
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

function PeakCard({ p }) {
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

function PeakTable({ peaks }) {
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
                <td className={`px-4 py-3 font-semibold ${conf.cls}`}>{conf.label}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AccuracyPanel({ accuracyByLead, horizons }) {
  const recall = (h) => accuracyByLead?.[String(h)]?.balancedTop5Recall?.mean ?? null
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Measured accuracy by lead time</h3>
        <span className="text-[11px] text-zinc-500">Balanced profile · top-5 recall · walk-forward backtest</span>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="flex items-end gap-4" style={{ height: 130 }}>
          {horizons.map((h) => {
            const r = recall(h)
            const col = r == null ? 'bg-zinc-400' : r >= 0.6 ? 'bg-emerald-500' : r >= 0.4 ? 'bg-amber-500' : 'bg-red-500'
            return (
              <div key={h} className="flex flex-1 flex-col items-center justify-end gap-2" style={{ height: '100%' }}>
                <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {r == null ? '—' : `${Math.round(r * 100)}%`}
                </span>
                <div className={`w-full max-w-[56px] rounded-t ${col}`} style={{ height: `${(r ?? 0) * 100}%` }} />
                <span className="text-xs text-zinc-500">{h}-day</span>
              </div>
            )
          })}
        </div>
        <ul className="space-y-2 text-xs text-zinc-500">
          <li><b className="text-zinc-700 dark:text-zinc-300">Degradation is real, not assumed.</b> Each lead is scored with only the information available that far ahead — nothing tuned to flatten the curve.</li>
          <li><b className="text-zinc-700 dark:text-zinc-300">3 / 7-day are lower bounds.</b> The backtest uses the climatology surrogate for every lead; live 3/7-day runs use the real ECCC forecast and should beat these.</li>
          <li><b className="text-zinc-700 dark:text-zinc-300">14-day is climatology.</b> No public forecast product reaches two weeks — it's an estimate, never presented as a forecast.</li>
        </ul>
      </div>
    </div>
  )
}

const HORIZON_OPTS = [3, 7, 14]

export default function PeakForecastTab() {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [refreshing, setRefreshing] = useState(false)
  const [horizon, setHorizon] = useState(14)
  const [view, setView] = useState('cards')

  // `bustCache` on a manual refresh re-reads the currently-published
  // forecast.json (bypassing CDN/browser cache). It reloads deployed data — it
  // does not regenerate the forecast; that happens in the pipeline.
  const load = useCallback(async ({ bustCache = false } = {}) => {
    if (bustCache) setRefreshing(true)
    const r = await fetchPeakForecast({ bustCache })
    // Keep prior data visible if a refresh fails to fetch.
    setState((prev) =>
      r.data ? { ...r, loading: false } : { ...prev, error: prev.data ? prev.error : r.error, loading: false }
    )
    setRefreshing(false)
    return r
  }, [])

  useEffect(() => {
    let active = true
    fetchPeakForecast().then((r) => active && setState({ ...r, loading: false }))
    return () => { active = false }
  }, [])

  const { data, error, loading } = state
  const visiblePeaks = useMemo(() => {
    if (!data) return []
    return data.predictedPeaks
      .filter((p) => p.daysOut <= horizon)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data, horizon])

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Loading forecast…</div>
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-amber-500/40 bg-amber-500/5 p-6 text-center text-sm text-zinc-600 dark:text-zinc-300">
        {error ?? 'Forecast unavailable.'}
      </div>
    )
  }

  const rel = relTime(data.generatedAt)
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            5CP Peak Forecast
            <span className="ml-2 align-middle text-xs font-medium text-zinc-500">base period {data.basePeriod.label}</span>
          </h2>
          <p className="text-xs text-zinc-500">
            When to curtail to stay out of this year's five coincident peaks.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div className="flex items-center gap-2">
            {data.sample && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                Sample data
              </span>
            )}
            <button
              onClick={() => load({ bustCache: true })}
              disabled={refreshing}
              title="Reload the latest published forecast. New forecasts are generated by the pipeline (npm run export:dashboard) and deployed with the site."
              aria-label="Refresh forecast data"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
            >
              <svg
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <span className="text-[11px] text-zinc-500">
            generated {rel ?? '—'} · data through {data.datasetThrough}
          </span>
        </div>
      </div>

      {data.staleNote && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {data.staleNote}
        </div>
      )}

      <PeriodExplainer basePeriod={data.basePeriod} billingPeriod={data.billingPeriod} />
      <RunningBoard running5CP={data.running5CP} threshold={data.threshold} />

      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Horizon</span>
          <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            {HORIZON_OPTS.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`px-3 py-1.5 text-xs font-medium ${
                  horizon === h
                    ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                    : 'bg-white text-zinc-500 hover:text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {h} days
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">View</span>
          <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            {[['cards', 'Cards'], ['table', 'Table']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`px-3 py-1.5 text-xs font-medium ${
                  view === id
                    ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                    : 'bg-white text-zinc-500 hover:text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* predicted peaks */}
      {visiblePeaks.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-panel">
          No predicted peaks within {horizon} days that approach the current top-5.
        </div>
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiblePeaks.map((p) => <PeakCard key={p.date} p={p} />)}
        </div>
      ) : (
        <PeakTable peaks={visiblePeaks} />
      )}

      <AccuracyPanel accuracyByLead={data.accuracyByLead} horizons={data.horizons} />

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Forecast from the peak-prediction pipeline (demand + weather OLS model), exported to
        <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">public/peak-forecast/forecast.json</code>.
        Weather input is ECCC's forecast within ~7 days, climatology beyond it. Not affiliated with the IESO.
      </p>
    </div>
  )
}
