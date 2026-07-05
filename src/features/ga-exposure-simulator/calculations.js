// Pure logic for the GA Exposure Simulator — no React (the contract's
// calculations.js). Everything with a dollar sign or a timestamp lives here,
// unit-tested against hand-worked examples (see calculations.test.js — with no
// legacy spreadsheet to validate against, those worked examples ARE the ground
// truth; check them before trusting any figure for a real exposure decision).
//
// Domain background (ICI / Class A):
//   IESO Industrial Conservation Initiative — a Class A consumer's Global
//   Adjustment charge is allocated by their Peak Demand Factor (PDF): their
//   share of Ontario's total energy withdrawal (AQEW) during the base period's
//   five Coincident Peak hours (May 1 – Apr 30, labelled by start year). That
//   PDF is billed over the FOLLOWING adjustment period (Jul 1 – Jun 30).
//   References: IESO "Global Adjustment and Peak Demand Factor" +
//   "Global Adjustment Class A Eligibility" (ieso.ca/sector-participants/
//   settlements). Where the public spec leaves a convention open, the choice
//   made here is flagged in a comment marked ⚑DECISION.

import { DateTime } from 'luxon'

export const EASTERN = 'America/Toronto'

// ---------------------------------------------------------------------------
// §1 Delimited-text detection (MV-90 / Itron / generic utility CSV exports)
// ---------------------------------------------------------------------------

const DELIMITERS = [',', '\t', ';', '|']

/** Split one line on a delimiter, honouring double-quoted fields. */
export function splitLine(line, delim) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === delim) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * Detect the data table inside a raw meter export: the delimiter, the header
 * row, and the data rows — tolerating metadata preamble lines above the
 * header (MV-90 exports routinely carry account/meter/report banners first).
 * Header = first line that (a) splits into ≥2 fields on the winning
 * delimiter, (b) contains at least one alphabetic cell, and (c) is followed
 * by a line with the same field count.
 */
