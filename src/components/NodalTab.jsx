import { useEffect, useMemo, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import { lmpToColor } from '../utils/colorScale'
import StatusBadge from './StatusBadge'
import { fetchNodal } from '../data/nodalClient'

// Tint a cell using the shared price colour scale (reused, not modified):
// cool for negative, warm for positive — matching the map.
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
function divergingCellStyle(p) {
  if (p.value == null) return { color: '#71717a' }
  return {
    backgroundColor: hexToRgba(lmpToColor(p.value), 0.28),
    color: '#e4e4e7',
  }
}

const num = (p) => (p.value == null ? '—' : Number(p.value).toFixed(2))
const pct = (p) => (p.value == null ? '—' : `${Math.round(p.value)}%`)

// AG Grid theme variables tuned to the app's zinc / near-black palette.
const GRID_THEME_VARS = {
  '--ag-background-color': '#18181b',
  '--ag-header-background-color': '#27272a',
  '--ag-odd-row-background-color': '#1b1b1e',
  '--ag-row-hover-color': '#27272a',
  '--ag-border-color': '#3f3f46',
  '--ag-foreground-color': '#e4e4e7',
  '--ag-header-foreground-color': '#a1a1aa',
  '--ag-font-size': '12px',
  '--ag-font-family':
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
}

const columnDefs = [
  { headerName: 'Node', field: 'nodeName', flex: 2, minWidth: 200, filter: 'agTextColumnFilter' },
  { headerName: 'Type', field: 'locationType', minWidth: 110, filter: 'agTextColumnFilter' },
  { headerName: 'Zone', field: 'zone', minWidth: 90, valueFormatter: (p) => p.value ?? '—' },
  { headerName: 'LMP', field: 'lmp', type: 'rightAligned', valueFormatter: num, minWidth: 90 },
  { headerName: 'Energy', field: 'energy', type: 'rightAligned', valueFormatter: num, minWidth: 90 },
  {
    headerName: 'Congestion',
    field: 'congestion',
    type: 'rightAligned',
    valueFormatter: num,
    cellStyle: divergingCellStyle,
    sort: 'desc', // default: most-constrained surfaced first
    minWidth: 110,
  },
  { headerName: 'Loss', field: 'loss', type: 'rightAligned', valueFormatter: num, minWidth: 80 },
  {
    headerName: 'Basis (vs ONZP)',
    field: 'basis',
    type: 'rightAligned',
    valueFormatter: num,
    cellStyle: divergingCellStyle,
    minWidth: 120,
  },
  { headerName: 'Cong %', field: 'congestionPct', type: 'rightAligned', valueFormatter: pct, minWidth: 90 },
]

const defaultColDef = {
  sortable: true,
  filter: true,
  resizable: true,
  minWidth: 80,
}

const TYPE_ORDER = ['Generator', 'Load', 'DRA', 'Storage', 'Node', 'Other']

function summarise(rows) {
  const by = {}
  for (const r of rows) {
    const t = r.locationType ?? 'Other'
    const s = (by[t] ??= { type: t, n: 0, lmp: 0, cong: 0, maxAbsCong: 0, maxBasis: -Infinity })
    s.n++
    if (r.lmp != null) s.lmp += r.lmp
    if (r.congestion != null) {
      s.cong += r.congestion
      s.maxAbsCong = Math.max(s.maxAbsCong, Math.abs(r.congestion))
    }
    if (r.basis != null) s.maxBasis = Math.max(s.maxBasis, r.basis)
  }
  return Object.values(by)
    .map((s) => ({
      type: s.type,
      n: s.n,
      avgLmp: s.lmp / s.n,
      avgCong: s.cong / s.n,
      maxAbsCong: s.maxAbsCong,
      maxBasis: s.maxBasis === -Infinity ? null : s.maxBasis,
    }))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
}

/**
 * Nodal tab: the trader/analyst tabular view. Manual-refresh only (no polling).
 */
export default function NodalTab() {
  const [state, setState] = useState({
    rows: [],
    onzp: null,
    asOf: null,
    isLive: false,
    loading: true,
  })

  const load = async () => {
    setState((s) => ({ ...s, loading: true }))
    const data = await fetchNodal()
    setState({ ...data, loading: false })
  }

  useEffect(() => {
    load()
  }, [])

  const summary = useMemo(() => summarise(state.rows), [state.rows])
  const asOfText = state.asOf
    ? new Date(state.asOf).toLocaleTimeString('en-CA', { hour12: false })
    : '—'

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
            Nodal LMP — {state.loading ? '…' : state.rows.length} pricing locations
          </h2>
          <p className="text-xs text-zinc-500">
            Nodal LMP = energy + congestion + loss · basis = node − Ontario Zonal
            Price (ONZP{state.onzp != null ? ` $${state.onzp.toFixed(2)}` : ''})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">as of {asOfText}</span>
          <StatusBadge isLive={state.isLive} loading={state.loading} asOf={state.asOf} />
          <button
            onClick={load}
            disabled={state.loading}
            className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
          >
            {state.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Per-type summary strip (client-side aggregation; grouping is Enterprise) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {summary.map((s) => (
          <div
            key={s.type}
            className="rounded-lg border border-zinc-800 bg-panel px-3 py-2"
          >
            <div className="text-[11px] font-semibold text-zinc-300">
              {s.type} <span className="text-zinc-500">({s.n})</span>
            </div>
            <div className="mt-1 text-[10px] leading-4 text-zinc-500">
              avg LMP ${s.avgLmp.toFixed(1)}
              <br />
              max |cong| ${s.maxAbsCong.toFixed(0)}
            </div>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        className="ag-theme-quartz-dark min-h-[480px] flex-1 overflow-hidden rounded-xl border border-zinc-800"
        style={GRID_THEME_VARS}
      >
        <AgGridReact
          rowData={state.rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          animateRows={false}
          enableCellTextSelection
          suppressDragLeaveHidesColumns
        />
      </div>
    </div>
  )
}
