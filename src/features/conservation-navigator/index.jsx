import { useMemo, useState } from 'react'
import TabShell, { TabError, TabLoading } from '../../components/TabShell'
import { usePrograms, useResidentialRates } from './hooks'
import { filterPrograms, groupByCategory, freshness } from './calculations'
import ProgramCard from './components/ProgramCard'
import RateComparator from './components/RateComparator'

// Conservation & Billing Navigator (Class B / residential). A curated,
// use-case-organized guide to Ontario conservation + billing programs, plus an
// interactive rate-plan comparator. Pure renderer of two static, weekly-
// refreshed files (public/programs/*); all logic is in calculations.js.

const AUDIENCE_TABS = [
  ['all', 'All'],
  ['residential', 'Residential'],
  ['commercial', 'Business'],
]

const CATEGORY_LABEL = {
  billing: 'Billing & rate plans',
  rebate: 'Rebates & upgrades',
  'demand-response': 'Demand response',
  tracking: 'Tracking & data',
}
const CATEGORY_ORDER = ['billing', 'rebate', 'demand-response', 'tracking']

export default function ConservationNavigatorTab({ onNavigateTab }) {
  const programsQ = usePrograms()
  const ratesQ = useResidentialRates()
  const [audience, setAudience] = useState('all')
  const [query, setQuery] = useState('')

  if (programsQ.loading || ratesQ.loading) return <TabLoading>Loading programs…</TabLoading>
  if (!programsQ.data) return <TabError>{programsQ.error ?? 'Program catalog unavailable.'}</TabError>

  const catalog = programsQ.data
  const rates = ratesQ.data

  const handleAction = (p) => {
    const a = p.action
    if (!a) return
    if (a.type === 'external') window.open(a.target, '_blank', 'noopener,noreferrer')
    else if (a.type === 'tab' && onNavigateTab) onNavigateTab(a.target)
    else if (a.type === 'internal' && a.target === 'rate-comparator') {
      document.getElementById('rate-comparator')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <ConservationBody
      catalog={catalog}
      rates={rates}
      ratesError={ratesQ.error}
      audience={audience}
      setAudience={setAudience}
      query={query}
      setQuery={setQuery}
      onAction={handleAction}
    />
  )
}

function ConservationBody({ catalog, rates, ratesError, audience, setAudience, query, setQuery, onAction }) {
  const fresh = useMemo(() => freshness(catalog.asOf), [catalog.asOf])
  const filtered = useMemo(() => filterPrograms(catalog.programs, { audience, query }), [catalog.programs, audience, query])
  const grouped = useMemo(() => groupByCategory(filtered), [filtered])

  const btn = (active) =>
    `px-3 py-1.5 text-xs font-medium ${active
      ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
      : 'bg-white text-zinc-500 hover:text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`

  return (
    <TabShell
      className="mx-auto w-full max-w-5xl"
      title={
        <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Conservation &amp; Billing Navigator
          <span className="ml-2 align-middle text-xs font-medium text-zinc-500">rebates · rate plans · demand response</span>
        </h2>
      }
      subtitle="Ontario conservation and billing programs, curated by what you're trying to do."
      actions={
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            fresh.stale ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          }`}
          title="The catalog is refreshed weekly from OEB / IESO / Save on Energy sources."
        >
          <span className={`h-1.5 w-1.5 rounded-full ${fresh.stale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          updated {fresh.label}
        </span>
      }
    >
      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {AUDIENCE_TABS.map(([id, label]) => (
            <button key={id} onClick={() => setAudience(id)} className={btn(audience === id)}>{label}</button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search programs (EV, heat pump, thermostat…)"
          className="w-full max-w-xs rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
        />
      </div>

      {ratesError && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Rate reference unavailable — the comparator is hidden. {ratesError}
        </div>
      )}

      {/* the rate comparator sits up top for the billing/rate-plan use case */}
      {rates && audience !== 'commercial' && <RateComparator rates={rates} />}

      {/* grouped program catalog */}
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-panel">
          No programs match. Try a different audience or search term.
        </p>
      ) : (
        CATEGORY_ORDER.filter((c) => grouped.has(c)).map((cat) => (
          <section key={cat} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{CATEGORY_LABEL[cat] ?? cat}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.get(cat).map((p) => <ProgramCard key={p.id} program={p} onAction={onAction} />)}
            </div>
          </section>
        ))
      )}

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Curated from OEB, IESO Save on Energy, and Enbridge Gas program pages — organized by use case, not mirrored
        verbatim. Details marked “verify at source” are 2026 reference points and can change; always confirm eligibility
        and amounts on the official page before acting. Refreshed weekly. Not affiliated with the IESO, OEB, or any utility.
      </p>
    </TabShell>
  )
}
