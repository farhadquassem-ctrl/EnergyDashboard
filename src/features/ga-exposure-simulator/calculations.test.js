import test from 'node:test'
import assert from 'node:assert/strict'
import {
  splitLine, detectTable, autoDetectMapping, parseMeterTimestamp,
  inferIntervalMinutes, normalizeMeterToHourly, validateMeterSeries,
  computePDF, expandMonthlyGA, computeGAExposure, compareClassAvsClassB,
  savingsByCoincidentPeak, simulateCurtailmentROI, dailyCurtailmentSignal,
  annualConsumptionKwh,
} from './calculations.js'

// ===========================================================================
// HAND-WORKED EXAMPLE (the ground truth — no legacy spreadsheet exists):
//
//   Five CPs, each Ontario AQEW 20,000 MW           → Σ ontario = 100,000 MW
//   Customer draws exactly 10 MW at every CP hour   → Σ customer = 50 MW
//   PDF (Σ/Σ)            = 50 / 100,000  = 0.0005   (0.05 %)
//   Annual Class A pool  = $1,000,000,000
//   Class A GA           = 0.0005 × $1B  = $500,000 / yr
//   Consumption 10 MW flat × 8,760 h = 87,600 MWh = 87,600,000 kWh
//   Class B rate $0.01/kWh → Class B GA = $876,000 / yr
//   Break-even PDF       = 876,000 / 1e9 = 0.000876 → Class A wins ($376,000)
//   Per-CP contribution  = 10/100,000 × $1B = $100,000 each (5 × = $500,000 ✓)
//   Curtail to 2 MW at 3 CPs → saves 3 × (8/100,000 × $1B) = $240,000
// ===========================================================================

const CPS = [1, 2, 3, 4, 5].map((rank) => ({
  rank,
  date: `2025-07-0${rank}`, // summer weekdays, HE17 — realistic CP shape
  hourEnding: 17,
  ontarioMw: 20000,
}))

// hourly rows covering each CP hour at exactly 10 MW
const HOURLY_AT_CPS = CPS.map((cp) => ({
  hourStart: `${cp.date}T16:00:00.000-04:00`,
  day: cp.date,
  hourEnding: 17,
  netMwh: 10,
  netMw: 10,
  samples: 4,
  partial: false,
}))

const GA_CONFIG = { annualClassAGADollars: 1_000_000_000 }
const BILLING = { start: '2026-07-01', end: '2027-06-30' }

test('hand-worked: PDF Σ/Σ = 0.0005 with full per-peak decomposition', () => {
  const r = computePDF(HOURLY_AT_CPS, CPS)
  assert.equal(r.pdf, 0.0005)
  assert.equal(r.sumCustomerMw, 50)
  assert.equal(r.sumOntarioMw, 100000)
  assert.equal(r.complete, true)
  assert.equal(r.perPeak.length, 5)
  for (const p of r.perPeak) assert.equal(p.share, 10 / 20000)
})

test('hand-worked: Σ/Σ vs mean-of-ratios differ when Ontario peaks differ', () => {
  const unequal = [
    { rank: 1, date: '2025-07-01', hourEnding: 17, ontarioMw: 25000 },
    { rank: 2, date: '2025-07-02', hourEnding: 17, ontarioMw: 15000 },
  ]
  const hours = unequal.map((cp) => ({ day: cp.date, hourEnding: 17, netMwh: 10, netMw: 10, samples: 1, partial: false }))
  const sumForm = computePDF(hours, unequal)
  const ratioForm = computePDF(hours, unequal, { form: 'mean-of-ratios' })
  assert.equal(sumForm.pdf, 20 / 40000) // 0.0005
  // mean of 10/25000 and 10/15000 = (0.0004 + 0.000666…)/2 ≈ 0.000533
  assert.ok(Math.abs(ratioForm.pdf - (10 / 25000 + 10 / 15000) / 2) < 1e-12)
  assert.notEqual(sumForm.pdf, ratioForm.pdf)
})

test('hand-worked: Class A $500k vs Class B $876k, break-even PDF 0.000876', () => {
  const monthly = expandMonthlyGA(GA_CONFIG, BILLING)
  assert.equal(monthly.length, 12)
  assert.equal(monthly[0].month, '2026-07')
  assert.equal(monthly[11].month, '2027-06')

  const exposure = computeGAExposure(0.0005, monthly)
  assert.ok(Math.abs(exposure.annualDollars - 500000) < 1e-6)

  const cmp = compareClassAvsClassB(0.0005, 87_600_000, monthly, 0.01)
  assert.ok(Math.abs(cmp.classADollars - 500000) < 1e-6)
  assert.equal(cmp.classBDollars, 876000)
  assert.ok(Math.abs(cmp.breakevenPdf - 0.000876) < 1e-12)
  assert.equal(cmp.recommendedClass, 'A')
  assert.ok(Math.abs(cmp.savingsDollars - 376000) < 1e-6)
})

