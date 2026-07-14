// Pages the weekly job watches for substantive changes, mapped to the program
// ids in public/programs/conservation_programs.json. Save on Energy has no open
// feed, so we diff the DOM of the program + "News and Updates" pages. OEB/IESO
// rate + GA figures come from their data endpoints when a stable URL is set.

export const WATCH = [
  // URLs re-verified 2026-07-14 — Save on Energy restructured ("For Your
  // Business" → "For-Business-and-Industry"; HRSP moved to a vanity path) and
  // serves soft-404s (HTTP 200 "page doesn't exist"), so a dead URL here looks
  // "healthy" to res.ok. refresh.mjs guards with looksLikeErrorPage().
  { programId: 'home-renovation-savings', url: 'https://www.saveonenergy.ca/homerenovationsavings' },
  { programId: 'peak-perks', url: 'https://www.saveonenergy.ca/en/For-Your-Home/Peak-Perks' },
  { programId: 'energy-affordability', url: 'https://www.saveonenergy.ca/en/For-Your-Home/Energy-Affordability-Program' },
  { programId: 'retrofit-program', url: 'https://www.saveonenergy.ca/en/For-Business-and-Industry/Programs-and-incentives/Retrofit-Program' },
  { programId: 'small-business-peak-perks', url: 'https://www.saveonenergy.ca/en/For-Business-and-Industry/Programs-and-incentives' },
  { programId: null, url: 'https://www.saveonenergy.ca/News-and-Updates', label: 'News and Updates' },
]

// Optional structured feeds (set in CI env when a stable endpoint is known).
// OEB does not publish a clean RPP JSON API; leave unset to keep the committed
// illustrative rates and only bump `asOf`.
export const OEB_RATES_URL = process.env.OEB_RATES_URL || null
// IESO monthly Class B Global Adjustment (CSV/XML) — informational for the
// GA-tracking card's freshness; wire when the exact directory URL is confirmed.
export const IESO_GA_URL = process.env.IESO_GA_URL || null
