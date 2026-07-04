import { lazy, Suspense, useState } from 'react'
import OverviewTab from './components/OverviewTab'
import { TabLoading } from './components/TabShell'
import { useTheme } from './theme.jsx'

// Lazy-load the heavier tabs so their deps (AG Grid; the forecast JSON) stay
// out of the main bundle and only load when the user opens that tab.
const NodalTab = lazy(() => import('./components/NodalTab'))
const PeakForecastTab = lazy(() => import('./features/peak-forecast/index.jsx'))

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'nodal', label: 'Nodal' },
  { id: 'forecast', label: 'Peak Forecast' },
]

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      onClick={toggleTheme}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded-md border border-zinc-300 bg-white p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
    >
      {dark ? (
        // sun — offer light
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // moon — offer dark
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  )
}

export default function App() {
  const [tab, setTab] = useState('overview')

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-800 dark:bg-canvas dark:text-zinc-200">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-300 px-6 pt-4 dark:border-zinc-800">
        <div className="pb-3">
          <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            IESO LMP Dashboard
          </h1>
          <p className="text-xs text-zinc-500">
            Ontario electricity market — zonal prices, demand &amp; nodal LMP
          </p>
        </div>

        <div className="flex items-end gap-3">
          {/* Tab nav */}
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'border-sky-500 text-zinc-900 dark:border-sky-400 dark:text-zinc-100'
                    : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="pb-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col p-4 lg:p-6">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'nodal' && (
          <Suspense fallback={<TabLoading>Loading nodal grid…</TabLoading>}>
            <NodalTab />
          </Suspense>
        )}
        {tab === 'forecast' && (
          <Suspense fallback={<TabLoading>Loading forecast…</TabLoading>}>
            <PeakForecastTab />
          </Suspense>
        )}
      </main>

      <footer className="border-t border-zinc-300 px-6 py-3 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-600">
        Portfolio project · Live data from the IESO public reports · Not affiliated with the IESO
      </footer>
    </div>
  )
}
