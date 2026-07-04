// Adapter stub: Day-Ahead Market hourly prices (post-MRP) as a standalone
// report family.
//
// NOTE: the province-wide DA hourly price is already flowing today — it rides
// inside the `series` report (see zonalSeries.js, `dayAhead` per point) where
// api/ieso.js merges the DA hourly report onto the RT 5-min archive. What does
// NOT exist yet is a standalone DA fetch over an arbitrary date range and by
// zone, which is what the DA/RT arbitrage tab (Prompt 1) needs. Building this
// means extending api/ieso.js with a `?report=da&start=&end=` handler over the
// IESO Day-Ahead hourly zonal price reports on reports-public.ieso.ca, then
// normalizing here.
//
// Contract: resolves `IntervalPrice[]` with market 'DA', hourly.

export async function fetchDayAheadPrices(/* { zone, dateRange } */) {
  throw new Error(
    'lib/ieso/dayAhead: not implemented — standalone DA range fetch is Prompt 1 work (extend api/ieso.js first)',
  )
}
