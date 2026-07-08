import { useMemo, useState } from 'react'
import TabShell, { TabEmpty } from '../../components/TabShell'
import { runOcr, fileToDataUrl } from './ocr'
import { parseBillText } from './billParsing'
import { parseWithVision } from './visionClient'
import { analyzeAnomalies } from './analyzeAnomalies'
import { buildTimeline, groupByMeter } from './timeline'
import { sampleBills } from './sampleBills'
import BillUpload from './components/BillUpload'
import RedactCanvas from './components/RedactCanvas'
import BillFieldsForm from './components/BillFieldsForm'
import BillTimelineChart from './components/BillTimelineChart'
import AnomalyPanel from './components/AnomalyPanel'
import DisclaimerBanner from './components/DisclaimerBanner'

// Usage Review Tool — phone-photo bills → structured usage → anomaly detection.
// Pipeline: Phase 1 in-browser OCR (Tesseract.js) → parse → confidence gate;
// Phase 2 (low confidence) mask PII on a canvas → serverless vision route;
// Phase 3 confirmed bills accumulate in React state, grouped by meter; Phase 4
// analyzeAnomalies (strict TS); Phase 5 Recharts timeline + verbatim disclaimer.
// All state is useState/useMemo — no backend, matching the GA Exposure tab.

const OCR_CONFIDENCE_GATE = 0.7 // below this we offer the Phase-2 cloud read

