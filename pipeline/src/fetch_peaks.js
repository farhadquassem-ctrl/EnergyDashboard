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
// Output: pipeline/data/peaks.json = { top5:[key], top10:[key], peaks:[...] }

import { writeFileSync, mkdirSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { URLS, FILES, DATA_DIR, PEAK_YEARS } from './config.js'
import { fetchText } from './lib/http.js'
import { iciPeakToDateTime, utcHourKey } from './lib/time.js'
import { isMain } from './lib/is-main.js'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: true, trimValues: true })
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

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

  for (const year of PEAK_YEARS) {
    const url = URLS.peaksYear(year)
    console.log(`fetch_peaks: ${url}`)
    let datapoints
    try {
      datapoints = extractDatapoints(parser.parse(await fetchText(url)))
    } catch (e) {
      console.warn(`  skipped ${url}: ${e.message}`)
      continue
    }
    // Rank within this base period; Final only (past periods are all Final,
    // the in-progress period contributes just its settled peaks).
    const ranked = datapoints
      .filter((p) => /final/i.test(p.status))
      .sort((a, b) => b.value - a.value)

    ranked.slice(0, 10).forEach((p, i) => {
      const key = utcHourKey(iciPeakToDateTime(p.date, p.hour))
      top10.add(key)
      if (i < 5) {
        top5.add(key)
        summary.push({ baseYear: year, rank: i + 1, ...p })
      }
    })
    console.log(
      `  ${year}: ${datapoints.length} datapoints, ${ranked.length} Final -> ` +
        `top5=${Math.min(5, ranked.length)} top10=${Math.min(10, ranked.length)}`,
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
