import { useRef, useState } from 'react'
import { detectTable, autoDetectMapping, QUANTITY_OPTS } from '../calculations'

// Upload + column-mapping panel. All parsing/normalization is pure
// (calculations.js); this component only collects the file text and the
// user's mapping corrections, then hands { table, mapping } up. The file
// never leaves the browser — it is read with FileReader and kept in memory
// only (a customer's load profile is confidential).

const selectCls =
  'rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'
const labelCls = 'text-[11px] font-medium text-zinc-500'

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  )
}

function ColSelect({ header, value, onChange, allowNone = false }) {
  return (
    <select className={selectCls} value={value ?? -1} onChange={(e) => onChange(Number(e.target.value))}>
      {allowNone && <option value={-1}>— none —</option>}
      {header.map((h, i) => (
        <option key={i} value={i}>{h || `(column ${i + 1})`}</option>
      ))}
    </select>
  )
}

const SEVERITY_CLS = {
  error: 'text-red-700 dark:text-red-300',
  warn: 'text-amber-700 dark:text-amber-300',
  info: 'text-zinc-500',
}
const SEVERITY_ICON = { error: '✕', warn: '⚠', info: 'ℹ' }

export default function MeterUpload({ table, mapping, onLoad, onMappingChange, issues, intervalMinutes, onLoadSample }) {
  const fileRef = useRef(null)
  const [fileName, setFileName] = useState(null)
  const [readError, setReadError] = useState(null)

  const handleText = (name, text) => {
    const t = detectTable(text)
    if (t.error) { setReadError(t.error); return }
    setReadError(null)
    setFileName(name)
    onLoad(t, autoDetectMapping(t.header))
  }

  const handleFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => handleText(file.name, String(reader.result))
    reader.onerror = () => setReadError('Could not read the file.')
    reader.readAsText(file)
  }

  const set = (patch) => onMappingChange({ ...mapping, ...patch })

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Interval meter data</h3>
        <span className="text-[11px] text-zinc-500">CSV / TXT (MV-90, Itron, utility exports) · stays in your browser — nothing is uploaded</span>
      </div>

      <div
        className="flex flex-wrap items-center gap-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
      >
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-500/20 dark:text-sky-300"
        >
          Choose file…
        </button>
        <input
          ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <span className="text-xs text-zinc-500">
          {fileName ? <>loaded <b className="text-zinc-700 dark:text-zinc-300">{fileName}</b></> : 'or drop a file here'}
        </span>
        {onLoadSample && (
          <button
            onClick={() => { const s = onLoadSample(); handleText(s.name, s.text) }}
            className="ml-auto rounded-md border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            title="Generate a synthetic 15-minute sample profile covering the base period's CP days, so you can try the tab without real data."
          >
            Load sample profile
          </button>
        )}
      </div>

      {readError && <p className="mt-2 text-xs text-red-700 dark:text-red-300">{readError}</p>}

      {table && mapping && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Timestamp layout">
              <select
                className={selectCls}
                value={mapping.timestampMode}
                onChange={(e) => set({ timestampMode: e.target.value })}
              >
                <option value="single">one date-time column</option>
                <option value="split">separate date + time</option>
              </select>
            </Field>
            {mapping.timestampMode === 'single' ? (
              <Field label="Timestamp column">
                <ColSelect header={table.header} value={mapping.timestampCol} onChange={(v) => set({ timestampCol: v })} />
              </Field>
            ) : (
              <>
                <Field label="Date column">
                  <ColSelect header={table.header} value={mapping.dateCol} onChange={(v) => set({ dateCol: v })} />
                </Field>
                <Field label="Time column">
                  <ColSelect header={table.header} value={mapping.timeCol} onChange={(v) => set({ timeCol: v })} />
                </Field>
              </>
            )}
            <Field label="Timestamps mark interval…">
              <select
                className={selectCls}
                value={mapping.intervalEnding ? 'ending' : 'starting'}
                onChange={(e) => set({ intervalEnding: e.target.value === 'ending' })}
              >
                <option value="ending">ending (MV-90 convention)</option>
                <option value="starting">starting</option>
              </select>
            </Field>
            <Field label="Interval length">
              <select
                className={selectCls}
                value={mapping.intervalMinutes ?? 'auto'}
                onChange={(e) => set({ intervalMinutes: e.target.value === 'auto' ? null : Number(e.target.value) })}
              >
                <option value="auto">auto ({intervalMinutes ?? '?'} min detected)</option>
                {[5, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </Field>

            {!mapping.deriveFromKva && (
              <>
                <Field label="Reading column (withdrawal)">
                  <ColSelect header={table.header} value={mapping.quantityCol} onChange={(v) => set({ quantityCol: v })} />
                </Field>
                <Field label="Quantity / unit">
                  <select className={selectCls} value={mapping.quantityUnit} onChange={(e) => set({ quantityUnit: e.target.value })}>
                    {QUANTITY_OPTS.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                  </select>
                </Field>
                <Field label="Received / generation column">
                  <ColSelect header={table.header} value={mapping.receivedCol ?? -1} allowNone
                    onChange={(v) => set({ receivedCol: v === -1 ? null : v })} />
                </Field>
              </>
            )}

            <Field label="Real power source">
              <select
                className={selectCls}
                value={mapping.deriveFromKva ? 'kva' : 'direct'}
                onChange={(e) => set({ deriveFromKva: e.target.value === 'kva' })}
              >
                <option value="direct">metered directly (kW/kWh…)</option>
                <option value="kva">derive from kVA/kVAR (or PF)</option>
              </select>
            </Field>
            {mapping.deriveFromKva && (
              <>
                <Field label="kVA column">
                  <ColSelect header={table.header} value={mapping.kvaCol} onChange={(v) => set({ kvaCol: v })} />
                </Field>
                <Field label="kVAR column">
                  <ColSelect header={table.header} value={mapping.kvarCol ?? -1} allowNone onChange={(v) => set({ kvarCol: v === -1 ? null : v })} />
                </Field>
                <Field label="Power-factor column">
                  <ColSelect header={table.header} value={mapping.pfCol ?? -1} allowNone onChange={(v) => set({ pfCol: v === -1 ? null : v })} />
                </Field>
              </>
            )}
          </div>

          {mapping.deriveFromKva && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Deriving real power as kW = √(kVA² − kVAR²){mapping.kvarCol == null && mapping.pfCol != null ? ' — using kW = kVA × PF (no kVAR column mapped)' : ''}.
              This is an assumption about your metering — confirm it matches your channel configuration.
            </p>
          )}

          <p className="mt-2 text-[11px] text-zinc-500">
            {table.preamble.length > 0 && <>Skipped {table.preamble.length} preamble line(s) above the header. </>}
            {table.malformedRows > 0 && <>Ignored {table.malformedRows} malformed row(s). </>}
            {table.rows.length.toLocaleString()} data rows · delimiter “{table.delimiter === '\t' ? 'tab' : table.delimiter}” ·
            interpreted on the Eastern (EPT, DST-aware) clock — the same clock as IESO demand and the 5CP hours ·
            net withdrawal = delivered − received (ICI bills grid withdrawal).
          </p>

          {issues?.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-700">
              {issues.map((i, k) => (
                <li key={k} className={`flex gap-2 ${SEVERITY_CLS[i.severity]}`}>
                  <span className="shrink-0">{SEVERITY_ICON[i.severity]}</span>
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