test('default plan (null target) = no curtailment: full baseline, zero savings', () => {
  const { perPeak } = computePDF(HOURLY_AT_CPS, CPS)
  const s = savingsByCoincidentPeak(perPeak, 1_000_000_000) // default plan
  assert.equal(s.totalSavingDollars, 0)
  assert.ok(Math.abs(s.totalBaselineDollars - 500000) < 1e-6)
})

test('hand-worked: per-CP savings are exactly additive; 3-of-5 curtailment banks $240k', () => {
  const { perPeak } = computePDF(HOURLY_AT_CPS, CPS)
  const baseline = savingsByCoincidentPeak(perPeak, 1_000_000_000, { mode: 'global', targetMw: 10 })
  // no curtailment: contributions $100k each, summing to the $500k Class A total
  for (const r of baseline.rows) assert.ok(Math.abs(r.baselineDollars - 100000) < 1e-6)
  assert.ok(Math.abs(baseline.totalBaselineDollars - 500000) < 1e-6)
  assert.equal(baseline.totalSavingDollars, 0)

  // curtail CP1–CP3 to 2 MW, leave CP4–CP5 untouched
  const plan = { mode: 'perCp', targets: { 1: 2, 2: 2, 3: 2, 4: 10, 5: 10 } }
  const s = savingsByCoincidentPeak(perPeak, 1_000_000_000, plan)
  assert.ok(Math.abs(s.rows[0].savingDollars - 80000) < 1e-6)
  assert.ok(Math.abs(s.totalSavingDollars - 240000) < 1e-6)
  assert.ok(Math.abs(s.rows[2].cumulativeSavingDollars - 240000) < 1e-6)
  assert.ok(Math.abs(s.rows[4].cumulativeSavingDollars - 240000) < 1e-6)
  // residual + saving == baseline, row by row (additivity)
  for (const r of s.rows) assert.ok(Math.abs(r.residualDollars + r.savingDollars - r.baselineDollars) < 1e-9)
})

test('missing CP hour: excluded from numerator, flagged, never imputed', () => {
  const partial = HOURLY_AT_CPS.slice(0, 4) // CP5 hour absent
  const r = computePDF(partial, CPS)
  assert.equal(r.missingCount, 1)
  assert.equal(r.complete, false)
  assert.equal(r.pdf, 40 / 100000) // lower bound, not 50/100000
  const issues = validateMeterSeries(
    { hourly: partial, issues: [] },
    { start: '2025-05-01', end: '2026-04-30' },
    CPS,
  )
  assert.ok(issues.some((i) => i.severity === 'error' && /coincident peak hour/i.test(i.text)))
})

// --- meter ingestion -------------------------------------------------------

test('detectTable: sniffs delimiter, skips MV-90-style preamble, keeps data rows', () => {
  const text = [
    'Meter Data Export',
    'Account: 001-2345 Meter: X90-1',
    '',
    'Date,Time,kWh Delivered,kWh Received',
    '07/01/2025,00:15,125.0,0.0',
    '07/01/2025,00:30,130.0,0.0',
    '07/01/2025,00:45,120.0,0.0',
  ].join('\r\n')
  const t = detectTable(text)
  assert.equal(t.delimiter, ',')
  assert.deepEqual(t.header, ['Date', 'Time', 'kWh Delivered', 'kWh Received'])
  assert.equal(t.rows.length, 3)
  assert.equal(t.preamble.length, 2)
})

test('detectTable: tab-delimited works too', () => {
  const t = detectTable('Timestamp\tkW\n2025-07-01 14:00\t4200\n2025-07-01 15:00\t4300\n')
  assert.equal(t.delimiter, '\t')
  assert.equal(t.rows.length, 2)
})

test('splitLine honours quoted fields', () => {
  assert.deepEqual(splitLine('"a,b",c,"d""e"', ','), ['a,b', 'c', 'd"e'])
})

test('autoDetectMapping: split date+time, delivered/received channels, ending default', () => {
  const m = autoDetectMapping(['Date', 'Time', 'kWh Delivered', 'kWh Received'])
  assert.equal(m.timestampMode, 'split')
  assert.equal(m.quantityCol, 2)
  assert.equal(m.quantityUnit, 'kwh')
  assert.equal(m.receivedCol, 3)
  assert.equal(m.intervalEnding, true) // MV-90 convention is the default
})

