import { lazy, Suspense, useState } from 'react'
import OverviewTab from './components/OverviewTab'

// Lazy-load the Nodal tab so AG Grid (heavy) stays out of the main bundle and
// only loads when the user opens that tab.
const NodalTab = lazy(() => import('./components/NodalTab'))

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'nodal', label: 'Nodal' },
]

export default function App() {
  const [tab, setTab] = useState('overview')

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-zinc-200">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800 px-6 pt-4">
        <div className="pb-3">
          <h1 className="text-lg font-bold tracking-tight text-zinc-100">
            IESO LMP Dashboard
          </h1>
          <p className="text-xs text-zinc-500">
            Ontario electricity market — zonal prices, demand &amp; nodal LMP
          </p>
        </div>

        {/* Tab nav */}
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-sky-400 text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex flex-1 flex-col p-4 lg:p-6">
        {tab === 'overview' ? (
          <OverviewTab />
        ) : (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                Loading nodal grid…
              </div>
            }
          >
            <NodalTab />
          </Suspense>
        )}
      </main>

      <footer className="border-t border-zinc-800 px-6 py-3 text-center text-xs text-zinc-600">
        Portfolio project · Live data from the IESO public reports · Not affiliated with the IESO
      </footer>
    </div>
  )
}
