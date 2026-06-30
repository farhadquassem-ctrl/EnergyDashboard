// Canonical IESO pricing-zone geography (shared by live + mock data paths).
//
// These are the geographic Ontario zones the dashboard plots. In the renewed
// market (May 2025) the IESO publishes an Ontario Zonal Price (OZP) per zone;
// `lmp` is filled in at runtime from live data, or from mock fallback values.

export const ZONES = [
  { id: 'northwest', name: 'Northwest', lat: 48.38, lng: -89.25 },
  { id: 'northeast', name: 'Northeast', lat: 46.49, lng: -80.99 },
  { id: 'ottawa', name: 'Ottawa', lat: 45.42, lng: -75.69 },
  { id: 'east', name: 'East', lat: 44.23, lng: -76.49 },
  { id: 'west', name: 'West', lat: 42.98, lng: -81.24 },
  { id: 'southwest', name: 'Southwest', lat: 42.31, lng: -83.04 },
  { id: 'toronto', name: 'Toronto', lat: 43.65, lng: -79.38 },
]

export const ZONE_IDS = ZONES.map((z) => z.id)

// Geographic centre + zoom used to frame the Leaflet map over Ontario.
export const ONTARIO_CENTER = [46.5, -82.0]
export const ONTARIO_ZOOM = 5
