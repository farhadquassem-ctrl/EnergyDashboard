import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
// Side-effect import of the packages bundle registers all community modules.
// Without it the production build ships an unregistered grid that renders blank
// (no headers/rows). Must precede the CSS imports.
import 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import { lmpToColor } from '../utils/colorScale'
import StatusBadge from './StatusBadge'
import { fetchNodal } from '../data/nodalClient'

// --- shared cell helpers ---------------------------------------------------
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
function divergingCellStyle(p) {
  if (p.value == null || p.value === '') return { color: '#71717a' }
  return { backgroundColor: hexToRgba(lmpToColor(p.value), 0.28), color: '#e4e4e7' }
}
const num = (p) => (p.value == null || p.value === '' ? '—' : Number(p.value).toFixed(2))
const pct = (p) => (p.value == null || p.value === '' ? '—' : `${Math.round(p.value)}%`)

// --- grouping (hand-rolled; AG Grid Community has no row grouping) ----------
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function aggregate(rows) {
  const lmps = rows.map((r) => r.lmp).filter((n) => n != null)
  const congs = rows.map((r) => r.congestion).filter((n) => n != null)
  const bases = rows.map((r) => r.basis).filter((n) => n != null)
  return {
    count: rows.length,
    avgLmp: avg(lmps),
    avgCong: avg(congs),
    maxCong: congs.length ? Math.max(...congs.map(Math.abs)) : null,
    maxBasis: bases.length ? Math.max(...bases.map(Math.abs)) : null,
  }
}

