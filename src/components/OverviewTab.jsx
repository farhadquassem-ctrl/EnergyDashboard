import { useState } from 'react'
import MapPanel from './MapPanel'
import PriceChart from './PriceChart'
import GAPeakRisk from './GAPeakRisk'
import BottomBar from './BottomBar'
import StatusBadge from './StatusBadge'
import { ZONES } from '../data/zones'
import { MOCK_SNAPSHOT } from '../data/mockData'
import { useSnapshot, useZoneSeries } from '../data/useIesoData'

/**
 * Overview tab: the spatial zonal view (map + price chart + system tiles).
 * Owns the snapshot/series hooks so they only run while this tab is mounted.
 */
export default function OverviewTab() {
  const [selectedZoneId, setSelectedZoneId] = useState(ZONES[0].id)
  const selectedZone = ZONES.find((z) => z.id === selectedZoneId) ?? ZONES[0]

  const { zones, snapshot, asOf, isLive, loading } = useSnapshot()
  const series = useZoneSeries(selectedZoneId)

  const mapZones = zones.length ? zones : ZONES.map((z) => ({ ...z, lmp: null }))
  const activeSnapshot = snapshot ?? MOCK_SNAPSHOT

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex justify-end">
        <StatusBadge isLive={isLive} loading={loading} asOf={asOf} />
      </div>

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

      <BottomBar snapshot={activeSnapshot} />
    </div>
  )
}
