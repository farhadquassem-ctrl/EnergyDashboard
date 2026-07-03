// Step F1: fetch ECCC's official public weather forecast for Toronto — the
// citypage XML on the MSC Datamart — and reduce it to per-day high/low temps.
// This is the REAL forecast input for the live multi-horizon peak forecast
// (forecast.js); it reaches ~7 days out, so it covers the 3- and 7-day leads.
// No public ECCC product reaches 14 days — that lead always falls back to the
// climatology surrogate (forecast_weather.js), labelled as such.
//
// ⚠ VERIFICATION STATUS: the URL layout and XML shape follow ECCC's published
// docs and schemas (dd.weather.gc.ca/today/citypage_weather/, siteList.xml,
// forecastFull.xsd), but dd.weather.gc.ca is blocked from the Claude sandbox
// (same as the other data hosts), so this fetcher has ONLY been tested against
// a synthetic fixture (fixtures/citypage_sample_SYNTHETIC.xml). The first run
// of `npm run fetch:forecast` on a real machine is the true verification —
// if the feed's actual shape differs, fix the parser against a real capture
// and replace the synthetic fixture with it.
//
// Layout: https://dd.weather.gc.ca/today/citypage_weather/{PROV}/{HH}/ where
// HH is the UTC hour the forecast was emitted; each dir holds files named
// {ISO}_MSC_CitypageWeather_{siteId}_en.xml. We scan back from the current
// UTC hour for the newest file for our site.
//
// Modes:
//   node src/fetch_forecast.js                 -> fetch + parse + write
//   node src/fetch_forecast.js --parse <file>  -> parse a local XML (offline check)
//
// Output: pipeline/data/forecast_citypage.json =
//   { fetchedAt, issuedAt, siteId, days: [{ date, highC, lowC }] }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { DateTime } from 'luxon'
import { URLS, FILES, DATA_DIR, CITYPAGE } from './config.js'
import { fetchText } from './lib/http.js'
import { isMain } from './lib/is-main.js'

const EASTERN = 'America/Toronto'
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// --- locate the newest XML for our site -------------------------------------
async function findLatestXmlUrl() {
  const now = DateTime.utc()
  for (let back = 0; back < 26; back++) {
    const at = now.minus({ hours: back })
    const dirUrl = URLS.citypageHourDir(CITYPAGE.prov, at.hour)
    let html
    try {
      html = await fetchText(dirUrl)
    } catch {
      continue // hour dir may not exist yet / transient — keep scanning back
    }
    const re = new RegExp(`href="([^"]*_MSC_CitypageWeather_${CITYPAGE.siteId}_en\\.xml)"`, 'g')
    const names = [...html.matchAll(re)].map((m) => m[1])
    if (names.length === 0) continue
    names.sort() // ISO-timestamp prefix -> lexicographic == chronological
    return dirUrl + names.at(-1)
  }
  throw new Error(
    `no citypage XML found for ${CITYPAGE.siteId} in the last 26 UTC hour dirs — ` +
      `check ${URLS.citypageHourDir(CITYPAGE.prov, now.hour)} in a browser`,
  )
}

// --- parse the citypage XML --------------------------------------------------
// The forecastGroup lists ~13 periods alternating day/night ("Today",
// "Tonight", "Friday", "Friday night", ...). Day periods carry the high,
// night periods the low; a night period closes out its calendar day.
const asArray = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x])
// Elements with attributes parse to { '#text': value, '@_...': ... } — e.g.
// <month name="July">7</month> — so numeric extraction must unwrap that.
const numText = (x) => Number(x?.['#text'] ?? x)

export function parseCitypage(xmlText) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const doc = parser.parse(xmlText)
  const site = doc.siteData
  if (!site?.forecastGroup) throw new Error('unexpected citypage XML: no siteData.forecastGroup')

  // forecast issue time: dateTime elements with name="forecastIssue" (UTC + local copies)
  const issueDt = asArray(site.forecastGroup.dateTime).find(
    (d) => d['@_name'] === 'forecastIssue' && d['@_zone'] === 'UTC',
  )
  let issuedAt = issueDt
    ? DateTime.utc(
        numText(issueDt.year), numText(issueDt.month), numText(issueDt.day),
        numText(issueDt.hour), issueDt.minute === undefined ? 0 : numText(issueDt.minute),
      )
    : null
  if (issuedAt && !issuedAt.isValid) issuedAt = null
  const issueEastern = (issuedAt ?? DateTime.utc()).setZone(EASTERN)

  const days = new Map() // date -> { date, highC, lowC }
  const upsert = (date, patch) => days.set(date, { date, highC: null, lowC: null, ...days.get(date), ...patch })

  let cursor = issueEastern.startOf('day')
  for (const f of asArray(site.forecastGroup.forecast)) {
    const name = f.period?.['@_textForecastName'] ?? ''
    const isNight = /night|tonight/i.test(name)
    // Re-anchor the cursor on named weekdays so one odd period can't shift
    // every following day (e.g. "Friday" -> next date with weekday Friday).
    const dayName = WEEKDAYS.find((w) => name.startsWith(w))
    if (dayName) {
      const want = WEEKDAYS.indexOf(dayName) + 1 // luxon 1=Mon
      for (let i = 0; cursor.weekday !== want && i < 7; i++) cursor = cursor.plus({ days: 1 })
    }
    const temps = asArray(f.temperatures?.temperature)
    for (const t of temps) {
      const v = numText(t)
      if (!Number.isFinite(v)) continue
      const cls = t['@_class']
      if (cls === 'high') upsert(cursor.toISODate(), { highC: v })
      else if (cls === 'low') {
        // A night period's "low" is the overnight minimum; attribute it to the
        // calendar day the night starts on (matches how ECCC displays it).
        upsert(cursor.toISODate(), { lowC: v })
      }
    }
    if (isNight) cursor = cursor.plus({ days: 1 })
  }

  return {
    issuedAt: issuedAt ? issuedAt.toISO({ suppressMilliseconds: true }) : null,
    siteId: CITYPAGE.siteId,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// --- main --------------------------------------------------------------------
export async function fetchForecast() {
  console.log(`fetch_forecast: citypage ${CITYPAGE.name} (${CITYPAGE.siteId})`)
  const url = await findLatestXmlUrl()
  console.log(`  latest: ${url}`)
  const xml = await fetchText(url)
  const parsed = parseCitypage(xml)
  const out = { fetchedAt: DateTime.utc().toISO({ suppressMilliseconds: true }), sourceUrl: url, ...parsed }
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILES.forecastCitypage, JSON.stringify(out, null, 2))
  console.log(`  issued ${out.issuedAt}; ${out.days.length} forecast days:`)
  console.table(out.days)
  console.log(`fetch_forecast: wrote -> ${FILES.forecastCitypage}`)
  console.log('  SANITY-CHECK the table above against weather.gc.ca before trusting a run.')
  return out
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--parse')
  if (i !== -1) {
    const file = process.argv[i + 1]
    if (!file) { console.error('usage: fetch_forecast.js --parse <xml file>'); process.exit(1) }
    const parsed = parseCitypage(readFileSync(file, 'utf8'))
    console.log(JSON.stringify(parsed, null, 2))
  } else {
    fetchForecast().catch((e) => {
      console.error('fetch_forecast failed:', e.message)
      console.error('NOTE: dd.weather.gc.ca egress is blocked from the Claude sandbox; run on your machine.')
      process.exit(1)
    })
  }
}