// Build a tree of groups for the given level fields, sorted most-constrained
// first (by max |congestion|); leaves sorted by congestion descending.
function buildTree(rows, levels, prefix = '') {
  if (!levels.length) return null
  const [lvl, ...rest] = levels
  const map = new Map()
  for (const r of rows) {
    const k = r[lvl] ?? 'Unmapped'
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return [...map.entries()]
    .map(([key, rs]) => {
      const aggr = aggregate(rs)
      const groupKey = `${prefix}${lvl}:${key}`
      return {
        key,
        groupKey,
        aggr,
        children: rest.length ? buildTree(rs, rest, `${groupKey}|`) : null,
        leaves: rest.length
          ? null
          : [...rs].sort((a, b) => (b.congestion ?? -1e9) - (a.congestion ?? -1e9)),
      }
    })
    .sort((a, b) => (b.aggr.maxCong ?? -1) - (a.aggr.maxCong ?? -1))
}

function collectKeys(tree, out = []) {
  for (const g of tree ?? []) {
    out.push(g.groupKey)
    if (g.children) collectKeys(g.children, out)
  }
  return out
}

// Flatten the tree into AG Grid rows, honouring expansion state.
function flatten(tree, expanded, depth = 0, out = []) {
  for (const g of tree ?? []) {
    const isExpanded = expanded.has(g.groupKey)
    out.push({
      __kind: 'group',
      __depth: depth,
      __key: g.groupKey,
      __expanded: isExpanded,
      name: g.key,
      count: g.aggr.count,
      lmp: g.aggr.avgLmp,
      congestion: g.aggr.avgCong,
      maxCong: g.aggr.maxCong,
      basis: g.aggr.maxBasis,
      type: '',
      loss: '',
      congestionPct: '',
    })
    if (isExpanded) {
      if (g.children) flatten(g.children, expanded, depth + 1, out)
      else for (const lf of g.leaves) out.push({ __kind: 'leaf', __depth: depth + 1, ...lf })
    }
  }
  return out
}

// First column: indented caret + group label (with count) or node name.
function NameCell(p) {
  const d = p.data || {}
  const pad = (d.__depth || 0) * 14
  if (d.__kind === 'group') {
    return (
      <span style={{ paddingLeft: pad }} className="font-semibold text-zinc-100">
        <span className="inline-block w-4 text-zinc-400">{d.__expanded ? '▾' : '▸'}</span>
        {d.name} <span className="font-normal text-zinc-500">({d.count})</span>
      </span>
    )
  }
  return (
    <span style={{ paddingLeft: pad + 18 }} className="text-zinc-300">
      {d.name}
    </span>
  )
}

// --- column sets -----------------------------------------------------------
const GROUPED_COLS = [
  { headerName: 'Group / Node', field: 'name', flex: 2, minWidth: 240, cellRenderer: NameCell, sortable: false },
  { headerName: 'Type', field: 'type', minWidth: 90, sortable: false },
  { headerName: 'Avg/LMP', field: 'lmp', type: 'rightAligned', valueFormatter: num, sortable: false, minWidth: 90 },
  { headerName: 'Congestion', field: 'congestion', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, sortable: false, minWidth: 105 },
  { headerName: 'Max |Cong|', field: 'maxCong', type: 'rightAligned', valueFormatter: num, sortable: false, minWidth: 95 },
  { headerName: 'Loss', field: 'loss', type: 'rightAligned', valueFormatter: num, sortable: false, minWidth: 70 },
  { headerName: 'Basis', field: 'basis', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, sortable: false, minWidth: 80 },
  { headerName: 'Cong %', field: 'congestionPct', type: 'rightAligned', valueFormatter: pct, sortable: false, minWidth: 80 },
]

const FLAT_COLS = [
  { headerName: 'Node', field: 'nodeName', flex: 2, minWidth: 200, filter: 'agTextColumnFilter' },
  { headerName: 'Zone', field: 'zone', minWidth: 110, filter: 'agTextColumnFilter' },
  { headerName: 'Type', field: 'locationType', minWidth: 100, filter: 'agTextColumnFilter' },
  { headerName: 'LMP', field: 'lmp', type: 'rightAligned', valueFormatter: num, minWidth: 90 },
  { headerName: 'Energy', field: 'energy', type: 'rightAligned', valueFormatter: num, minWidth: 90 },
  { headerName: 'Congestion', field: 'congestion', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, sort: 'desc', minWidth: 110 },
  { headerName: 'Loss', field: 'loss', type: 'rightAligned', valueFormatter: num, minWidth: 80 },
  { headerName: 'Basis (vs ONZP)', field: 'basis', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, minWidth: 120 },
  { headerName: 'Cong %', field: 'congestionPct', type: 'rightAligned', valueFormatter: pct, minWidth: 90 },
]

const GRID_THEME_VARS = {
  '--ag-background-color': '#18181b',
  '--ag-header-background-color': '#27272a',
  '--ag-odd-row-background-color': '#1b1b1e',
  '--ag-row-hover-color': '#27272a',
  '--ag-border-color': '#3f3f46',
  '--ag-foreground-color': '#e4e4e7',
  '--ag-header-foreground-color': '#a1a1aa',
  '--ag-font-size': '12px',
}

const MODES = [
  { id: 'zone', label: 'Zone ▸ Type ▸ Node' },
  { id: 'type', label: 'Type ▸ Node' },
  { id: 'flat', label: 'Flat' },
]

export default function NodalTab() {
  const [state, setState] = useState({ rows: [], onzp: null, asOf: null, isLive: false, loading: true })
  const [mode, setMode] = useState('zone')
  const [expanded, setExpanded] = useState(new Set())

  const load = async () => {
    setState((s) => ({ ...s, loading: true }))
    const data = await fetchNodal()
    setState({ ...data, loading: false })
  }
  useEffect(() => {
    load()
  }, [])

  const levels = mode === 'zone' ? ['zone', 'locationType'] : ['locationType']
  const tree = useMemo(
    () => (mode === 'flat' ? null : buildTree(state.rows, levels)),
    [state.rows, mode],
  )
  const displayRows = useMemo(
    () => (mode === 'flat' ? state.rows : flatten(tree, expanded)),
    [mode, tree, expanded, state.rows],
  )

  const onRowClicked = useCallback((e) => {
    const d = e.data
    if (d?.__kind !== 'group') return
    setExpanded((prev) => {
      const s = new Set(prev)
      s.has(d.__key) ? s.delete(d.__key) : s.add(d.__key)
      return s
    })
  }, [])

  const expandAll = () => setExpanded(new Set(collectKeys(tree)))
  const collapseAll = () => setExpanded(new Set())

  const asOfText = state.asOf
    ? new Date(state.asOf).toLocaleTimeString('en-CA', { hour12: false })
    : '—'
  const grouped = mode !== 'flat'

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
            Price (ONZP{state.onzp != null ? ` $${state.onzp.toFixed(2)}` : ''}) ·
            zone = IESO virtual trading zone (transmission buses show “Unmapped”)
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

      {/* View controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-700">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 text-xs font-medium ${
                mode === m.id ? 'bg-sky-500/20 text-sky-300' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {grouped && (
          <>
            <button onClick={expandAll} className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700">
              Expand all
            </button>
            <button onClick={collapseAll} className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700">
              Collapse all
            </button>
          </>
        )}
      </div>

      {/* Grid — AG Grid needs a *definite* height. flex-1/min-height is
          indefinite on mobile Safari and collapses the grid to zero rows, so
          use a viewport height (vh is definite) with a px floor. */}
      <div
        className="ag-theme-quartz-dark h-[70vh] min-h-[420px] overflow-hidden rounded-xl border border-zinc-800"
        style={GRID_THEME_VARS}
      >
        <AgGridReact
          key={mode}
          rowData={displayRows}
          columnDefs={grouped ? GROUPED_COLS : FLAT_COLS}
          defaultColDef={{ sortable: !grouped, filter: !grouped, resizable: true, minWidth: 80 }}
          onRowClicked={grouped ? onRowClicked : undefined}
          getRowStyle={
            grouped
              ? (p) =>
                  p.data?.__kind === 'group'
                    ? { background: '#1f1f23', fontWeight: 600, cursor: 'pointer' }
                    : undefined
              : undefined
          }
          animateRows={false}
          enableCellTextSelection
          suppressDragLeaveHidesColumns
        />
      </div>
    </div>
  )
}
