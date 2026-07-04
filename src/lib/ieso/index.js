// Data access layer — one adapter per IESO public report family.
// All fetch/parse/normalize logic for market data lives under lib/ieso/;
// components and feature tabs import from here and never parse payloads
// themselves. Adapters resolve renderable data (live or mock fallback) and
// expose normalizers to the shared types in types/market.js.

export { fetchSnapshot, snapshotToDemandInterval, snapshotToIntervalPrices } from './snapshot'
export { fetchZoneSeries, zoneSeriesToIntervalPrices } from './zonalSeries'
export { fetchNodal, nodalToIntervalPrices, generateMockNodal } from './nodal'
export { fetchPeakForecast, forecastToGAForecasts } from './peakForecast'
// Stubs (reserved report families — throw until built):
export { fetchDayAheadPrices } from './dayAhead'
export { fetchOperatingReserve } from './operatingReserve'
export { fetchHistoricalDemand, fetch5CPDetermination } from './historicalDemand'
