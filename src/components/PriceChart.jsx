import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { useTheme } from '../theme.jsx'
import { toPricePoints } from '../types/market'

// Recharts takes colors as props (not classes), so axis/grid/legend colors
// come from the active theme at render time.
const CHART_COLORS = {
  dark: { axis: '#52525b' /* zinc-600 */, grid: '#27272a' /* zinc-800 */, legend: '#a1a1aa' },
  light: { axis: '#71717a' /* zinc-500 */, grid: '#d4d4d8' /* zinc-300 */, legend: '#52525b' },
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-panel">
      <div className="mb-1 font-semibold text-zinc-800 dark:text-zinc-200">{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-zinc-500 dark:text-zinc-400">{entry.name}</span>
          <span className="ml-auto font-medium text-zinc-900 dark:text-zinc-100">
            ${entry.value?.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  )
}

// Default series set: the Overview tab's RT-vs-DA pair. New tabs pass their
// own descriptors instead of forking the chart.
const DEFAULT_SERIES = [
  { dataKey: 'zonePrice', name: 'This zone (RT)', stroke: '#38bdf8' },
  { dataKey: 'dayAhead', name: 'Day-Ahead (Ontario)', stroke: '#f59e0b', strokeDasharray: '5 4' },
]

/**
 * The shared price chart (the contract's <PriceChart>): themed line chart of
 * one or more $/MWh series over time.
 *
 * Data can arrive two ways:
 *  - `data`: PricePoint[] rows (one row per x point, one column per series) —
 *    the base chart-row shape from types/market.js
 *  - `intervals`: normalized IntervalPrice[] straight from a lib/ieso adapter;
 *    pivoted here via toPricePoints (columns keyed by market, e.g. 'RT'/'DA')
 *
 * `series` describes the lines: [{ dataKey, name, stroke, strokeDasharray? }].
 * Defaults preserve the Overview tab's original RT + DA rendering exactly.
 */
export default function PriceChart({
  title,
  zoneName,
  unitLabel = '$/MWh · 24h',
  data = [],
  intervals = null,
  series = DEFAULT_SERIES,
  loading,
  isLive,
}) {
  const { theme } = useTheme()
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark
  const rows = intervals ? toPricePoints(intervals) : data
  const empty = !loading && rows.length === 0
  // Thin the x-axis to ~8 labels regardless of how many 5-min points there are.
  const tickInterval = Math.max(0, Math.floor(rows.length / 8))
  const heading = title ?? `Real-Time Price — ${zoneName}`
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {heading}
        </h2>
        <span className="text-xs text-zinc-500">
          {unitLabel}{!loading && !isLive ? ' · mock' : ''}
        </span>
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
          Loading price series…
        </div>
      )}

      {empty && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-zinc-500">
          No published intervals yet for the current hour.
        </div>
      )}

      <div className={`min-h-0 flex-1 ${loading || empty ? 'hidden' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
          >
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              stroke={colors.axis}
              tick={{ fontSize: 10, fill: colors.axis }}
              interval={tickInterval}
              minTickGap={24}
            />
            <YAxis
              stroke={colors.axis}
              tick={{ fontSize: 10, fill: colors.axis }}
              domain={['auto', 'auto']}
              width={36}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: colors.legend }}
              iconType="plainline"
            />
            {series.map((s) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                strokeDasharray={s.strokeDasharray}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
