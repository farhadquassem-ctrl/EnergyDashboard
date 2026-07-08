import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'
import { useTheme } from '../../../theme.jsx'

// TOU usage over time (Phase 5). Plots DAILY-average kWh per billing period
// (raw period totals aren't comparable across 27–33-day periods), stacked
// off/mid/on-peak. Periods carrying an anomaly get a ⚠ glyph on their axis
// label and a highlighted total, so warnings sit next to the relevant bar.

const OFF = { light: '#34d399', dark: '#10b981' } // emerald
const MID = { light: '#fbbf24', dark: '#f59e0b' } // amber
const ON = { light: '#f87171', dark: '#ef4444' } // red

export default function BillTimelineChart({ rows }) {
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const axis = dark ? '#a1a1aa' : '#52525b'
  const grid = dark ? '#27272a' : '#e4e4e7'
  const pick = (c) => (dark ? c.dark : c.light)

  const flagged = new Set(rows.filter((r) => r.anomalies.length).map((r) => r.label))

  const AxisTick = ({ x, y, payload }) => {
    const isFlagged = flagged.has(payload.value)
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={10} textAnchor="middle" fontSize={10} fill={isFlagged ? (dark ? '#fca5a5' : '#dc2626') : axis}>
          {isFlagged ? '⚠ ' : ''}{payload.value}
        </text>
      </g>
    )
  }

  const TooltipContent = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const r = payload[0].payload
    return (
      <div className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-1 font-semibold text-zinc-800 dark:text-zinc-100">{r.label} · {r.billingDays} days</div>
        <div className="space-y-0.5 tabular-nums text-zinc-600 dark:text-zinc-300">
          <div>Off-peak: {r.dailyOffPeakKwh} kWh/day</div>
          <div>Mid-peak: {r.dailyMidPeakKwh} kWh/day</div>
          <div>On-peak: {r.dailyOnPeakKwh} kWh/day</div>
          <div className="border-t border-zinc-200 pt-0.5 font-medium dark:border-zinc-700">Total: {r.dailyTotalKwh} kWh/day ({r.totalKwh} kWh)</div>
        </div>
        {r.anomalies.length > 0 && (
          <div className="mt-1 border-t border-amber-500/30 pt-1 font-medium text-amber-600 dark:text-amber-400">⚠ {r.anomalies.join(', ')}</div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">TOU usage over time</h3>
        <span className="text-[11px] text-zinc-500">daily-average kWh · normalized for period length</span>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
            <XAxis dataKey="label" tick={<AxisTick />} interval={0} stroke={axis} />
            <YAxis tick={{ fontSize: 10, fill: axis }} stroke={axis} label={{ value: 'kWh/day', angle: -90, position: 'insideLeft', fontSize: 10, fill: axis }} />
            <Tooltip content={<TooltipContent />} cursor={{ fill: dark ? '#ffffff10' : '#00000008' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="dailyOffPeakKwh" stackId="tou" name="Off-peak" fill={pick(OFF)} />
            <Bar dataKey="dailyMidPeakKwh" stackId="tou" name="Mid-peak" fill={pick(MID)} />
            <Bar dataKey="dailyOnPeakKwh" stackId="tou" name="On-peak" fill={pick(ON)} radius={[2, 2, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.billId} stroke={r.anomalies.length ? (dark ? '#fca5a5' : '#dc2626') : 'none'} strokeWidth={r.anomalies.length ? 2 : 0} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