test('autoDetectMapping: kVA/kVAR export offers derive-real-power', () => {
  const m = autoDetectMapping(['Read Time', 'kVA', 'kVAR'])
  assert.equal(m.deriveFromKva, true)
  assert.equal(m.kvaCol, 1)
  assert.equal(m.kvarCol, 2)
})

test('hand-worked: 4×15-min kWh readings of 100 → one hour of 0.4 MWh / 0.4 MW', () => {
  const rows = [
    ['07/01/2025', '14:15', '100', '0'],
    ['07/01/2025', '14:30', '100', '0'],
    ['07/01/2025', '14:45', '100', '0'],
    ['07/01/2025', '15:00', '100', '0'], // interval ENDING 15:00 → consumed 14:45–15:00
  ]
  const mapping = {
    timestampMode: 'split', dateCol: 0, timeCol: 1, intervalEnding: true,
    quantityCol: 2, quantityUnit: 'kwh', receivedCol: 3,
    deriveFromKva: false, intervalMinutes: null,
  }
  const n = normalizeMeterToHourly(rows, mapping)
  assert.equal(n.intervalMinutes, 15)
  assert.equal(n.hourly.length, 1)
  assert.equal(n.hourly[0].hourEnding, 15) // the 14:00–15:00 hour
  assert.ok(Math.abs(n.hourly[0].netMwh - 0.4) < 1e-12)
  assert.ok(Math.abs(n.hourly[0].netMw - 0.4) < 1e-12)
  assert.equal(n.hourly[0].partial, false)
})

test('interval-ending vs -starting toggle shifts every reading one interval', () => {
  const rows = [['07/01/2025 15:00', '600']]
  const base = {
    timestampMode: 'single', timestampCol: 0, quantityCol: 1, quantityUnit: 'kwh',
    receivedCol: null, deriveFromKva: false, intervalMinutes: 60,
  }
  const ending = normalizeMeterToHourly(rows, { ...base, intervalEnding: true })
  const starting = normalizeMeterToHourly(rows, { ...base, intervalEnding: false })
  assert.equal(ending.hourly[0].hourEnding, 15) // consumed 14:00–15:00
  assert.equal(starting.hourly[0].hourEnding, 16) // consumed 15:00–16:00
})

test('hand-worked: kW = √(kVA² − kVAR²): 5/3/4 triangle → 4 kW', () => {
  const rows = [['2025-07-01 14:00', '5', '3']]
  const mapping = {
    timestampMode: 'single', timestampCol: 0, intervalEnding: false,
    deriveFromKva: true, kvaCol: 1, kvarCol: 2, pfCol: null,
    quantityCol: null, quantityUnit: 'kw', receivedCol: null, intervalMinutes: 60,
  }
  const n = normalizeMeterToHourly(rows, mapping)
  assert.ok(Math.abs(n.hourly[0].netMw - 0.004) < 1e-12) // 4 kW = 0.004 MW
})

test('net-of-generation: delivered 500 kWh − received 200 kWh = 0.3 MWh withdrawal', () => {
  const rows = [['2025-07-01 14:00', '500', '200']]
  const mapping = {
    timestampMode: 'single', timestampCol: 0, intervalEnding: false,
    quantityCol: 1, quantityUnit: 'kwh', receivedCol: 2,
    deriveFromKva: false, intervalMinutes: 60,
  }
  const n = normalizeMeterToHourly(rows, mapping)
  assert.ok(Math.abs(n.hourly[0].netMwh - 0.3) < 1e-12)
})

test('MV-90 24:00 midnight-ending rolls to next day 00:00', () => {
  const dt = parseMeterTimestamp('07/01/2025', '24:00')
  assert.equal(dt.toISODate(), '2025-07-02')
  assert.equal(dt.hour, 0)
})

test('DST spring-forward (2026-03-08): 02:xx wall times do not exist; energy is preserved', () => {
  // 60-min interval-ending readings across the gap: 01:00→(01:00–02:00 EST),
  // 03:30 stamps parse but the 2 AM hour never appears as a bucket.
  const rows = [
    ['03/08/2026 01:00', '100'], // ending 01:00 → hour 00:00–01:00
    ['03/08/2026 02:00', '100'], // luxon resolves nonexistent 02:00 forward → 03:00, i.e. the 02:00–03:00 EST hour == 03:00 EDT ending
    ['03/08/2026 04:00', '100'],
  ]
  const mapping = {
    timestampMode: 'single', timestampCol: 0, intervalEnding: true,
    quantityCol: 1, quantityUnit: 'kwh', receivedCol: null,
    deriveFromKva: false, intervalMinutes: 60,
  }
  const n = normalizeMeterToHourly(rows, mapping)
  const totalMwh = n.hourly.reduce((s, h) => s + h.netMwh, 0)
  assert.ok(Math.abs(totalMwh - 0.3) < 1e-12, 'no energy lost across the gap')
  assert.ok(!n.hourly.some((h) => h.day === '2026-03-08' && h.hourEnding === 3 && h.hourStart.includes('T02:')),
    'no bucket claims the nonexistent 02:xx wall hour')
})

