// Adapter: conservation/billing program catalog + residential rate reference
// for the Conservation Navigator tab. Two committed static files under
// public/programs/ (same static-JSON pattern as lib/ieso/globalAdjustment.js):
//   - conservation_programs.json — the curated, use-case-organized catalog
//   - residential_rates.json     — OEB RPP reference rates + OER for the comparator
// Both are refreshed weekly on CI by scripts/programs/ (the Claude sandbox
// can't reach OEB/IESO/Save-on-Energy; the GitHub runner can). These are
// program metadata, not IESO market reports, so they live in src/lib/ rather
// than src/lib/ieso/ (a small, deliberate placement choice).

async function readStatic(path, { bustCache = false } = {}) {
  const url = bustCache ? `${path}?t=${Date.now()}` : path
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchConservationPrograms(opts) {
  try {
    const data = await readStatic('/programs/conservation_programs.json', opts)
    if (!Array.isArray(data?.programs)) throw new Error('malformed conservation_programs.json')
    return { data, error: null }
  } catch {
    return { data: null, error: 'Program catalog not found (public/programs/conservation_programs.json).' }
  }
}

export async function fetchResidentialRates(opts) {
  try {
    const data = await readStatic('/programs/residential_rates.json', opts)
    if (!data?.tou || !data?.ulo || !data?.tiered) throw new Error('malformed residential_rates.json')
    return { data, error: null }
  } catch {
    return { data: null, error: 'Rate reference not found (public/programs/residential_rates.json).' }
  }
}
