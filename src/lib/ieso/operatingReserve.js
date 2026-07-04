// Adapter stub: Operating Reserve price/volume reports (OR_10S / OR_10N /
// OR_30 markets). No tab consumes OR data yet; this stub reserves the report
// family so future tabs don't hand-roll their own parsing path.
//
// Building this means adding an OR handler to api/ieso.js over the
// reports-public.ieso.ca OR market reports, then normalizing here.
//
// Contract: resolves `IntervalPrice[]` with market 'OR_10S' | 'OR_10N' | 'OR_30'.

export async function fetchOperatingReserve(/* { market, dateRange } */) {
  throw new Error(
    'lib/ieso/operatingReserve: not implemented — no consumer yet (stub per the shared architecture contract)',
  )
}
