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
import { useTheme } from '../theme.jsx'
import { formatEasternTime } from '../utils/formatTime'

// --- shared cell helpers ---------------------------------------------------
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
// Cell styles are raw colors (not classes), so the diverging-color cells need
// a per-theme text color to stay readable over the tinted backgrounds.
const makeDivergingCellStyle = (isDark) => (p) => {
  if (p.value == null || p.value === '') return { color: '#71717a' }
  return {
    backgroundColor: hexToRgba(lmpToColor(p.value), 0.28),
    color: isDark ? '#e4e4e7' : '#18181b',
  }
}
const num = (p) => (p.value == null || p.value === '' ? '—' : Number(p.value).toFixed(2))
const pct = (p) => (p.value == null || p.value === '' ? '—' : `${Math.round(p.value)}%`)

// --- grouping (hand-rolled; AG Grid Community has no row grouping) ----------
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// All aggregates are over ONLY the group's own descendant leaf rows (buildTree
// passes each group's rows here), so values are per-group, never global.
function aggregate(rows) {
  const lmps = rows.map((r) => r.lmp).filter((n) => n != null)
  const congs = rows.map((r) => r.congestion).filter((n) => n != null)
  const losses = rows.map((r) => r.loss).filter((n) => n != null)
  const bases = rows.map((r) => r.basis).filter((n) => n != null)
  return {
    count: rows.length,
    avgLmp: avg(lmps),
    avgCong: avg(congs),
    maxCong: congs.length ? Math.max(...congs.map(Math.abs)) : null,
    avgLoss: avg(losses),
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
      loss: g.aggr.avgLoss,
      type: '',
      congestionPct: '',
    })
    if (isExpanded) {
      if (g.children) flatten(g.children, expanded, depth + 1, out)
      else for (const lf of g.leaves) out.push({ __kind: 'leaf', __depth: depth + 1, ...lf })
    }
  }
  return out
}

// Group/Node column value: group label for group rows, node name for leaves.
const nameValueGetter = (p) =>
  p.data?.__kind === 'group' ? p.data.name : p.data?.nodeName

// First column: indented caret + group label (with count) or node name.
function NameCell(p) {
  const d = p.data || {}
  const pad = (d.__depth || 0) * 14
  if (d.__kind === 'group') {
    return (
      <span style={{ paddingLeft: pad }} className="font-semibold text-zinc-900 dark:text-zinc-100">
        <span className="inline-block w-4 text-zinc-500 dark:text-zinc-400">{d.__expanded ? '▾' : '▸'}</span>
        {p.value} <span className="font-normal text-zinc-500">({d.count})</span>
      </span>
    )
  }
  return (
    <span style={{ paddingLeft: pad + 18 }} className="text-zinc-700 dark:text-zinc-300">
      {p.value}
    </span>
  )
}

// --- column sets -----------------------------------------------------------
// flex on every column so the grid fills the desktop width (no horizontal
// scroll); minWidth acts as a floor so mobile scrolls instead of crushing.
const makeGroupedCols = (divergingCellStyle) => [
  { headerName: 'Group / Node', valueGetter: nameValueGetter, cellRenderer: NameCell, flex: 2.4, minWidth: 190, sortable: false },
  { headerName: 'Type', field: 'type', flex: 0.9, minWidth: 78, sortable: false },
  { headerName: 'LMP', field: 'lmp', type: 'rightAligned', valueFormatter: num, flex: 1, minWidth: 76, sortable: false },
  { headerName: 'Congestion', field: 'congestion', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, flex: 1.1, minWidth: 92, sortable: false },
  { headerName: 'Max |Cong|', field: 'maxCong', type: 'rightAligned', valueFormatter: num, flex: 1, minWidth: 84, sortable: false },
  { headerName: 'Loss', field: 'loss', type: 'rightAligned', valueFormatter: num, flex: 0.8, minWidth: 66, sortable: false },
  { headerName: 'Basis', field: 'basis', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, flex: 1.1, minWidth: 84, sortable: false },
]

