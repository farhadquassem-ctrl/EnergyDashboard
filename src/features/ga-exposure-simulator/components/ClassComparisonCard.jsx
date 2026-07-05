import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ReferenceDot,
} from 'recharts'
import { useTheme } from '../../../theme.jsx'
import { fmtDollars, fmtPdf } from '../calculations'

// Class A vs Class B card with the break-even chart: annual GA cost as a
// function of PDF. Class A is the line through the origin (PDF × annual Class
// A pool); Class B is flat (volume × rate, independent of PDF). They cross at
// the break-even PDF; the customer's own PDF is marked. Same axis/tooltip
// treatment and series hues as the shared PriceChart (sky + amber pair) — one
// y-axis, both series in dollars.

const CHART_COLORS = {
  dark: { axis: '#52525b', grid: '#27272a', legend: '#a1a1aa', ref: '#a1a1aa' },
  light: { axis: '#71717a', grid: '#d4d4d8', legend: '#52525b', ref: '#71717a' },
}

const kFmt = (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`)

function BreakevenTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-panel">
      <div className="mb-1 font-semibold text-zinc-800 dark:text-zinc-200">PDF {label}%</div>
      {payload.map((e) => (
        <div key={e.dataKey} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
          <span className="text-zinc-500 dark:text-zinc-400">{e.name}</span>
          <span className="ml-auto font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{fmtDollars(e.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ClassComparisonCard({ comparison, pdf }) {
  const { theme } = useTheme()
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark
  const { classADollars, classBDollars, breakevenPdf, annualPool, recommendedClass, savingsDollars } = comparison

  // Domain: comfortably past both the break-even and the customer's PDF.
  const maxPdf = Math.max((breakevenPdf ?? 0) * 1.6, (pdf ?? 0) * 1.4, 1e-6)
  const rows = Array.from({ length: 41 }, (_, i) => {
    const x = (i / 40) * maxPdf
    return { pdfPct: +(x * 100).toFixed(4), label: (x * 100).toFixed(3), classA: x * annualPool, classB: classBDollars }
  })

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Class A vs Class B</h3>
        <span className="text-[11px] text-zinc-500">annual GA over the billing period</span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Class A (ICI)</div>
          <div className="text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtDollars(classADollars)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Class B (volumetric)</div>
          <div className="text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtDollars(classBDollars)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Recommended</div>
          <div className={`text-lg font-bold ${recommendedClass === 'A' ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-600 dark:text-sky-400'}`}>
            {recommendedClass ? `Class ${recommendedClass}` : '—'}
          </div>
        </div>
      </div>

      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="pdfPct" type="number" domain={[0, +(maxPdf * 100).toFixed(4)]}
              stroke={colors.axis} tick={{ fontSize: 10, fill: colors.axis }}
              tickFormatter={(v) => `${v}%`} label={undefined}
            />
            <YAxis stroke={colors.axis} tick={{ fontSize: 10, fill: colors.axis }} tickFormatter={kFmt} width={52} />
            <Tooltip content={<BreakevenTooltip />} labelFormatter={(v) => v} />
            <Legend wrapperStyle={{ fontSize: 12, color: colors.legend }} iconType="plainline" />
            <Line type="linear" dataKey="classA" name="Class A cost (PDF × pool)" stroke="#38bdf8" strokeWidth={2} dot={false} />
            <Line type="linear" dataKey="classB" name="Class B cost (flat)" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            {pdf != null && (
              <ReferenceLine x={+(pdf * 100).toFixed(4)} stroke={colors.ref} strokeDasharray="2 3"
                label={{ value: 'your PDF', position: 'top', fontSize: 10, fill: colors.legend }} />
            )}
            {breakevenPdf != null && (
              <ReferenceDot x={+(breakevenPdf * 100).toFixed(4)} y={classBDollars} r={4} fill="#f59e0b" stroke="none" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[11px] text-zinc-500">
        Break-even PDF <b className="tabular-nums text-zinc-700 dark:text-zinc-300">{fmtPdf(breakevenPdf)}</b> — below it Class A wins.
        {savingsDollars != null && (
          <> Staying Class A at your PDF {savingsDollars >= 0 ? 'saves' : 'costs an extra'}{' '}
            <b className={`tabular-nums ${savingsDollars >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {fmtDollars(Math.abs(savingsDollars))}
            </b>{' '}vs Class B.</>
        )}
      </p>
    </div>
  )
}