export function detectTable(text) {
  const lines = String(text ?? '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return { error: 'File has fewer than 2 non-empty lines.' }

  // Winning delimiter = the one giving the most common field count > 1 across
  // the first 50 lines.
  let best = { delim: ',', score: 0 }
  for (const delim of DELIMITERS) {
    const counts = new Map()
    for (const l of lines.slice(0, 50)) {
      const n = splitLine(l, delim).length
      if (n > 1) counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    const modal = Math.max(0, ...counts.values())
    if (modal > best.score) best = { delim, score: modal }
  }
  if (best.score === 0) return { error: 'Could not detect a column delimiter (comma/tab/semicolon/pipe).' }

  const { delim } = best
  let headerIndex = -1
  for (let i = 0; i < Math.min(lines.length - 1, 40); i++) {
    const cells = splitLine(lines[i], delim)
    if (cells.length < 2) continue
    if (!cells.some((c) => /[a-zA-Z]{2,}/.test(c))) continue
    if (splitLine(lines[i + 1], delim).length === cells.length) { headerIndex = i; break }
  }
  if (headerIndex === -1) return { error: 'Could not locate a header row in the first 40 lines.' }

  const header = splitLine(lines[headerIndex], delim)
  const rows = []
  let malformed = 0
  for (const l of lines.slice(headerIndex + 1)) {
    const cells = splitLine(l, delim)
    if (cells.length === header.length) rows.push(cells)
    else malformed++
  }
  return {
    delimiter: delim,
    headerIndex,
    preamble: lines.slice(0, headerIndex),
    header,
    rows,
    malformedRows: malformed,
  }
}

// ---------------------------------------------------------------------------
// §2 Column-mapping auto-detection (user-overridable in the UI)
// ---------------------------------------------------------------------------

/** Supported physical quantities/units for the reading column. */
export const QUANTITY_OPTS = [
  { id: 'kwh', label: 'Energy — kWh per interval', kind: 'energy', factorToMwh: 1 / 1000 },
  { id: 'mwh', label: 'Energy — MWh per interval', kind: 'energy', factorToMwh: 1 },
  { id: 'kw', label: 'Demand — kW', kind: 'demand', factorToMw: 1 / 1000 },
  { id: 'mw', label: 'Demand — MW', kind: 'demand', factorToMw: 1 },
]

const match = (h, re) => re.test(h.toLowerCase())

/**
 * Guess the column mapping from header names. Every guess is presented in the
 * mapping UI for correction — nothing here is silently final.
 */
export function autoDetectMapping(header) {
  const H = header.map((h) => h.toLowerCase())
  const find = (re) => H.findIndex((h) => re.test(h))

  const singleTs = find(/timestamp|date.?time|datetime|read(ing)?.?(date.?)?time/)
  const dateCol = find(/^date$|(^|[^a-z])date([^a-z]|$)/)
  const timeCol = find(/^time$|interval.?(end|start)?.?time|(^|[^a-z])time([^a-z]|$)/)

  // Reading column preference: explicit kWh delivered > kWh > MWh > kW > MW.
  const delivered = find(/kwh.*(del|cons)|del.*kwh|consumption.*kwh/)
  const kwh = delivered !== -1 ? delivered : find(/kwh/)
  const mwh = find(/mwh/)
  const kw = H.findIndex((h) => /(^|[^a-z])kw([^a-z]|$)|demand/.test(h) && !/kwh|kvar|kva/.test(h))
  const mw = H.findIndex((h) => /(^|[^a-z])mw([^a-z]|$)/.test(h) && !/mwh/.test(h))

  let quantityCol = -1
  let quantityUnit = 'kwh'
  if (kwh !== -1) { quantityCol = kwh; quantityUnit = 'kwh' }
  else if (mwh !== -1) { quantityCol = mwh; quantityUnit = 'mwh' }
  else if (kw !== -1) { quantityCol = kw; quantityUnit = 'kw' }
  else if (mw !== -1) { quantityCol = mw; quantityUnit = 'mw' }

  const receivedCol = find(/rec(eived)?|gen(erat)|export/)
  const kvaCol = H.findIndex((h) => /kva/.test(h) && !/kvar/.test(h))
  const kvarCol = find(/kvar/)
  const pfCol = find(/(^|[^a-z])pf([^a-z]|$)|power.?factor/)

  return {
    // timestamp: single column, or split date+time
    timestampMode: singleTs !== -1 ? 'single' : dateCol !== -1 && timeCol !== -1 ? 'split' : 'single',
    timestampCol: singleTs !== -1 ? singleTs : Math.max(dateCol, 0),
    dateCol: dateCol !== -1 ? dateCol : 0,
    timeCol: timeCol !== -1 ? timeCol : 1,
    // ⚑DECISION MV-90 exports conventionally stamp interval-ENDING time; that
    // is the pre-checked default. Toggling shifts every reading one interval.
    intervalEnding: true,
    quantityCol: quantityCol !== -1 ? quantityCol : header.length - 1,
    quantityUnit,
    receivedCol: receivedCol !== -1 && receivedCol !== quantityCol ? receivedCol : null,
    deriveFromKva: quantityCol === -1 && kvaCol !== -1 && (kvarCol !== -1 || pfCol !== -1),
    kvaCol: kvaCol !== -1 ? kvaCol : null,
    kvarCol: kvarCol !== -1 ? kvarCol : null,
    pfCol: pfCol !== -1 ? pfCol : null,
    intervalMinutes: null, // null = infer from timestamp spacing
  }
}

// ---------------------------------------------------------------------------
// §3 Timestamp parsing + interval inference
// ---------------------------------------------------------------------------

const TS_FORMATS = [
  'M/d/yyyy H:mm', 'M/d/yyyy h:mm a', 'M/d/yy H:mm',
  'yyyy-MM-dd H:mm', 'yyyy/M/d H:mm', 'd-MMM-yyyy H:mm',
  'M/d/yyyy H:mm:ss', 'yyyy-MM-dd H:mm:ss',
]

/**
 * Parse a meter timestamp on the Eastern wall clock (EPT, DST-aware — the
 * clock IESO demand and the 5CP hours live on). Accepts ISO or the common
 * MDY/It export formats; `24:00` (MV-90 midnight-ending) rolls to next-day
 * 00:00.
 */
export function parseMeterTimestamp(dateStr, timeStr = null, zone = EASTERN) {
  let s = timeStr != null ? `${dateStr} ${timeStr}` : String(dateStr)
  s = s.trim()
  let addDay = false
  // MV-90 emits 24:00(:00) for the interval ending at midnight.
  if (/(^|\s)24:00(:00)?$/.test(s)) { s = s.replace(/24:00(:00)?$/, '00:00'); addDay = true }

  let dt = DateTime.fromISO(s.replace(' ', 'T'), { zone })
  if (!dt.isValid) {
    for (const f of TS_FORMATS) {
      dt = DateTime.fromFormat(s, f, { zone })
      if (dt.isValid) break
    }
  }
  if (!dt.isValid) return null
  return addDay ? dt.plus({ days: 1 }) : dt
}

/** Modal spacing (minutes) between consecutive parsed timestamps. */
export function inferIntervalMinutes(dts) {
  const counts = new Map()
  for (let i = 1; i < dts.length; i++) {
    const m = Math.round(dts[i].diff(dts[i - 1], 'minutes').minutes)
    if (m > 0 && m <= 120) counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  let best = null
  for (const [m, n] of counts) if (!best || n > counts.get(best)) best = m
  return best ?? 60
}

// ---------------------------------------------------------------------------
// §4 Meter normalization → hourly EPT series
// ---------------------------------------------------------------------------

/**
 * Normalize parsed meter rows to an hourly Eastern (EPT) net-load series.
 *
 * Rules applied (all from the mapping, all user-visible):
 *  - unit conversion (kWh/MWh energy-per-interval, or kW/MW demand × interval)
 *  - real power derived from apparent/reactive when mapped:
 *      kW = √(max(0, kVA² − kVAR²))  (or kW = kVA × PF when a PF column is
 *      mapped instead) — the standard power-triangle identity.
 *  - net-of-generation: net = delivered − received (ICI bills WITHDRAWAL from
 *    the grid, i.e. net consumption — the received channel is subtracted).
 *  - interval-ENDING timestamps are shifted back one interval so every
 *    reading is bucketed by the clock hour it was consumed in.
 *  - aggregation: energy summed within each Eastern clock hour → hourly MWh;
 *    hourly average MW = MWh / 1h. DST: the spring-forward hour simply never
 *    appears (23-hour day); the fall-back repeated hour keeps two distinct
 *    offset-qualified buckets whose energies are summed for the wall-clock
 *    hour when matched against a CP hour (the 5CP never falls at 1-2 AM).
 *
 * @param {string[][]} rows data rows from detectTable
 * @param {object} mapping autoDetectMapping shape (user-corrected)
 * @returns {{ hourly: MeterHour[], intervalMinutes: number, issues: string[],
 *             parseErrors: number, duplicates: number, nonMonotonic: number }}
 */
export function normalizeMeterToHourly(rows, mapping, zone = EASTERN) {
  const issues = []
  const num = (v) => {
    const n = Number(String(v).replace(/[$,\s]/g, ''))
    return Number.isFinite(n) ? n : null
  }

  // -- parse timestamps + readings ------------------------------------------
  const parsed = []
  let parseErrors = 0
  for (const cols of rows) {
    const dt = mapping.timestampMode === 'split'
      ? parseMeterTimestamp(cols[mapping.dateCol], cols[mapping.timeCol], zone)
      : parseMeterTimestamp(cols[mapping.timestampCol], null, zone)
    if (!dt) { parseErrors++; continue }

    let reading
    if (mapping.deriveFromKva) {
      const kva = num(cols[mapping.kvaCol])
      if (kva == null) { parseErrors++; continue }
      let kwVal
      if (mapping.kvarCol != null && num(cols[mapping.kvarCol]) != null) {
        const kvar = num(cols[mapping.kvarCol])
        kwVal = Math.sqrt(Math.max(0, kva * kva - kvar * kvar))
      } else if (mapping.pfCol != null && num(cols[mapping.pfCol]) != null) {
        kwVal = kva * num(cols[mapping.pfCol])
      } else { parseErrors++; continue }
      reading = { value: kwVal, unit: 'kw' }
    } else {
      const v = num(cols[mapping.quantityCol])
      if (v == null) { parseErrors++; continue }
      reading = { value: v, unit: mapping.quantityUnit }
    }

    const received = mapping.receivedCol != null ? num(cols[mapping.receivedCol]) ?? 0 : 0
    parsed.push({ dt, reading, received })
  }
  if (parsed.length === 0) {
    return { hourly: [], intervalMinutes: null, issues: ['No parseable rows.'], parseErrors, duplicates: 0, nonMonotonic: 0 }
  }

  // -- order, dupes, interval ------------------------------------------------
  let nonMonotonic = 0
  for (let i = 1; i < parsed.length; i++) if (parsed[i].dt < parsed[i - 1].dt) nonMonotonic++
  parsed.sort((a, b) => a.dt - b.dt)

  let duplicates = 0
  const seen = new Set()
  const deduped = []
  for (const p of parsed) {
    const k = p.dt.toMillis()
    if (seen.has(k)) { duplicates++; continue }
    seen.add(k)
    deduped.push(p)
  }

  const intervalMinutes = mapping.intervalMinutes ?? inferIntervalMinutes(deduped.map((p) => p.dt))
  const intervalHours = intervalMinutes / 60

  // -- to energy, bucket by EPT hour ----------------------------------------
  const buckets = new Map()
  for (const p of deduped) {
    // interval-ending stamps mark the END of consumption: shift back to start.
    const start = mapping.intervalEnding ? p.dt.minus({ minutes: intervalMinutes }) : p.dt
    const u = QUANTITY_OPTS.find((q) => q.id === (p.reading.unit ?? 'kwh')) ?? QUANTITY_OPTS[0]
    const grossMwh = u.kind === 'energy'
      ? p.reading.value * u.factorToMwh
      : p.reading.value * u.factorToMw * intervalHours
    // received channel is in the same unit as the main reading
    const recMwh = u.kind === 'energy'
      ? p.received * (u.factorToMwh ?? 0)
      : p.received * (u.factorToMw ?? 0) * intervalHours
    const netMwh = grossMwh - recMwh

    const hourStart = start.startOf('hour')
    const key = hourStart.toISO() // offset-qualified: fall-back hours stay distinct
    const b = buckets.get(key) ?? { hourStart, netMwh: 0, samples: 0 }
    b.netMwh += netMwh
    b.samples += 1
    buckets.set(key, b)
  }

  const expected = Math.max(1, Math.round(60 / intervalMinutes))
  const hourly = [...buckets.values()]
    .sort((a, b) => a.hourStart - b.hourStart)
    .map((b) => ({
      hourStart: b.hourStart.toISO(),
      day: b.hourStart.toISODate(),
      hourEnding: b.hourStart.hour + 1,
      netMwh: b.netMwh,
      netMw: b.netMwh, // MWh over one hour == average MW
      samples: b.samples,
      partial: b.samples < expected,
    }))

  if (parseErrors) issues.push(`${parseErrors} row(s) could not be parsed (bad timestamp or reading).`)
  if (duplicates) issues.push(`${duplicates} duplicate timestamp(s) dropped (first occurrence kept).`)
  if (nonMonotonic) issues.push(`${nonMonotonic} out-of-order timestamp(s) — rows were re-sorted.`)

  return { hourly, intervalMinutes, issues, parseErrors, duplicates, nonMonotonic }
}

// ---------------------------------------------------------------------------
// §5 Validation against the base period + CP hours (loud, never silent)
// ---------------------------------------------------------------------------

/**
 * @param {{severity:'error'|'warn'|'info', text:string}[]} out
 */
export function validateMeterSeries(norm, basePeriod, coincidentPeaks) {
  const out = []
  const { hourly } = norm
  if (hourly.length === 0) return [{ severity: 'error', text: 'No usable hourly data after normalization.' }]

  for (const t of norm.issues) out.push({ severity: 'warn', text: t })

  // implausible magnitude — a 5 GW facility does not exist in Ontario
  const maxMw = Math.max(...hourly.map((h) => h.netMw))
  if (maxMw > 2000) {
    out.push({
      severity: 'error',
      text: `Peak hourly load is ${Math.round(maxMw).toLocaleString()} MW — implausible for one facility. The unit mapping is probably wrong (kW read as MW, or kWh as MWh).`,
    })
  } else if (maxMw > 500) {
    out.push({ severity: 'warn', text: `Peak hourly load ${Math.round(maxMw)} MW is unusually large — double-check the unit mapping.` })
  }
  if (hourly.every((h) => h.netMwh <= 0)) {
    out.push({ severity: 'error', text: 'All net readings are ≤ 0 — delivered/received channels may be swapped.' })
  }

  // coverage vs the selected base period
  if (basePeriod) {
    const inPeriod = hourly.filter((h) => h.day >= basePeriod.start && h.day <= basePeriod.end)
    const daysCovered = new Set(inPeriod.map((h) => h.day)).size
    const periodDays = Math.round(
      DateTime.fromISO(basePeriod.end).diff(DateTime.fromISO(basePeriod.start), 'days').days,
    ) + 1
    if (daysCovered === 0) {
      out.push({ severity: 'error', text: `File contains no data inside the selected base period (${basePeriod.start} → ${basePeriod.end}).` })
    } else if (daysCovered < periodDays) {
      out.push({ severity: 'warn', text: `File covers ${daysCovered} of ${periodDays} base-period days.` })
    } else {
      out.push({ severity: 'info', text: `Full base-period coverage: ${daysCovered} of ${periodDays} days.` })
    }
    const partial = inPeriod.filter((h) => h.partial).length
    if (partial) out.push({ severity: 'warn', text: `${partial} hour(s) in the base period have missing intervals (partial hours under-count energy).` })
  }

  // the loud one: a hole at an actual CP hour materially changes the PDF
  if (coincidentPeaks?.length) {
    const byKey = indexHourly(hourly)
    const missing = coincidentPeaks.filter((cp) => {
      const h = lookupCpHour(byKey, cp)
      return h == null || h.partial
    })
    if (missing.length) {
      out.push({
        severity: 'error',
        text: `Meter data is missing or partial at ${missing.length} of the 5 coincident peak hours (${missing
          .map((cp) => `CP${cp.rank ?? cp.cpRank} ${cp.date} HE${cp.hourEnding}`)
          .join('; ')}). The PDF below under-counts those hours — treat it as a lower bound, not a billing figure.`,
      })
    }
  }
  return out
}

/** Index hourly rows by `day|hourEnding` (wall clock), summing fall-back duplicates. */
export function indexHourly(hourly) {
  const m = new Map()
  for (const h of hourly) {
    const k = `${h.day}|${h.hourEnding}`
    const cur = m.get(k)
    m.set(k, cur ? { ...cur, netMwh: cur.netMwh + h.netMwh, netMw: cur.netMw + h.netMw, partial: cur.partial || h.partial } : h)
  }
  return m
}

const lookupCpHour = (byKey, cp) => byKey.get(`${cp.date}|${cp.hourEnding}`) ?? null

// ---------------------------------------------------------------------------
// §6 ICI math
// ---------------------------------------------------------------------------

/**
 * Peak Demand Factor.
 *
 * ICI rule (IESO "Global Adjustment and Peak Demand Factor"): a Class A
 * consumer's PDF for a base period is their share of total Ontario energy
 * withdrawal (AQEW) over that period's five Coincident Peak hours:
 *
 *     PDF = Σᵢ customerMWᵢ / Σᵢ ontarioMWᵢ        (i = CP1..CP5)
 *
 * ⚑DECISION Σ/Σ form (sum of customer draws over sum of Ontario draws), NOT
 * the mean-of-ratios (1/5)Σ(customerᵢ/ontarioᵢ) some explainers show. Σ/Σ is
 * the published allocation form and makes savingsByCoincidentPeak exactly
 * additive. The forms differ when the five Ontario peaks differ in magnitude.
 * Swappable: pass { form: 'mean-of-ratios' } to compare.
 *
 * ⚑DECISION missing meter data at a CP hour contributes 0 to the numerator
 * (never imputed) and is reported via `missing` — the PDF is then a lower
 * bound and validateMeterSeries flags it as an error upstream.
 *
 * No rounding is applied here (the IESO publishes PDFs to 6 decimal places;
 * display rounding is the UI's job). Flagged, not guessed.
 *
 * @param {MeterHour[]} hourlyLoad
 * @param {CoincidentPeak[]} coincidentPeaks the base period's official 5CP
 */
export function computePDF(hourlyLoad, coincidentPeaks, { form = 'sum-over-sum' } = {}) {
  const byKey = indexHourly(hourlyLoad)
  const perPeak = (coincidentPeaks ?? []).map((cp) => {
    const h = lookupCpHour(byKey, cp)
    const customerMw = h?.netMw ?? null
    return {
      cpRank: cp.rank ?? cp.cpRank,
      date: cp.date,
      hourEnding: cp.hourEnding,
      customerMw,
      ontarioMw: cp.ontarioMw,
      share: customerMw != null && cp.ontarioMw ? customerMw / cp.ontarioMw : null,
      missing: customerMw == null,
      partial: h?.partial ?? false,
    }
  })
  const sumOntarioMw = perPeak.reduce((s, p) => s + (p.ontarioMw ?? 0), 0)
  const sumCustomerMw = perPeak.reduce((s, p) => s + (p.customerMw ?? 0), 0)
  const present = perPeak.filter((p) => !p.missing)

  let pdf = null
  if (perPeak.length && sumOntarioMw > 0) {
    pdf = form === 'mean-of-ratios'
      ? present.reduce((s, p) => s + p.share, 0) / perPeak.length
      : sumCustomerMw / sumOntarioMw
  }
  return {
    pdf,
    form,
    perPeak,
    sumCustomerMw,
    sumOntarioMw,
    missingCount: perPeak.filter((p) => p.missing).length,
    complete: perPeak.length === 5 && perPeak.every((p) => !p.missing && !p.partial),
  }
}

/**
 * Expand the GA config into the billing period's 12 months.
 * `gaConfig.months` (explicit [{month, classAGADollars}]) wins when present;
 * otherwise equal twelfths of `annualClassAGADollars` (flat shape, no fake
 * seasonality — the config is illustrative until real IESO monthlies land).
 */
export function expandMonthlyGA(gaConfig, billingPeriod) {
  const start = DateTime.fromISO(billingPeriod.start)
  const months = Array.from({ length: 12 }, (_, i) => start.plus({ months: i }).toFormat('yyyy-MM'))
  if (gaConfig?.months?.length) {
    const byMonth = new Map(gaConfig.months.map((m) => [m.month, m.classAGADollars]))
    const known = gaConfig.months.map((m) => m.classAGADollars)
    const fillAvg = known.reduce((a, b) => a + b, 0) / known.length
    return months.map((month) => ({
      month,
      classAGADollars: byMonth.get(month) ?? fillAvg,
      filled: !byMonth.has(month),
    }))
  }
  const twelfth = (gaConfig?.annualClassAGADollars ?? 0) / 12
  return months.map((month) => ({ month, classAGADollars: twelfth, filled: false }))
}

/**
 * Class A GA dollars from a PDF over the billing period.
 * ICI rule: monthly Class A charge = PDF × that month's total Class A GA pool;
 * annual = PDF × Σ monthly pools.
 */
export function computeGAExposure(pdf, monthlyClassAGA) {
  if (pdf == null) return { annualDollars: null, monthly: [] }
  const monthly = monthlyClassAGA.map((m) => ({ ...m, chargeDollars: pdf * m.classAGADollars }))
  return { annualDollars: monthly.reduce((s, m) => s + m.chargeDollars, 0), monthly }
}

/**
 * Class A vs Class B over the billing period.
 *   Class B = volumetric: annual kWh × Class B GA rate ($/kWh).
 *   Class A = PDF × Σ monthly Class A GA pools.
 *   Break-even PDF = the PDF at which the two are equal — below it Class A
 *   wins (their peak share is cheaper than paying by volume).
 */
export function compareClassAvsClassB(pdf, annualConsumptionKwh, monthlyClassAGA, classBRatePerKwh) {
  const annualPool = monthlyClassAGA.reduce((s, m) => s + m.classAGADollars, 0)
  const classBDollars = annualConsumptionKwh * classBRatePerKwh
  const classADollars = pdf != null ? pdf * annualPool : null
  const breakevenPdf = annualPool > 0 ? classBDollars / annualPool : null
  return {
    classADollars,
    classBDollars,
    breakevenPdf,
    annualPool,
    recommendedClass:
      classADollars == null || breakevenPdf == null ? null : classADollars <= classBDollars ? 'A' : 'B',
    savingsDollars: classADollars != null ? classBDollars - classADollars : null,
  }
}

/**
 * The hero decomposition: each CP's marginal GA dollars, and what curtailment
 * at that CP saves.
 *
 * Because the PDF is Σ/Σ, annual Class A GA = Σᵢ (customerMWᵢ / ΣontarioMW) ×
 * annualPool — i.e. each CP hour independently contributes
 * (customerMWᵢ/ΣontarioMW)×pool dollars, and the five contributions sum
 * exactly to the total. Curtailing CP i from customerMWᵢ to targetMWᵢ saves
 * ((customerMWᵢ − targetMWᵢ)/ΣontarioMW) × pool — hitting even 3 of 5 peaks
 * banks 3 real per-CP savings.
 *
 * Assumption (flagged): the customer's curtailment does not change ΣontarioMW
 * or which hours are the CPs — safe at facility scale (MW) vs Ontario's
 * ~23,000 MW peaks.
 *
 * @param {ReturnType<typeof computePDF>['perPeak']} perPeak
 * @param {number} annualPool Σ monthly Class A GA dollars
 * A null target (global or per-CP) means "no curtailment at this CP".
 * @param {{mode:'global', targetMw:number|null}|{mode:'perCp', targets:Record<number,number|null>}} plan
 */
export function savingsByCoincidentPeak(perPeak, annualPool, plan = { mode: 'global', targetMw: null }) {
  const sumOntarioMw = perPeak.reduce((s, p) => s + (p.ontarioMw ?? 0), 0)
  if (!sumOntarioMw) return { rows: [], totalBaselineDollars: 0, totalSavingDollars: 0, totalResidualDollars: 0 }

  let cum = 0
  const rows = perPeak.map((p) => {
    const customerMw = p.customerMw ?? 0
    const targetRaw = (plan.mode === 'perCp' ? plan.targets?.[p.cpRank] : plan.targetMw) ?? customerMw
    const curtailedTo = Math.min(customerMw, Math.max(0, targetRaw))
    const baselineDollars = (customerMw / sumOntarioMw) * annualPool
    const savingDollars = ((customerMw - curtailedTo) / sumOntarioMw) * annualPool
    cum += savingDollars
    return {
      cpRank: p.cpRank,
      date: p.date,
      hourEnding: p.hourEnding,
      customerMw,
      ontarioMw: p.ontarioMw,
      curtailedToMw: curtailedTo,
      baselineDollars,
      savingDollars,
      residualDollars: baselineDollars - savingDollars,
      cumulativeSavingDollars: cum,
      missing: p.missing,
    }
  })
  return {
    rows,
    totalBaselineDollars: rows.reduce((s, r) => s + r.baselineDollars, 0),
    totalSavingDollars: rows.reduce((s, r) => s + r.savingDollars, 0),
    totalResidualDollars: rows.reduce((s, r) => s + r.residualDollars, 0),
  }
}

/**
 * Forward-looking, probability-weighted curtailment ROI on the forecast's
 * upcoming predicted peaks.
 *
 * For each upcoming candidate day:
 *   perEventSaving = (curtailableMW / ΣreferenceOntarioMW) × annualPool
 *   EV = P(top-5) × perEventSaving − curtailmentCostPerEvent
 * using the forecast's calibrated numeric `probability` (never the binary
 * flag), so low-confidence days are visibly not worth the curtailment cost.
 * `predictedPeaks` are shared GAForecast rows (lib/ieso forecastToGAForecasts).
 *
 * ΣreferenceOntarioMW = the current running 5CP board total — the best live
 * estimate of the final PDF denominator (flagged assumption; final CPs can
 * only be higher, which would shrink per-event savings slightly).
 */
export function simulateCurtailmentROI({
  predictedPeaks,
  curtailableMw,
  curtailmentCostPerEvent,
  annualPool,
  referenceOntarioMw,
}) {
  if (!referenceOntarioMw) return []
  return (predictedPeaks ?? [])
    .map((p) => {
      const perEventSavingDollars = (curtailableMw / referenceOntarioMw) * annualPool
      const ev = p.probability != null
        ? p.probability * perEventSavingDollars - curtailmentCostPerEvent
        : null
      return {
        date: p.date,
        daysOut: p.daysOut,
        hourEnding: p.hour,
        predictedMw: p.predictedMw,
        wouldRankTop5: p.wouldRankTop5,
        probability: p.probability ?? null,
        perEventSavingDollars,
        expectedValueDollars: ev,
        worthCurtailing: ev != null && ev > 0 && p.wouldRankTop5,
      }
    })
    .sort((a, b) => (b.expectedValueDollars ?? -Infinity) - (a.expectedValueDollars ?? -Infinity))
}

/**
 * Today's / this week's curtail-or-monitor signal from the live forecast —
 * always with the underlying probability, never a bare flag.
 * Levels: 'curtail' (a would-rank-top-5 day within 1 day), 'prepare'
 * (within `horizonDays`), else 'monitor'.
 * @param {{ predictedPeaks: import('../../types/market').GAForecast[], threshold?: number }} input
 */
export function dailyCurtailmentSignal({ predictedPeaks, threshold } = {}, { horizonDays = 7 } = {}) {
  const peaks = (predictedPeaks ?? [])
    .filter((p) => p.daysOut <= horizonDays)
    .sort((a, b) => a.daysOut - b.daysOut)
  const target = peaks.find((p) => p.wouldRankTop5)
  if (!target) {
    const next = peaks[0] ?? null
    return {
      level: 'monitor',
      reason: next
        ? `No predicted peak in the next ${horizonDays} days approaches the running top-5 threshold${threshold ? ` (${threshold.toLocaleString()} MW)` : ''}.`
        : 'No candidate peak days in the forecast window.',
      peak: next,
      probability: next?.probability ?? null,
    }
  }
  return {
    level: target.daysOut <= 1 ? 'curtail' : 'prepare',
    reason:
      target.daysOut <= 1
        ? `Predicted peak today/tomorrow (HE${target.hour}) is projected to crack the running top-5.`
        : `${target.date} (in ${target.daysOut} days, HE${target.hour}) is projected to crack the running top-5.`,
    peak: target,
    probability: target.probability ?? null,
  }
}

// ---------------------------------------------------------------------------
// §7 small shared formatters
// ---------------------------------------------------------------------------

export function fmtDay(iso) {
  // Noon local avoids any date rollover from timezone offset.
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
}

export const fmtDollars = (v, digits = 0) =>
  v == null ? '—' : v.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: digits })

export const fmtMw = (v, digits = 2) => (v == null ? '—' : `${v.toFixed(digits)} MW`)

export const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-CA'))

export const fmtPdf = (v) => (v == null ? '—' : `${(v * 100).toFixed(4)}%`)

/** Annual consumption (kWh) of an hourly series — the Class B volumetric base. */
export const annualConsumptionKwh = (hourly) => hourly.reduce((s, h) => s + Math.max(0, h.netMwh) * 1000, 0)

// ---------------------------------------------------------------------------
// §8 Sample profile (try-the-tab data; deterministic, clearly synthetic)
// ---------------------------------------------------------------------------

/**
 * Generate a synthetic MV-90-style 15-min CSV covering each coincident-peak
 * day (plus the day after, for contrast): ~6 MW overnight baseload rising to
 * ~12 MW on business hours, small deterministic wobble, a little on-site
 * generation exported midday. Preamble lines included on purpose — the
 * detector must skip them, like a real export.
 */
export function generateSampleCsv(coincidentPeaks) {
  const days = [...new Set((coincidentPeaks ?? []).flatMap((cp) => {
    const d = DateTime.fromISO(cp.date, { zone: EASTERN })
    return [d.toISODate(), d.plus({ days: 1 }).toISODate()]
  }))].sort()

  const lines = [
    'Sample Facility Meter Export (SYNTHETIC DATA — for trying the tab)',
    'Account: 000-0000-000  Meter: SAMPLE-1  Channels: kWh Delivered / kWh Received',
    'Date,Time,kWh Delivered,kWh Received',
  ]
  for (const day of days) {
    const d0 = DateTime.fromISO(day, { zone: EASTERN }).startOf('day')
    for (let q = 1; q <= 96; q++) {
      const end = d0.plus({ minutes: 15 * q })
      const h = end.minus({ minutes: 8 }).hour // representative hour of the interval
      const business = h >= 7 && h <= 19
      const mw = (business ? 10.5 + 1.5 * Math.sin((h - 7) / 12 * Math.PI) : 6) + 0.3 * Math.sin(q / 7)
      const kwh = (mw * 1000) / 4 // 15-min energy
      const genKwh = h >= 11 && h <= 15 ? 120 : 0
      const time = end.day !== d0.day ? '24:00' : end.toFormat('HH:mm')
      lines.push(`${d0.toFormat('MM/dd/yyyy')},${time},${kwh.toFixed(1)},${genKwh.toFixed(1)}`)
    }
  }
  return { name: 'sample_profile_synthetic.csv', text: lines.join('\r\n') }
}

/**
 * @typedef {object} MeterHour
 * @property {string} hourStart ISO, offset-qualified, America/Toronto
 * @property {string} day YYYY-MM-DD
 * @property {number} hourEnding HE1–HE24
 * @property {number} netMwh energy withdrawn in the hour (delivered − received)
 * @property {number} netMw hourly average MW (== netMwh over one hour)
 * @property {number} samples intervals aggregated into this hour
 * @property {boolean} partial fewer intervals than the meter cadence implies
 */

/**
 * @typedef {object} CoincidentPeak
 * @property {number} rank 1–5
 * @property {string} date YYYY-MM-DD
 * @property {number} hourEnding HE1–HE24, Eastern (DST-aware) clock
 * @property {number} ontarioMw Ontario AQEW for the hour (the PDF denominator)
 */
