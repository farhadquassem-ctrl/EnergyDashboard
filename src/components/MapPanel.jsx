import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet'
import { ONTARIO_CENTER, ONTARIO_ZOOM } from '../data/zones'
import { lmpToColor } from '../utils/colorScale'
import ColorLegend from './ColorLegend'

const NEUTRAL = '#3f3f46' // zinc-700, used while a zone has no price yet

/**
 * Left column: Ontario map with one colour-coded marker per IESO pricing zone.
 * Marker fill encodes the current zonal price on the blue -> amber -> red scale.
 */
export default function MapPanel({ zones, selectedZoneId, onSelectZone }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-800 bg-panel">
      <MapContainer
        center={ONTARIO_CENTER}
        zoom={ONTARIO_ZOOM}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {zones.map((zone) => {
          const isSelected = zone.id === selectedZoneId
          const hasPrice = zone.lmp != null
          const color = hasPrice ? lmpToColor(zone.lmp) : NEUTRAL
          return (
            <CircleMarker
              key={zone.id}
              center={[zone.lat, zone.lng]}
              radius={isSelected ? 16 : 12}
              pathOptions={{
                color: isSelected ? '#ffffff' : color,
                weight: isSelected ? 3 : 1.5,
                fillColor: color,
                fillOpacity: 0.85,
              }}
              eventHandlers={{ click: () => onSelectZone(zone.id) }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                <div className="text-xs">
                  <div className="font-semibold">{zone.name}</div>
                  <div>
                    {hasPrice
                      ? `Zonal price: $${zone.lmp.toFixed(1)}/MWh`
                      : 'Price unavailable'}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>

      <div className="pointer-events-none absolute left-4 top-4 z-[1000]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Ontario Pricing Zones
        </h2>
        <p className="text-xs text-zinc-500">
          Click a zone to load its 24h price series
        </p>
      </div>

      <ColorLegend />
    </div>
  )
}
