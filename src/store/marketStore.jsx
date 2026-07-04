import { createContext, useContext, useMemo, useState } from 'react'
import { ZONES } from '../data/zones'

// Global market UI store (the contract's shared state): selected zone,
// selected date range, and the customer profile future tabs share (GA
// exposure simulator, DA/RT arbitrage $-value, storage optimizer). Context +
// useState matches the app's existing pattern (theme.jsx) — no new state
// library. Tabs read these instead of duplicating local state for the same
// concept; a consequence is that zone selection now survives tab switches
// (it used to reset when the Overview tab unmounted).

const MarketStoreContext = createContext(null)

export function MarketStoreProvider({ children }) {
  const [selectedZoneId, setSelectedZoneId] = useState(ZONES[0].id)
  // Preset string or { start, end } ISO dates — the query-key `dateRange`.
  // Today's tabs are all "latest"; the date-range picker lands with the first
  // range-based tab (Prompt 1).
  const [dateRange, setDateRange] = useState('latest')
  // Shared customer profile. `mw` = the user's controllable load, defaulting
  // to 1 MW per the arbitrage tab's spec; the GA exposure simulator (Prompt 3)
  // and storage optimizer (Prompt 2) extend this object rather than forking it.
  const [customerProfile, setCustomerProfile] = useState({ mw: 1 })

  const value = useMemo(
    () => ({
      selectedZoneId,
      setSelectedZoneId,
      dateRange,
      setDateRange,
      customerProfile,
      setCustomerProfile,
    }),
    [selectedZoneId, dateRange, customerProfile],
  )

  return <MarketStoreContext.Provider value={value}>{children}</MarketStoreContext.Provider>
}

export function useMarketStore() {
  const store = useContext(MarketStoreContext)
  if (!store) throw new Error('useMarketStore must be used inside <MarketStoreProvider>')
  return store
}
