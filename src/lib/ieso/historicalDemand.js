// Adapter stub: historical demand + official 5CP determination.
//
// Two things live here when built:
//  - historical Ontario demand over a date range → `DemandInterval[]`
//  - the official ICI 5CP peak determination for a base period (the IESO
//    Peak Tracker files)
//
// ⚠ Both are already implemented — offline — in the standalone pipeline
// (pipeline/src/*, blocked-network fetches run on the user's machine / GitHub
// runner, results exported to static JSON). If a tab needs this data at
// runtime, prefer exporting more static JSON from the pipeline over teaching
// the serverless proxy to re-fetch multi-year archives.
//
// HARD RULE (from the pipeline's hard-won lesson): never derive 5CP peaks by
// re-ranking raw demand — always consume IESO's official ICI Peak Tracker
// ranking. See CLAUDE.md §Pipeline.

export async function fetchHistoricalDemand(/* { dateRange } */) {
  throw new Error(
    'lib/ieso/historicalDemand: not implemented — prefer a pipeline static-JSON export (see file header)',
  )
}

export async function fetch5CPDetermination(/* { baseYear } */) {
  throw new Error(
    'lib/ieso/historicalDemand: not implemented — official ICI Peak Tracker ranks only; never re-rank raw demand',
  )
}
