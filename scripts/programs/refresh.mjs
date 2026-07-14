// Weekly program-catalog refresh (runs on a GitHub runner — the Claude sandbox
// can't reach OEB/IESO/Save-on-Energy). For each watched page it fetches the
// HTML, reduces it to substantive text (lib/domText), hashes it, and compares
// to the committed snapshot; when a page's substance changes it stamps the
// matching program with `sourceChangedAt` and flags it so a maintainer (or a
// follow-up curation pass) updates the human-written `keyDetail`.
//
// DESIGN NOTE (flagged): the scraper does NOT auto-rewrite curated copy from
// scraped DOM — rebate criteria are nuanced and a bad auto-edit is worse than a
// flagged stale one. It keeps the catalog *monitored* (detects + dates changes,
// bumps freshness) so nothing drifts silently; curation stays human-in-the-loop.
// Network failures per page are non-fatal (skipped, logged) so one dead link
// never blocks the refresh.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { htmlToText, contentHash, diffText, looksLikeErrorPage } from './lib/domText.mjs'
import { WATCH, OEB_RATES_URL } from './watchlist.mjs'

const ROOT = new URL('../../', import.meta.url)
const CATALOG = new URL('public/programs/conservation_programs.json', ROOT)
const RATES = new URL('public/programs/residential_rates.json', ROOT)
const SNAP = new URL('scripts/programs/snapshots/watch.json', ROOT)

const today = new Date().toISOString().slice(0, 10)

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'EnergyDashboard-refresh/1.0 (+github actions)' } })
    if (!res.ok) { console.warn(`  skip ${url} — HTTP ${res.status}`); return null }
    return await res.text()
  } catch (err) {
    console.warn(`  skip ${url} — ${err?.name || 'fetch error'}`)
    return null
  } finally {
    clearTimeout(t)
  }
}

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')) } catch { return fallback }
}

async function main() {
  const snap = await readJson(SNAP, {})
  const catalog = await readJson(CATALOG, null)
  if (!catalog) { console.error('conservation_programs.json missing/unreadable'); process.exit(1) }

  const nextSnap = {}
  const changedPrograms = []
  const changedPages = []

  console.log(`Watching ${WATCH.length} pages…`)
  for (const w of WATCH) {
    const html = await fetchText(w.url)
    if (html == null) { nextSnap[w.url] = snap[w.url] ?? { hash: null, lastChanged: null }; continue }
    const text = htmlToText(html)
    // Save on Energy serves "page doesn't exist" with HTTP 200 — never baseline
    // or diff an error body (a dead link is a skip, not a content change).
    if (looksLikeErrorPage(text)) {
      console.warn(`  skip ${w.url} — soft 404 ("page doesn't exist" body)`)
      nextSnap[w.url] = snap[w.url] ?? { hash: null, lastChanged: null }
      continue
    }
    const hash = contentHash(text)
    const prev = snap[w.url]
    const changed = prev?.hash ? prev.hash !== hash : false
    if (changed) {
      changedPages.push(w.url)
      if (w.programId) changedPrograms.push(w.programId)
      const d = diffText(prev.preview ?? '', text)
      console.log(`  CHANGED ${w.url} (+${d.added.length}/-${d.removed.length} lines)`)
    } else if (!prev?.hash) {
      console.log(`  seeded ${w.url}`)
    }
    nextSnap[w.url] = {
      hash,
      lastChanged: changed || !prev?.hash ? today : prev.lastChanged,
      // small preview so future diffs can show what moved (capped)
      preview: text.split('\n').slice(0, 60).join('\n').slice(0, 4000),
    }
  }

  // stamp changed programs + refresh catalog freshness
  for (const p of catalog.programs) {
    if (changedPrograms.includes(p.id)) p.sourceChangedAt = today
  }
  catalog.asOf = today
  catalog.watch = { lastRun: today, changedPages, changedPrograms }
  await writeFile(CATALOG, JSON.stringify(catalog, null, 2) + '\n')

  // rates: fetch if a stable feed is configured, else just bump asOf
  const rates = await readJson(RATES, null)
  if (rates) {
    if (OEB_RATES_URL) {
      const body = await fetchText(OEB_RATES_URL)
      if (body) {
        try {
          const parsed = JSON.parse(body)
          for (const k of ['tou', 'ulo', 'tiered', 'oerPercent']) if (parsed[k] != null) rates[k] = parsed[k]
          rates.illustrative = false
          rates.source = `Fetched from ${OEB_RATES_URL} on ${today}`
          console.log('  updated rates from OEB feed')
        } catch { console.warn('  OEB feed was not JSON; keeping committed rates') }
      }
    }
    rates.asOf = today
    await writeFile(RATES, JSON.stringify(rates, null, 2) + '\n')
  }

  await mkdir(new URL('scripts/programs/snapshots/', ROOT), { recursive: true })
  await writeFile(SNAP, JSON.stringify(nextSnap, null, 2) + '\n')

  console.log(`Done. ${changedPages.length} page(s) changed; ${changedPrograms.length} program(s) flagged.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
