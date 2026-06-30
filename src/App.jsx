import { useState } from 'react'
import MapPanel from './components/MapPanel'
import PriceChart from './components/PriceChart'
import GAPeakRisk from './components/GAPeakRisk'
import BottomBar from './components/BottomBar'
import StatusBadge from './components/StatusBadge'
import { ZONES } from './data/zones'
import { MOCK_SNAPSHOT } from './data/mockData'
import { useSnapshot, useZoneSeries } from './data/useIesoData'

export default function App() {
  const [selectedZoneId, setSelectedZoneId] = useState(ZONES[0].id)
  const selectedZone = ZONES.find((z) => z.id === selectedZoneId) ?? ZONES[0]

  const { zones, snapshot, asOf, isLive, loading } = useSnapshot()
  const series = useZoneSeries(selectedZoneId)

  // Until the first snapshot resolves, render the zone geography with no price.
  const mapZones = zones.length ? zones : ZONES.map((z) => ({ ...z, lmp: null }))
  const activeSnapshot = snapshot ?? MOCK_SNAPSHOT

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-zinc-200">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100">
            IESO LMP Dashboard
          </h1>
          <p className="text-xs text-zinc-500">
            Ontario electricity market — zonal prices, demand &amp; system status
          </p>
        </div>
        <StatusBadge isLive={isLive} loading={loading} asOf={asOf} />
      </header>

      {/* Main grid: map (60%) + chart/risk (40%) */}
      <main className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-5">
          {/* Left column — 60% */}
          <section className="min-h-[420px] lg:col-span-3">
            <MapPanel
              zones={mapZones}
              selectedZoneId={selectedZoneId}
              onSelectZone={setSelectedZoneId}
            />
          </section>

          {/* Right column — 40% */}
          <section className="flex min-h-[420px] flex-col gap-4 lg:col-span-2">
            <div className="min-h-0 flex-1">
              <PriceChart
                zoneName={selectedZone.name}
                data={series.series}
                loading={series.loading}
                isLive={series.isLive}
              />
            </div>
            <GAPeakRisk demandMW={activeSnapshot.demandMW} />
          </section>
        </div>

        {/* Bottom bar */}
        <BottomBar snapshot={activeSnapshot} />
      </main>

      <footer className="border-t border-zinc-800 px-6 py-3 text-center text-xs text-zinc-600">
        Portfolio project · Live data from the IESO public reports · Not affiliated with the IESO
      </footer>
    </div>
  )
}