const makeFlatCols = (divergingCellStyle) => [
  { headerName: 'Node', field: 'nodeName', flex: 2.2, minWidth: 190, filter: 'agTextColumnFilter' },
  { headerName: 'Zone', field: 'zone', flex: 1, minWidth: 96, filter: 'agTextColumnFilter' },
  { headerName: 'Type', field: 'locationType', flex: 1, minWidth: 90, filter: 'agTextColumnFilter' },
  { headerName: 'LMP', field: 'lmp', type: 'rightAligned', valueFormatter: num, flex: 0.9, minWidth: 76 },
  { headerName: 'Energy', field: 'energy', type: 'rightAligned', valueFormatter: num, flex: 0.9, minWidth: 76 },
  { headerName: 'Congestion', field: 'congestion', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, sort: 'desc', flex: 1.1, minWidth: 92 },
  { headerName: 'Loss', field: 'loss', type: 'rightAligned', valueFormatter: num, flex: 0.8, minWidth: 66 },
  { headerName: 'Basis', field: 'basis', type: 'rightAligned', valueFormatter: num, cellStyle: divergingCellStyle, flex: 1.1, minWidth: 84 },
  { headerName: 'Cong %', field: 'congestionPct', type: 'rightAligned', valueFormatter: pct, flex: 0.9, minWidth: 76 },
]

// Per-theme AG Grid CSS variables + the matching packaged theme class.
// The quartz dark/light variants ship in the same ag-theme-quartz.css import.
const GRID_THEMES = {
  dark: {
    themeClass: 'ag-theme-quartz-dark',
    groupRowBg: '#1f1f23',
    vars: {
      '--ag-background-color': '#18181b',
      '--ag-header-background-color': '#27272a',
      '--ag-odd-row-background-color': '#1b1b1e',
      '--ag-row-hover-color': '#27272a',
      '--ag-border-color': '#3f3f46',
      '--ag-foreground-color': '#e4e4e7',
      '--ag-header-foreground-color': '#a1a1aa',
      '--ag-font-size': '12px',
    },
  },
  light: {
    themeClass: 'ag-theme-quartz',
    groupRowBg: '#ececee',
    vars: {
      '--ag-background-color': '#ffffff',
      '--ag-header-background-color': '#f4f4f5',
      '--ag-odd-row-background-color': '#fafafa',
      '--ag-row-hover-color': '#f4f4f5',
      '--ag-border-color': '#d4d4d8',
      '--ag-foreground-color': '#27272a',
      '--ag-header-foreground-color': '#52525b',
      '--ag-font-size': '12px',
    },
  },
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
  const { theme } = useTheme()
  const gridTheme = GRID_THEMES[theme] ?? GRID_THEMES.dark
  const { groupedCols, flatCols } = useMemo(() => {
    const divergingCellStyle = makeDivergingCellStyle(theme === 'dark')
    return { groupedCols: makeGroupedCols(divergingCellStyle), flatCols: makeFlatCols(divergingCellStyle) }
  }, [theme])

  // bustCache only on the explicit Refresh click: the API's edge cache
  // (s-maxage=300 + SWR 600) can otherwise re-serve a response up to ~15 min
  // old, which made the button look like it did nothing.
  const load = async ({ bustCache = false } = {}) => {
    setState((s) => ({ ...s, loading: true }))
    const data = await fetchNodal({ bustCache })
    setState({ ...data, loading: false })
  }
  useEffect(() => {
    load()
    // Same auto-refresh cadence as the Overview tab (IESO publishes ~5-min);
    // without this the tab showed whatever was live at mount, forever.
    const id = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(id)
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

  const asOfText = formatEasternTime(state.asOf, { seconds: true }) ?? '—'
  const grouped = mode !== 'flat'

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
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
            onClick={() => load({ bustCache: true })}
            disabled={state.loading}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {state.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* View controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 text-xs font-medium ${
                mode === m.id
                  ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                  : 'bg-white text-zinc-500 hover:text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {grouped && (
          <>
            <button onClick={expandAll} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
              Expand all
            </button>
            <button onClick={collapseAll} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
              Collapse all
            </button>
          </>
        )}
      </div>

      {/* Grid — AG Grid needs a *definite* height. flex-1/min-height is
          indefinite on mobile Safari and collapses the grid to zero rows, so
          use a viewport height (vh is definite) with a px floor. */}
      <div
        className={`${gridTheme.themeClass} h-[70vh] min-h-[420px] overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-800`}
        style={gridTheme.vars}
      >
        <AgGridReact
          key={`${mode}-${theme}`}
          rowData={displayRows}
          columnDefs={grouped ? groupedCols : flatCols}
          defaultColDef={{ sortable: !grouped, filter: !grouped, resizable: true, minWidth: 80 }}
          onRowClicked={grouped ? onRowClicked : undefined}
          getRowStyle={
            grouped
              ? (p) =>
                  p.data?.__kind === 'group'
                    ? { background: gridTheme.groupRowBg, fontWeight: 600, cursor: 'pointer' }
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
