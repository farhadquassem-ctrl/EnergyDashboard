import { fmtDollars } from '../calculations'

// GA dollar assumptions — the two knobs every $ figure on this tab scales
// with. The committed defaults are ILLUSTRATIVE (ieso.ca can't be scraped
// from the pipeline sandbox); this panel keeps that fact loud and makes both
// numbers user-overridable. Overrides live in the SHARED customerProfile.

const inputCls =
  'w-32 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-xs tabular-nums text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'

export default function AssumptionsPanel({ gaConfig, annualPool, classBRatePerKwh, onProfileChange }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">GA dollar assumptions</h3>
        {gaConfig?.illustrative && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
            ILLUSTRATIVE — not live IESO figures
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">
        <label className="flex items-center gap-1.5">
          annual Class A GA pool
          <input
            type="number" min="0" step="50" className={inputCls}
            value={Math.round(annualPool / 1e6)}
            onChange={(e) => onProfileChange({ gaAnnualClassADollars: Math.max(0, Number(e.target.value) || 0) * 1e6 })}
          />
          $M
        </label>
        <label className="flex items-center gap-1.5">
          Class B GA rate
          <input
            type="number" min="0" step="0.1" className={inputCls}
            value={+(classBRatePerKwh * 100).toFixed(2)}
            onChange={(e) => onProfileChange({ gaClassBRatePerKwh: Math.max(0, Number(e.target.value) || 0) / 100 })}
          />
          ¢/kWh
        </label>
        <span className="text-[11px]">
          monthly Class A charge = PDF × (that month's pool); pool spread as equal twelfths ({fmtDollars(annualPool / 12)}/mo)
        </span>
      </div>

      {gaConfig?.source && (
        <p className="mt-2 border-t border-zinc-200 pt-2 text-[10px] leading-relaxed text-zinc-500 dark:border-zinc-700">
          {gaConfig.source}
          {gaConfig.asOf && <> · as of {gaConfig.asOf}</>}
        </p>
      )}
    </div>
  )
}