export default function UsageReviewTab() {
  const [bills, setBills] = useState([])
  const [activeMeter, setActiveMeter] = useState(null)
  // add-bill flow: stage ∈ idle | ocr | review | redact | vision
  const [flow, setFlow] = useState({ stage: 'idle' })

  const reset = () => setFlow({ stage: 'idle' })

  const handleImage = async (file) => {
    try {
      const dataUrl = await fileToDataUrl(file)
      setFlow({ stage: 'ocr', dataUrl, progress: 0 })
      const { text, confidence: ocrConf } = await runOcr(file, (p) => setFlow((s) => (s.stage === 'ocr' ? { ...s, progress: p } : s)))
      const parsed = parseBillText(text)
      const low = parsed.confidence < OCR_CONFIDENCE_GATE
      setFlow({ stage: 'review', dataUrl, fields: parsed.fields, confidence: parsed.confidence, ocrConf, source: 'ocr', low, visionTried: false })
    } catch (err) {
      setFlow({ stage: 'review', fields: {}, confidence: 0, source: 'ocr', low: true, error: String(err?.message ?? err) })
    }
  }

  const startRedact = () => setFlow((s) => ({ ...s, stage: 'redact', error: null }))

  const handleRedacted = async (redactedDataUrl) => {
    setFlow((s) => ({ ...s, stage: 'vision', busy: true, error: null }))
    try {
      const { fields, confidence } = await parseWithVision(redactedDataUrl)
      setFlow((s) => ({ ...s, stage: 'review', fields, confidence, source: 'vision', low: confidence < OCR_CONFIDENCE_GATE, busy: false, visionTried: true }))
    } catch (err) {
      // Fall back to manual entry with whatever OCR found; surface the reason.
      setFlow((s) => ({ ...s, stage: 'review', busy: false, visionTried: true, error: String(err?.message ?? err) }))
    }
  }

  const confirmBill = (bill) => {
    setBills((prev) => [...prev, bill])
    setActiveMeter(bill.meterId)
    reset()
  }

  const loadSample = () => {
    const s = sampleBills()
    setBills(s)
    setActiveMeter(s[0].meterId)
    reset()
  }

  const removeBill = (id) => setBills((prev) => prev.filter((b) => b.id !== id))
  const clearAll = () => { setBills([]); setActiveMeter(null); reset() }

  // --- analysis (Phases 3–4) ------------------------------------------------
  const grouped = useMemo(() => groupByMeter(bills), [bills])
  const meters = [...grouped.keys()]
  const active = activeMeter && grouped.has(activeMeter) ? activeMeter : meters[0] ?? null
  const activeBills = active ? grouped.get(active) : []

  const anomalies = useMemo(() => (activeBills?.length ? analyzeAnomalies(activeBills) : []), [activeBills])
  const timeline = useMemo(() => (activeBills?.length ? buildTimeline(activeBills, anomalies) : []), [activeBills, anomalies])
  const timelineByBill = useMemo(() => new Map(timeline.map((r) => [r.billId, r])), [timeline])

  return (
    <TabShell
      className="mx-auto w-full max-w-5xl"
      title={
        <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Usage Review
          <span className="ml-2 align-middle text-xs font-medium text-zinc-500">bill OCR + anomaly detection</span>
        </h2>
      }
      subtitle="Snap your electricity bills, track time-of-use consumption, and get flagged when something's off."
      actions={bills.length > 0 && (
        <button onClick={clearAll} className="rounded-md border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
          Clear all ({bills.length})
        </button>
      )}
    >
      <DisclaimerBanner />

      {/* ---- add-bill flow ---- */}
      {flow.stage === 'idle' && (
        <BillUpload onImage={handleImage} onLoadSample={bills.length === 0 ? loadSample : null} />
      )}
      {flow.stage === 'ocr' && (
        <BillUpload onImage={handleImage} busy progress={flow.progress} />
      )}
      {flow.stage === 'redact' && (
        <RedactCanvas dataUrl={flow.dataUrl} onRedacted={handleRedacted} onCancel={() => setFlow((s) => ({ ...s, stage: 'review' }))} />
      )}
      {flow.stage === 'vision' && (
        <RedactCanvas dataUrl={flow.dataUrl} onRedacted={handleRedacted} onCancel={reset} busy />
      )}
      {flow.stage === 'review' && (
        <div className="space-y-3">
          {flow.error && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">{flow.error}</div>
          )}
          {flow.low && !flow.visionTried && flow.dataUrl && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-700 dark:text-sky-300">
              <span>OCR wasn't confident. You can black out personal details and try a cloud read for a cleaner extraction.</span>
              <button onClick={startRedact} className="rounded-md border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 font-semibold hover:bg-sky-500/20">
                Black out & cloud read
              </button>
            </div>
          )}
          <BillFieldsForm
            initial={flow.fields ?? {}}
            confidence={flow.confidence}
            source={flow.source}
            lowConfidence={flow.low}
            onConfirm={confirmBill}
            onDiscard={reset}
          />
        </div>
      )}

      {/* ---- meter selector (multi-meter) ---- */}
      {meters.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Meter</span>
          <select
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            value={active ?? ''}
            onChange={(e) => setActiveMeter(e.target.value)}
          >
            {meters.map((m) => <option key={m} value={m}>{m} ({grouped.get(m).length} bills)</option>)}
          </select>
        </div>
      )}

      {/* ---- analysis output (Phases 4–5) ---- */}
      {activeBills?.length ? (
        <>
          <BillTimelineChart rows={timeline} />
          <AnomalyPanel anomalies={anomalies} timelineByBill={timelineByBill} />
          <BillList rows={timeline} onRemove={removeBill} />
        </>
      ) : flow.stage === 'idle' ? (
        <TabEmpty>Add a bill photo (or load the sample) to build your usage timeline and detect anomalies.</TabEmpty>
      ) : null}

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Anomaly checks run on <b>daily-average</b> kWh (billing periods vary 27–33 days): a modified Z-score volume
        spike, an on-peak proportion shift vs. your history, and a month-over-month velocity check that switches to
        year-over-year once you have 12+ bills so seasonal swings aren't flagged. Everything is computed in your
        browser. Not affiliated with the IESO or any utility.
      </p>
    </TabShell>
  )
}

// Compact list of the bills in the analysis set, with per-period anomaly chips.
function BillList({ rows, onRemove }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Billing periods ({rows.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] text-zinc-500">
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="py-1 pr-3">Period</th>
              <th className="py-1 pr-3 text-right">Days</th>
              <th className="py-1 pr-3 text-right">kWh</th>
              <th className="py-1 pr-3 text-right">kWh/day</th>
              <th className="py-1 pr-3">Flags</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-zinc-700 dark:text-zinc-300">
            {rows.map((r) => (
              <tr key={r.billId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-1 pr-3">{r.label}</td>
                <td className="py-1 pr-3 text-right">{r.billingDays}</td>
                <td className="py-1 pr-3 text-right">{Math.round(r.totalKwh).toLocaleString()}</td>
                <td className="py-1 pr-3 text-right">{r.dailyTotalKwh}</td>
                <td className="py-1 pr-3">
                  {r.anomalies.length
                    ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">⚠ {r.anomalies.length}</span>
                    : <span className="text-zinc-400">—</span>}
                </td>
                <td className="py-1 text-right">
                  <button onClick={() => onRemove(r.billId)} className="text-[11px] text-zinc-400 hover:text-red-500" title="Remove this bill">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
