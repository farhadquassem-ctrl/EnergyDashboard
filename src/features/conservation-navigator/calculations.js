// Pure logic for the Conservation & Billing Navigator (Class B / residential).
// No React, no I/O — program curation/filtering, the rate-plan comparator, and
// freshness are all here and unit-tested (calculations.test.js). The tab is a
// pure renderer of the curated program catalog + rate reference JSON.

import { DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// §1 Program curation / filtering
// ---------------------------------------------------------------------------

/** Which audience a program serves; UI exposes All / Residential / Business. */
export const AUDIENCES = ['residential', 'commercial']

const norm = (s) => String(s ?? '').toLowerCase()

/**
 * Filter the curated catalog by audience and a free-text query (matched across
 * name, use-case, key detail, and tags). Returns programs in a stable order:
 * the catalog's own order, which is curated by relevance (see the JSON).
 * @param {object[]} programs
 * @param {{ audience?: 'all'|'residential'|'commercial', query?: string }} opts
 */
export function filterPrograms(programs, { audience = 'all', query = '' } = {}) {
  const q = norm(query).trim()
  return (programs ?? []).filter((p) => {
    if (audience !== 'all' && !(p.audience ?? []).includes(audience)) return false
    if (!q) return true
    const hay = [p.name, p.useCase, p.keyDetail, ...(p.tags ?? [])].map(norm).join(' ')
    return q.split(/\s+/).every((term) => hay.includes(term))
  })
}

/** Group filtered programs by category (billing, rebate, demand-response, tracking). */
export function groupByCategory(programs) {
  const m = new Map()
  for (const p of programs) {
    const g = m.get(p.category)
    if (g) g.push(p)
    else m.set(p.category, [p])
  }
  return m
}

// ---------------------------------------------------------------------------
// §2 Freshness (the weekly-refresh requirement, surfaced honestly in the UI)
// ---------------------------------------------------------------------------

/**
 * Describe how fresh the catalog is. `weekly` refresh + a 1-day grace → stale
 * after 8 days. Returns a label and a `stale` flag the UI badges.
 */
export function freshness(asOf, now = DateTime.now()) {
  const dt = DateTime.fromISO(asOf)
  if (!dt.isValid) return { label: 'unknown', stale: true, days: null }
  const days = Math.floor(now.diff(dt, 'days').days)
  return {
    label: days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`,
    stale: days > 8,
    days,
  }
}

// ---------------------------------------------------------------------------
// §3 Rate-plan comparator (TOU vs ULO vs Tiered, with the OER credit)
// ---------------------------------------------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0))

/** Normalize an {off,mid,on} split to fractions summing to 1 (falls back to a typical profile). */
export function normalizeSplit(split) {
  const off = Math.max(0, split?.off ?? 0)
  const mid = Math.max(0, split?.mid ?? 0)
  const on = Math.max(0, split?.on ?? 0)
  const sum = off + mid + on
  if (sum <= 0) return { off: 0.65, mid: 0.18, on: 0.17 }
  return { off: off / sum, mid: mid / sum, on: on / sum }
}

/**
 * Monthly + annual cost of a household's electricity under each RPP plan, with
 * the Ontario Electricity Rebate (OER) applied as a flat pre-tax credit.
 *
 * Model (documented assumptions, all illustrative until OEB rates are verified):
 *  - TOU: monthlyKwh split by off/mid/on shares × each TOU price.
 *  - ULO: `uloOvernightShare` of usage priced at the ultra-low overnight rate;
 *    the remainder keeps the same off/mid/on proportions at ULO's (higher)
 *    on-peak / weekend prices — so ULO only wins when you actually move load
 *    overnight, which is the whole point of surfacing it.
 *  - Tiered: first `threshold` kWh at tier-1, the rest at tier-2.
 *  - OER: every subtotal × (1 − oerPercent). Energy only (delivery/regulatory
 *    charges are out of scope — this compares the commodity line the plans differ on).
 *
 * @param {{monthlyKwh:number, split:{off:number,mid:number,on:number}, uloOvernightShare:number}} usage
 * @param {object} rates residential_rates.json shape
 */
export function planCosts(usage, rates) {
  const monthlyKwh = Math.max(0, usage?.monthlyKwh ?? 0)
  const s = normalizeSplit(usage?.split)
  const uShare = clamp01(usage?.uloOvernightShare ?? 0)
  const rem = 1 - uShare
  const oer = rates?.oerPercent ?? 0
  const afterOer = (x) => x * (1 - oer)

  const tou = rates.tou
  const ulo = rates.ulo
  const tier = rates.tiered

  const touM = monthlyKwh * (s.off * tou.offPeak + s.mid * tou.midPeak + s.on * tou.onPeak)
  const uloM = monthlyKwh * (uShare * ulo.ulo + rem * (s.off * ulo.offPeak + s.mid * ulo.midPeak + s.on * ulo.onPeak))
  const tierM = monthlyKwh <= tier.threshold
    ? monthlyKwh * tier.tier1
    : tier.threshold * tier.tier1 + (monthlyKwh - tier.threshold) * tier.tier2

  const plan = (monthly) => ({
    monthly,
    monthlyAfterOer: afterOer(monthly),
    annualAfterOer: afterOer(monthly) * 12,
  })
  const plans = { tou: plan(touM), ulo: plan(uloM), tiered: plan(tierM) }

  // cheapest by after-OER monthly cost
  const recommended = Object.entries(plans).sort((a, b) => a[1].monthlyAfterOer - b[1].monthlyAfterOer)[0][0]
  const sorted = Object.entries(plans).map(([k, v]) => v.monthlyAfterOer).sort((a, b) => a - b)
  const savingsVsWorst = sorted[sorted.length - 1] - sorted[0]

  return { plans, recommended, annualSavingsVsWorst: savingsVsWorst * 12, split: s }
}

export const fmtCents = (dollarsPerKwh) => `${(dollarsPerKwh * 100).toFixed(1)}¢`
export const fmtDollars = (v) => (v == null ? '—' : v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }))
export const PLAN_LABEL = { tou: 'Time-of-Use', ulo: 'Ultra-Low Overnight', tiered: 'Tiered' }
