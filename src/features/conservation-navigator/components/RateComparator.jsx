import { useMemo, useState } from 'react'
import { planCosts, PLAN_LABEL, fmtDollars, fmtCents } from '../calculations'

// Interactive TOU vs ULO vs Tiered comparator. The value-add for the "rate plan
// optimization" use case: enter your monthly usage + how it splits across the
// day, and see which regulated plan is cheapest after the OER — including how
// much shifting load overnight is worth on ULO.

const numCls = 'w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs tabular-nums text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'
const PLAN_COLOR = { tou: 'bg-sky-500', ulo: 'bg-emerald-500', tiered: 'bg-amber-500' }

export default function RateComparator({ rates }) {
  const [monthlyKwh, setMonthlyKwh] = useState(1000)
  const [split, setSplit] = useState({ off: 65, mid: 18, on: 17 })
  const [uloShare, setUloShare] = useState(30)

  const result = useMemo(
    () => planCosts({ monthlyKwh, split: { off: split.off, mid: split.mid, on: split.on }, uloOvernightShare: uloShare / 100 }, rates),
    [monthlyKwh, split, uloShare, rates],
  )

  const maxCost = Math.max(...Object.values(result.plans).map((p) => p.monthlyAfterOer))
  const setS = (k, v) => setSplit((s) => ({ ...s, [k]: Math.max(0, Number(v) || 0) }))

  return (
    <div id="rate-comparator" className="scroll-mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Rate plan comparator</h3>
        {rates.illustrative && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300" title={rates.source}>
            illustrative rates — verify at OEB
          </span>
        )}
      </div>

      {/* inputs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-500">Monthly kWh</span>
          <input className={numCls} inputMode="numeric" value={monthlyKwh} onChange={(e) => setMonthlyKwh(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-500">Off-peak %</span>
          <input className={numCls} inputMode="numeric" value={split.off} onChange={(e) => setS('off', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-500">Mid-peak %</span>
          <input className={numCls} inputMode="numeric" value={split.mid} onChange={(e) => setS('mid', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-500">On-peak %</span>
          <input className={numCls} inputMode="numeric" value={split.on} onChange={(e) => setS('on', e.target.value)} />
        </label>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
          <span>Share of usage you could move overnight (for ULO)</span>
          <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{uloShare}%</span>
        </div>
        <input type="range" min="0" max="90" value={uloShare} onChange={(e) => setUloShare(Number(e.target.value))} className="w-full accent-emerald-500" />
      </div>

      {/* results */}
      <div className="mt-4 space-y-2">
        {['tou', 'ulo', 'tiered'].map((key) => {
          const p = result.plans[key]
          const isRec = result.recommended === key
          return (
            <div key={key} className="flex items-center gap-3">
              <span className={`w-32 shrink-0 text-xs ${isRec ? 'font-bold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400'}`}>
                {PLAN_LABEL[key]}{isRec && ' ✓'}
              </span>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                <div className={`h-full ${PLAN_COLOR[key]} ${isRec ? '' : 'opacity-60'}`} style={{ width: `${maxCost > 0 ? (p.monthlyAfterOer / maxCost) * 100 : 0}%` }} />
              </div>
              <span className="w-28 shrink-0 text-right text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                {fmtDollars(p.monthlyAfterOer)}/mo
              </span>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        Cheapest for this profile: <b className="text-zinc-700 dark:text-zinc-300">{PLAN_LABEL[result.recommended]}</b>
        {result.annualSavingsVsWorst > 1 && <> — about <b className="text-emerald-600 dark:text-emerald-400">{fmtDollars(result.annualSavingsVsWorst)}/yr</b> versus the priciest plan for you.</>}
        {' '}Energy charges only (ULO overnight {fmtCents(rates.ulo.ulo)} vs. on-peak {fmtCents(rates.ulo.onPeak)}); after the {Math.round((rates.oerPercent ?? 0) * 100)}% OER credit; delivery/regulatory charges excluded. Illustrative — confirm current rates with the OEB.
      </p>
    </div>
  )
}
