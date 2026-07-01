// Step 3: IESO ICI Peak Tracker -> official top-5 / top-10 peak labels.
//
// Ground truth comes from IESO's own finalized ranking, NOT from re-sorting the
// demand series ourselves (avoids denominator / revision / off-by-one mismatches).
// We take status=Final rows only, rank by value desc, and label the top 5 and 10.
// deliveryDate/deliveryHour are EST year-round (hour-ending) per the base period.
//
// Output: pipeline/data/peaks.json = { top5:[key], top10:[key], peaks:[...] }

import { writeFileSync, mkdirSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { URLS, FILES, DATA_DIR, PEAK_YEARS } from './config.js'
import { fetchText } from './lib/http.js'
import { iciPeakToDateTime, utcHourKey } from './lib/time.js'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: true, trimValues: true })

// Walk the parsed tree and collect any object carrying the four peak fields.
// Kept tolerant because the exact nesting isn't verifiable from the sandbox.
function collectPeakRows(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectPeakRows(n, out))
  } else if (node && typeof node === 'object') {
    const date = node.deliveryDate ?? node.DeliveryDate ?? node.DELIVERY_DATE
    const hour = node.deliveryHour ?? node.DeliveryHour ?? node.DELIVERY_HOUR
    const value = node.value ?? node.Value ?? node.VALUE
    if (date != null && hour != null && value != null) {
      out.push({
        date: String(date),
        hour: Number(hour),
        value: Number(value),
        status: String(node.status ?? node.Status ?? node.STATUS ?? '').trim(),
      })
    }
    for (const k of Object.keys(node)) collectPeakRows(node[k], out)
  }
  return out
}

export async function fetchPeaks() {
  const all = []
  for (const year of PEAK_YEARS) {
    const url = URLS.peaksYear(year)
    console.log(`fetch_peaks: ${url}`)
    const tree = parser.parse(await fetchText(url))
    all.push(...collectPeakRows(tree))
  }

  // Final rows only; if a (date,hour) appears more than once keep the max value.
  const finalByHour = new Map()
  for (const p of all) {
    if (!/final/i.test(p.status)) continue
    const key = `${p.date}|${p.hour}`
    const prev = finalByHour.get(key)
    if (!prev || p.value > prev.value) finalByHour.set(key, p)
  }

  const ranked = [...finalByHour.values()].sort((a, b) => b.value - a.value)
  const toKey = (p) => utcHourKey(iciPeakToDateTime(p.date, p.hour))
  const top5 = ranked.slice(0, 5).map(toKey)
  const top10 = ranked.slice(0, 10).map(toKey)

  const payload = { top5, top10, peaks: ranked.slice(0, 10) }
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.peaks, JSON.stringify(payload))
  console.log(`fetch_peaks: ${ranked.length} Final hours; labelled top5/top10 -> ${FILES.peaks}`)
  if (ranked.length === 0) console.warn('  WARNING: no status=Final rows found — check the base period / file year.')
  return payload
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchPeaks().catch((e) => {
    console.error('fetch_peaks failed:', e.message)
    console.error('NOTE: reports-public.ieso.ca is blocked from the Claude sandbox; run this locally.')
    process.exit(1)
  })
}
