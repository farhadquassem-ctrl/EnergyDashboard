import { fmtDay, fmtMw, fmtPdf, fmtInt } from '../calculations'

// Peak Demand Factor card: the computed PDF and the five CP hours it is built
// from — date, hour, your MW, Ontario MW, your share — plus which base/billing
// period the number applies to. Math in calculations.computePDF (Σ/Σ form,
// cited there); this renders its output only.

export default function PdfCard({ pdfResult, basePeriod, billingPeriod, form, onFormChange }) {
  const { pdf, perPeak, sumCustomerMw, sumOntarioMw, missingCount } = pdfResult
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Peak Demand Factor</h3>
        <span className="text-[11px] text-zinc-500">
          base {basePeriod?.label ?? '—'} → billed {billingPeriod?.label ?? '—'}
        </span>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
          {fmtPdf(pdf)}
        </span>
        <span className="text-xs text-zinc-500">
          = {fmtMw(sumCustomerMw)} / {fmtInt(sumOntarioMw)} MW over the 5 CPs
        </span>
      </div>
      {missingCount > 0 && (
        <p className="mt-1 text-[11px] font-medium text-red-700 dark:text-red-300">
          {missingCount} CP hour(s) missing from your data — this PDF is a lower bound, not a billing figure.
        </p>
      )}

      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
            <th className="py-1.5 pr-2 font-semibold">CP</th>
            <th className="py-1.5 pr-2 font-semibold">Date</th>
            <th className="py-1.5 pr-2 font-semibold">Hour</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Your MW</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Ontario MW</th>
            <th className="py-1.5 text-right font-semibold">Share</th>
          </tr>
        </thead>
        <tbody>
          {perPeak.map((p) => (
            <tr key={p.cpRank} className="border-b border-zinc-100 tabular-nums last:border-none dark:border-zinc-800">
              <td className="py-1.5 pr-2 font-semibold text-zinc-700 dark:text-zinc-300">#{p.cpRank}</td>
              <td className="py-1.5 pr-2 text-zinc-600 dark:text-zinc-400">{fmtDay(p.date)}</td>
              <td className="py-1.5 pr-2 text-zinc-600 dark:text-zinc-400">HE{p.hourEnding}</td>
              <td className={`py-1.5 pr-2 text-right ${p.missing ? 'font-medium text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-200'}`}>
                {p.missing ? 'no data' : fmtMw(p.customerMw)}{p.partial ? ' ⚠' : ''}
              </td>
              <td className="py-1.5 pr-2 text-right text-zinc-600 dark:text-zinc-400">{fmtInt(p.ontarioMw)}</td>
              <td className="py-1.5 text-right text-zinc-800 dark:text-zinc-200">{p.share == null ? '—' : fmtPdf(p.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
        <span>
          Ontario MW = official IESO AQEW ranking (never re-derived from raw demand).
        </span>
        <label className="flex items-center gap-1.5">
          <span>PDF definition</span>
          <select
            className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
            value={form}
            onChange={(e) => onFormChange(e.target.value)}
            title="Σ/Σ is the IESO allocation form (and makes the per-CP $ decomposition exactly additive); mean-of-ratios is shown for comparison because some explainers use it."
          >
            <option value="sum-over-sum">Σ/Σ (IESO standard)</option>
            <option value="mean-of-ratios">mean of per-CP ratios</option>
          </select>
        </label>
      </div>
    </div>
  )
}
