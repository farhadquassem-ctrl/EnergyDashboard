import { useState } from 'react'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  ZoomControl,
} from 'react-leaflet'
import { ONTARIO_CENTER, ONTARIO_ZOOM } from '../data/zones'
import { lmpToColor } from '../utils/colorScale'
import ColorLegend from './ColorLegend'
import { useTheme } from '../theme.jsx'

// Marker colors while a zone has no price yet / selection stroke — Leaflet
// pathOptions take raw colors, so they follow the active theme at render time.
const MARKER = {
  dark: { neutral: '#3f3f46' /* zinc-700 */, stroke: '#ffffff' },
  light: { neutral: '#a1a1aa' /* zinc-400 */, stroke: '#18181b' },
}

// Touch screens have no real hover, and iOS treats the first tap on a
// hover-reactive element as hover-only (it fires the synthetic mouseover —
// tooltip + highlight — but can swallow the click, leaving the zone
// unselected). Confirmed on iPhone: tap showed the tooltip but the chart
// never switched. On coarse-pointer devices, treat that first tap's
// mouseover as selection intent too; desktop hover behavior is unchanged.
const NO_HOVER =
  typeof window !== 'undefined' && window.matchMedia?.('(hover: none)')?.matches

/**
 * Left column: Ontario map with one colour-coded marker per IESO pricing zone.
 * Marker fill encodes the current zonal price on the indigo→blue→amber→red scale.
 */
export default function MapPanel({ zones, selectedZoneId, onSelectZone }) {
  const [hoveredId, setHoveredId] = useState(null)
  const { theme } = useTheme()
  const marker = MARKER[theme] ?? MARKER.dark

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-panel">
      <MapContainer
        center={ONTARIO_CENTER}
        zoom={ONTARIO_ZOOM}
        scrollWheelZoom
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Top-left is occupied by the heading overlay, so move zoom to top-right. */}
        <ZoomControl position="topright" />

        {zones.map((zone) => {
          const isSelected = zone.id === selectedZoneId
          const isHovered = zone.id === hoveredId
          const hasPrice = zone.lmp != null
          const color = hasPrice ? lmpToColor(zone.lmp) : marker.neutral
          return (
            <CircleMarker
              key={zone.id}
              center={[zone.lat, zone.lng]}
              radius={isSelected ? 16 : isHovered ? 14 : 12}
              pathOptions={{
                color: isSelected || isHovered ? marker.stroke : color,
                weight: isSelected ? 3 : isHovered ? 2.5 : 1.5,
                fillColor: color,
                fillOpacity: isHovered ? 1 : 0.85,
              }}
              eventHandlers={{
                click: () => onSelectZone(zone.id),
                mouseover: () => {
                  setHoveredId(zone.id)
                  if (NO_HOVER) onSelectZone(zone.id)
                },
                mouseout: () => setHoveredId((id) => (id === zone.id ? null : id)),
              }}
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Ontario Pricing Zones
        </h2>
        <p className="text-xs text-zinc-500">
          Click a zone to load its real-time price series
        </p>
      </div>

      <ColorLegend />
    </div>
  )
}
