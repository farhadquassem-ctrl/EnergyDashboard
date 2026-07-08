import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBillText, parseDateToken } from './billParsing.js'

test('parseDateToken handles the common bill date formats', () => {
  assert.equal(parseDateToken('Jun 1, 2026'), '2026-06-01')
  assert.equal(parseDateToken('June 1 2026'), '2026-06-01')
  assert.equal(parseDateToken('2026-06-01'), '2026-06-01')
  assert.equal(parseDateToken('06/01/2026'), '2026-06-01') // North American M/D/Y
  assert.equal(parseDateToken('not a date'), null)
})

// A representative Ontario TOU bill as OCR might return it.
const TORONTO_HYDRO = `
ELECTRICITY BILL - Toronto Hydro
Account Number: 123 456 7890
Meter Number: M-4483920
Billing Period: Jun 1, 2026 to Jul 2, 2026
Your Electricity Usage this period:
Off-Peak    480 kWh @ 7.6c
Mid-Peak    180 kWh @ 12.2c
On-Peak     140 kWh @ 15.8c
Total Usage 800 kWh
Ontario Electricity Rebate -23.5%
Total Amount Due: $164.32
`

test('parses a full TOU bill with high confidence', () => {
  const { fields, confidence, missing } = parseBillText(TORONTO_HYDRO)
  assert.equal(fields.meterId, 'M-4483920')
  assert.equal(fields.startDate, '2026-06-01')
  assert.equal(fields.endDate, '2026-07-02')
  assert.equal(fields.offPeakKwh, 480)
  assert.equal(fields.midPeakKwh, 180)
  assert.equal(fields.onPeakKwh, 140)
  assert.equal(fields.totalKwh, 800)
  assert.equal(fields.totalBilledAmount, 164.32)
  assert.equal(fields.ratePlan, 'TOU')
  assert.equal(confidence, 1)
  assert.deepEqual(missing, [])
})

test('the account number does not get mistaken for the meter id', () => {
  assert.equal(parseBillText(TORONTO_HYDRO).fields.meterId, 'M-4483920')
})

test('off-peak is not misread as on-peak (word-boundary anchor)', () => {
  const { fields } = parseBillText('Off-Peak 500 kWh\nOn-Peak 100 kWh')
  assert.equal(fields.offPeakKwh, 500)
  assert.equal(fields.onPeakKwh, 100)
})

test('detects the ULO plan', () => {
  assert.equal(parseBillText('Ultra-Low Overnight 900 kWh\nOn-Peak 50 kWh').fields.ratePlan, 'ULO')
})

test('a garbled bill missing the TOU buckets scores low confidence and reports what is missing', () => {
  const { confidence, missing } = parseBillText('Some receipt\nAmount Due: $50.00\nMeter 8899')
  assert.ok(confidence < 0.7, `confidence ${confidence}`)
  assert.ok(missing.includes('offPeakKwh') && missing.includes('startDate'))
})

test('date-range fallback: earliest→start, latest→end when no explicit "period" label', () => {
  const { fields } = parseBillText('Read on 2026-03-05 ... previous read 2026-02-03 ... Off-Peak 10 Mid-Peak 5 On-Peak 5')
  assert.equal(fields.startDate, '2026-02-03')
  assert.equal(fields.endDate, '2026-03-05')
})
