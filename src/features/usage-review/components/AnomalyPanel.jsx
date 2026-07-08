// Renders the anomaly engine's output as a list of advisories, most-severe
// first. Pure presentation of Anomaly[] (from analyzeAnomalies.ts).

const TYPE_LABEL = {
  VOLUME_SPIKE: 'Usage spike',
  PEAK_HEAVY: 'On-peak heavy',
  RAPID_INCREASE: 'Rapid increase',
}

const SEV_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 }

export const SEV_CLS = {
  HIGH: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  MEDIUM: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  LOW: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
}

const fmtPeriod = (row) => (row ? row.label : '')

export default function AnomalyPanel({ anomalies, timelineByBill }) {
  if (!anomalies?.length) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300">
        No anomalies detected across these billing periods. Usage is within your normal range.
      </div>
    )
  }
  const sorted = [...anomalies].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Detected anomalies</h3>
        <span className="text-[11px] text-zinc-500">{anomalies.length} flagged · most severe first</span>
      </div>
      <ul className="space-y-2">
        {sorted.map((a, i) => (
          <li key={`${a.billId}-${a.type}-${i}`} className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${SEV_CLS[a.severity]}`}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">{a.severity}</span>
              <span>{TYPE_LABEL[a.type] ?? a.type}</span>
              <span className="font-normal opacity-80">· {fmtPeriod(timelineByBill?.get(a.billId))}</span>
              {a.metric != null && (
                <span className="ml-auto tabular-nums font-bold">{a.metric > 0 ? '+' : ''}{a.metric}%</span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{a.message}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