test('DST fall-back (2026-11-01): repeated 1 AM stays two offset-distinct buckets; CP lookup sums them', () => {
  const rows = [
    ['2026-11-01T01:30:00-04:00', '100'], // first pass (EDT)
    ['2026-11-01T01:30:00-05:00', '100'], // second pass (EST)
  ]
  const mapping = {
    timestampMode: 'single', timestampCol: 0, intervalEnding: false,
    quantityCol: 1, quantityUnit: 'kwh', receivedCol: null,
    deriveFromKva: false, intervalMinutes: 60,
  }
  const n = normalizeMeterToHourly(rows, mapping)
  assert.equal(n.hourly.length, 2, 'two distinct offset-qualified buckets')
  // wall-clock index (used for CP lookups) merges them
  const { pdf } = computePDF(n.hourly, [{ rank: 1, date: '2026-11-01', hourEnding: 2, ontarioMw: 20000 }])
  assert.ok(Math.abs(pdf - 0.2 / 20000) < 1e-15)
})

test('inferIntervalMinutes finds the modal spacing', () => {
  const mk = (s) => parseMeterTimestamp(s)
  assert.equal(inferIntervalMinutes([mk('2025-07-01 00:15'), mk('2025-07-01 00:30'), mk('2025-07-01 00:45')]), 15)
})

test('validate: implausible magnitude flags a unit-mapping error', () => {
  const hourly = [{ day: '2025-07-01', hourEnding: 15, netMwh: 4200, netMw: 4200, samples: 1, partial: false }]
  const issues = validateMeterSeries({ hourly, issues: [] }, null, null)
  assert.ok(issues.some((i) => i.severity === 'error' && /implausible/i.test(i.text)))
})

// --- forward mode ----------------------------------------------------------

test('hand-worked ROI: EV = P × perEventSaving − cost, ranked by EV', () => {
  // curtailable 5 MW, running-board Σ = 100,000 MW, pool $1B →
  // perEventSaving = 5/100,000 × 1e9 = $50,000
  // P=0.4 → EV = 20,000 − 5,000 = $15,000 ; P=0.01 → EV = 500 − 5,000 = −$4,500
  const peaks = [
    { date: '2026-07-08', daysOut: 3, hour: 17, predictedMw: 23000, wouldRankTop5: true, probability: 0.01 },
    { date: '2026-07-10', daysOut: 5, hour: 18, predictedMw: 24000, wouldRankTop5: true, probability: 0.4 },
  ]
  const rows = simulateCurtailmentROI({
    predictedPeaks: peaks, curtailableMw: 5, curtailmentCostPerEvent: 5000,
    annualPool: 1_000_000_000, referenceOntarioMw: 100000,
  })
  assert.equal(rows[0].date, '2026-07-10') // higher EV first
  assert.ok(Math.abs(rows[0].expectedValueDollars - 15000) < 1e-6)
  assert.equal(rows[0].worthCurtailing, true)
  assert.ok(Math.abs(rows[1].expectedValueDollars - -4500) < 1e-6)
  assert.equal(rows[1].worthCurtailing, false)
})

test('dailyCurtailmentSignal: curtail / prepare / monitor with probability attached', () => {
  const mk = (daysOut, wouldRankTop5, probability = 0.3) => ({
    date: `2026-07-${String(5 + daysOut).padStart(2, '0')}`,
    daysOut, wouldRankTop5, probability, hour: 17,
  })
  assert.equal(dailyCurtailmentSignal({ predictedPeaks: [mk(1, true)] }).level, 'curtail')
  const prep = dailyCurtailmentSignal({ predictedPeaks: [mk(4, true, 0.22)] })
  assert.equal(prep.level, 'prepare')
  assert.equal(prep.probability, 0.22)
  const mon = dailyCurtailmentSignal({ predictedPeaks: [mk(4, false)], threshold: 22234 })
  assert.equal(mon.level, 'monitor')
  assert.ok(/22,234/.test(mon.reason))
})

test('annualConsumptionKwh sums positive net energy only', () => {
  const hourly = [
    { netMwh: 1 }, { netMwh: 0.5 }, { netMwh: -0.2 }, // net export hour doesn't reduce volumetric GA base
  ]
  assert.equal(annualConsumptionKwh(hourly), 1500)
})
