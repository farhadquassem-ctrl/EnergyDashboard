// Step 3: IESO ICI Peak Tracker -> official top-5 / top-10 peak labels.
//
// Ground truth comes from IESO's own finalized ranking, NOT from re-sorting the
// demand series ourselves. Each year file is ONE base period (May–Apr, labelled
// by start year) and lists that period's running top-10 Ontario-demand hours.
// We rank PER FILE (5CP is per base period), keep status=Final, and label the
// top 5 / top 10 of each. deliveryDate/deliveryHour are EST year-round.
//
// Real structure (confirmed against docs/Sample-Reports/PUB_ICIPeakTracker_*.xml):
//   Document > DocBody > xmldata > dataset[datapointName="TOP_ONTARIO_DEMAND"]
//     > datapoint > datetimeInfo > { deliveryDate, deliveryHour }
//                 > value, status
//
// Fallback: reports-public.ieso.ca has no per-year archive before 2025 (the
// "_2024" URL serves the in-progress 2025 tracker instead of a real 2024
// archive — confirmed by inspecting a real pull of that URL). For base years
// where the live file 404s or has zero Final entries, we fall back to
// fixtures/historical_peaks_top5.csv, a checked-in top-5 AQEW reference
// covering 2010-2011 onward. Its (date, hour) pairs were spot-checked against
// the live 2025 TOP_ONTARIO_DEMAND/Final ranking and match rank-for-rank.
// AQEW (Allocated Quantity of Energy Withdrawn) != raw Ontario demand — it's
// ON demand minus storage injection (batteries) minus embedded/behind-the-meter
// generation — but it identifies the same peak hours, so using its (date, hour)
// as the label is an apples-to-apples v1 choice; the two published values just
// aren't numerically comparable. It has no ranks 6-10, so for any base year
// sourced from it, is_top10_peak == is_top5_peak (not independently known).
//
// Output: pipeline/data/peaks.json = { top5:[key], top10:[key], peaks:[...] }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { URLS, FILES, DATA_DIR, PEAK_YEARS, HISTORICAL_TOP5_FILE } from './config.js'
import { fetchText } from './lib/http.js'
import { iciPeakToDateTime, utcHourKey } from './lib/time.js'
import { isMain } from './lib/is-main.js'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: true, trimValues: true })
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

// fixtures/historical_peaks_top5.csv -> Map<baseYear, [{rank,date,hour,value}]>,
// keyed by the base period's START year (its "Base Year" column is "2024-2025"
// etc.; we key on the leading year to match PEAK_YEARS).
function loadHistoricalTop5() {
  const lines = readFileSync(HISTORICAL_TOP5_FILE, 'utf8').trim().split('\n').slice(1)
  const byYear = new Map()
  for (const line of lines) {
    const [baseYear, rank, date, hour, value] = line.split(',')
    const year = Number(baseYear.split('-')[0])
    const rows = byYear.get(year) ?? []
    rows.push({ rank: Number(rank), date, hour: Number(hour), value: Number(value) })
    byYear.set(year, rows)
  }
  return byYear
}

// Pull the TOP_ONTARIO_DEMAND datapoints out of one parsed file.
export function extractDatapoints(tree) {
  const datasets = toArray(tree?.Document?.DocBody?.xmldata?.dataset)
  const ds =
    datasets.find((d) => String(d?.datapointName ?? '').toUpperCase().includes('TOP_ONTARIO_DEMAND')) ??
    datasets[0]
  return toArray(ds?.datapoint)
    .map((dp) => ({
      date: String(dp?.datetimeInfo?.deliveryDate ?? '').trim(),
      hour: Number(dp?.datetimeInfo?.deliveryHour),
      value: Number(dp?.value),
      status: String(dp?.status ?? '').trim(),
    }))
    .filter((p) => p.date && Number.isFinite(p.hour) && Number.isFinite(p.value))
}

export async function fetchPeaks() {
  const top5 = new Set()
  const top10 = new Set()
  const summary = []
  const historical = loadHistoricalTop5()

  for (const year of PEAK_YEARS) {
    const url = URLS.peaksYear(year)
    console.log(`fetch_peaks: ${url}`)
    let ranked = []
    let datapointCount = 0
    try {
      const datapoints = extractDatapoints(parser.parse(await fetchText(url)))
      datapointCount = datapoints.length
      // Rank within this base period; Final only (past periods are all Final,
      // the in-progress period contributes just its settled peaks).
      ranked = datapoints.filter((p) => /final/i.test(p.status)).sort((a, b) => b.value - a.value)
    } catch (e) {
      console.warn(`  ${url}: ${e.message}`)
    }

    if (ranked.length > 0) {
      ranked.slice(0, 10).forEach((p, i) => {
        const key = utcHourKey(iciPeakToDateTime(p.date, p.hour))
        top10.add(key)
        if (i < 5) {
          top5.add(key)
          summary.push({ baseYear: year, rank: i + 1, source: 'live', ...p })
        }
      })
      console.log(
        `  ${year}: ${datapointCount} datapoints, ${ranked.length} Final -> ` +
          `top5=${Math.min(5, ranked.length)} top10=${Math.min(10, ranked.length)}`,
      )
      continue
    }

    // No live Final entries (missing archive, or a pre-2025 year IESO doesn't
    // serve at this URL) — fall back to the checked-in top-5 reference. Only
    // ranks 1-5 are known, so top10 gets the same keys as top5 here.
    const fallbackRows = historical.get(year) ?? []
    if (fallbackRows.length === 0) {
      console.warn(`  ${year}: no live Final entries and no historical fallback — skipped.`)
      continue
    }
    fallbackRows.forEach((p) => {
      const key = utcHourKey(iciPeakToDateTime(p.date, p.hour))
      top5.add(key)
      top10.add(key)
      summary.push({ baseYear: year, source: 'fallback-top5', ...p, status: 'Final(AQEW)' })
    })
    console.log(
      `  ${year}: 0 live Final entries -> using historical fallback: ` +
        `top5=${fallbackRows.length} top10=${fallbackRows.length} (top10 unknown beyond rank 5)`,
    )
  }

  const payload = { top5: [...top5], top10: [...top10], peaks: summary }
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.peaks, JSON.stringify(payload))
  console.log(`fetch_peaks: labelled ${top5.size} top-5 / ${top10.size} top-10 hours -> ${FILES.peaks}`)
  if (top10.size === 0) console.warn('  WARNING: no Final peaks found — check the file years / base period.')
  return payload
}

if (isMain(import.meta.url)) {
  fetchPeaks().catch((e) => {
    console.error('fetch_peaks failed:', e.message)
    console.error('NOTE: reports-public.ieso.ca is blocked from the Claude sandbox; run this locally.')
    process.exit(1)
  })
}
