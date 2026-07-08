import { useState } from 'react'

// Confirm/correct the extracted fields before a bill enters the analysis set.
// OCR is fallible (hence the disclaimer), so nothing is analyzed until the user
// has eyeballed these values — the human-in-the-loop step the spec implies.

const NUM_FIELDS = [
  ['offPeakKwh', 'Off-peak kWh'],
  ['midPeakKwh', 'Mid-peak kWh'],
  ['onPeakKwh', 'On-peak kWh'],
  ['totalKwh', 'Total kWh (optional)'],
  ['totalBilledAmount', 'Total billed ($)'],
]

const inputCls =
  'w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'

export default function BillFieldsForm({ initial, confidence, source, lowConfidence, onConfirm, onDiscard }) {
  const [f, setF] = useState(() => ({
    meterId: initial.meterId ?? '',
    startDate: initial.startDate ?? '',
    endDate: initial.endDate ?? '',
    offPeakKwh: initial.offPeakKwh ?? '',
    midPeakKwh: initial.midPeakKwh ?? '',
    onPeakKwh: initial.onPeakKwh ?? '',
    totalKwh: initial.totalKwh ?? '',
    totalBilledAmount: initial.totalBilledAmount ?? '',
    ratePlan: initial.ratePlan ?? 'TOU',
  }))
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[^0-9.-]/g, '')))
  const errors = []
  if (!f.startDate || !f.endDate) errors.push('Start and end dates are required.')
  if (num(f.offPeakKwh) == null && num(f.midPeakKwh) == null && num(f.onPeakKwh) == null) errors.push('At least one kWh bucket is required.')

  const confirm = () => {
    if (errors.length) return
    onConfirm({
      id: `${(f.meterId || 'meter')}-${f.startDate}-${Math.random().toString(36).slice(2, 7)}`,
      meterId: f.meterId || 'UNKNOWN-METER',
      startDate: f.startDate,
      endDate: f.endDate,
      offPeakKwh: num(f.offPeakKwh) ?? 0,
      midPeakKwh: num(f.midPeakKwh) ?? 0,
      onPeakKwh: num(f.onPeakKwh) ?? 0,
      totalKwh: num(f.totalKwh) ?? undefined,
      totalBilledAmount: num(f.totalBilledAmount) ?? 0,
      ratePlan: f.ratePlan,
      source,
    })
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Confirm the bill details</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          lowConfidence ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
        }`}>
          {source === 'vision' ? 'cloud read' : source === 'ocr' ? 'on-device OCR' : 'manual'} · {Math.round((confidence ?? 0) * 100)}% confidence
        </span>
      </div>

      {lowConfidence && (
        <p className="mb-3 text-[11px] text-amber-700 dark:text-amber-300">
          Low confidence — please check every value against your bill before adding it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <label className="col-span-2 flex flex-col gap-1 md:col-span-1">
          <span className="text-[11px] font-medium text-zinc-500">Meter / account id</span>
          <input className={inputCls} value={f.meterId} onChange={(e) => set('meterId', e.target.value)} placeholder="e.g. M-4483920" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-500">Start date</span>
          <input type="date" className={inputCls} value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-500">End date</span>
          <input type="date" className={inputCls} value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </label>
        {NUM_FIELDS.map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-500">{label}</span>
            <input className={inputCls} inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-zinc-500">Rate plan</span>
          <select className={inputCls} value={f.ratePlan} onChange={(e) => set('ratePlan', e.target.value)}>
            {['TOU', 'ULO', 'TIERED', 'UNKNOWN'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-red-600 dark:text-red-400">
          {errors.map((e, i) => <li key={i}>• {e}</li>)}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={confirm} disabled={errors.length > 0} className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300">
          Add to analysis
        </button>
        <button onClick={onDiscard} className="rounded-md px-2.5 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          Discard
        </button>
      </div>
    </div>
  )
}
