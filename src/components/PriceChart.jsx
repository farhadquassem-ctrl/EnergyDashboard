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

const AXIS_COLOR = '#52525b' // zinc-600
const GRID_COLOR = '#27272a' // zinc-800

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-zinc-700 bg-panel px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-zinc-200">{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-zinc-400">{entry.name}</span>
          <span className="ml-auto font-medium text-zinc-100">
            ${entry.value?.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Right column: rolling ~24h of 5-min real-time price for the selected zone,
 * with the province day-ahead cleared price overlaid as a per-hour reference.
 */
export default function PriceChart({ zoneName, data = [], loading, isLive }) {
  const empty = !loading && data.length === 0
  // Thin the x-axis to ~8 labels regardless of how many 5-min points there are.
  const tickInterval = Math.max(0, Math.floor(data.length / 8))
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Real-Time Price — {zoneName}
        </h2>
        <span className="text-xs text-zinc-500">
          $/MWh · 24h{!loading && !isLive ? ' · mock' : ''}
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
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
          >
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              stroke={AXIS_COLOR}
              tick={{ fontSize: 10, fill: AXIS_COLOR }}
              interval={tickInterval}
              minTickGap={24}
            />
            <YAxis
              stroke={AXIS_COLOR}
              tick={{ fontSize: 10, fill: AXIS_COLOR }}
              domain={['auto', 'auto']}
              width={36}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: '#a1a1aa' }}
              iconType="plainline"
            />
            <Line
              type="monotone"
              dataKey="zonePrice"
              name="This zone (RT)"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="dayAhead"
              name="Day-Ahead (Ontario)"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
