// Pure OCR-text → structured Bill parsing (Phase 1). No React, no I/O — takes
// the raw text a client-side OCR pass (Tesseract.js) produced and heuristically
// pulls the seven fields the anomaly engine needs, plus a confidence score the
// caller uses to decide whether to fall through to the Phase-2 vision route.
//
// Ontario TOU bills vary by LDC (Toronto Hydro, Alectra, Hydro One, …), so the
// patterns are deliberately tolerant of OCR noise (stray spaces, ¢/$ glyphs,
// label/value on the same or adjacent lines). Everything here is unit-tested
// against representative bill text in billParsing.test.js.

import { DateTime } from 'luxon'

const NUM = '([0-9][0-9,]*(?:\\.[0-9]+)?)'
const toNum = (s) => (s == null ? null : Number(String(s).replace(/,/g, '')))

// Date token: "Jun 1, 2026" / "June 1 2026" / "2026-06-01" / "06/01/2026".
const DATE = '([A-Za-z]{3,9}\\.?\\s+[0-9]{1,2},?\\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4})'
const DATE_FORMATS = ['LLLL d, yyyy', 'LLL d, yyyy', 'LLLL d yyyy', 'LLL d yyyy', 'yyyy-MM-dd', 'M/d/yyyy', 'M/d/yy']

/** Parse one date token to an ISO `YYYY-MM-DD`, or null. */
export function parseDateToken(raw) {
  if (!raw) return null
  const s = raw.replace(/\./g, '').replace(/\s+/g, ' ').trim()
  for (const f of DATE_FORMATS) {
    const dt = DateTime.fromFormat(s, f)
    if (dt.isValid) return dt.toISODate()
  }
  const iso = DateTime.fromISO(s)
  return iso.isValid ? iso.toISODate() : null
}

/** First number appearing within ~25 non-digit chars after a label regex. */
function labelledNumber(text, labelSrc) {
  const re = new RegExp(labelSrc + '[^0-9\\n]{0,25}' + NUM, 'i')
  const m = text.match(re)
  return m ? toNum(m[1]) : null
}

/**
 * Parse OCR text into a partial Bill + a confidence score.
 * @param {string} text raw OCR output
 * @returns {{ fields: object, confidence: number, missing: string[] }}
 */
export function parseBillText(text) {
  const t = String(text ?? '').replace(/\r/g, '')

  // meter id — anchored on the word "meter" so the account number doesn't win
  const meterMatch = t.match(/meter\s*(?:number|no\.?|id|#)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i)
  const meterId = meterMatch ? meterMatch[1] : null

  // billing period: "… <date> to/through/– <date>"
  let startDate = null
  let endDate = null
  const period = t.match(new RegExp('(?:billing period|service period|period|from|usage from)\\s*[:\\-]?\\s*' + DATE + '\\s*(?:to|through|-|–|—|until)\\s*' + DATE, 'i'))
  if (period) {
    startDate = parseDateToken(period[1])
    endDate = parseDateToken(period[2])
  }
  if (!startDate || !endDate) {
    // fallback: collect every date token, take earliest → start, latest → end
    const all = [...t.matchAll(new RegExp(DATE, 'gi'))].map((m) => parseDateToken(m[1])).filter(Boolean).sort()
    if (all.length >= 2) { startDate = startDate ?? all[0]; endDate = endDate ?? all[all.length - 1] }
  }

  const offPeakKwh = labelledNumber(t, 'off[\\s-]*peak')
  const midPeakKwh = labelledNumber(t, 'mid[\\s-]*peak')
  const onPeakKwh = labelledNumber(t, '\\bon[\\s-]*peak')
  const totalKwh = labelledNumber(t, 'total\\s*(?:usage|consumption|kwh|electricity)')

  // total billed amount — prefer "amount due", then "total … $"
  let totalBilledAmount = null
  const due = t.match(/(?:total amount due|amount due|total due|please pay)\D{0,15}\$?\s*([0-9][0-9,]*\.[0-9]{2})/i)
  if (due) totalBilledAmount = toNum(due[1])
  if (totalBilledAmount == null) {
    const tot = t.match(/total\D{0,15}\$\s*([0-9][0-9,]*\.[0-9]{2})/i)
    if (tot) totalBilledAmount = toNum(tot[1])
  }

  const ratePlan = /ultra[\s-]*low|\bULO\b/i.test(t)
    ? 'ULO'
    : /off[\s-]*peak|mid[\s-]*peak|on[\s-]*peak|time[\s-]*of[\s-]*use|\bTOU\b/i.test(t)
      ? 'TOU'
      : /tier\s*[12]|tiered/i.test(t)
        ? 'TIERED'
        : 'UNKNOWN'

  const fields = { meterId, startDate, endDate, offPeakKwh, midPeakKwh, onPeakKwh, totalKwh, totalBilledAmount, ratePlan }

  // confidence: the five essentials (period + 3 TOU buckets) carry 85%, the two
  // nice-to-haves (meter id, amount) the last 15%. Callers fall through to the
  // vision route below ~0.7.
  const essentials = ['startDate', 'endDate', 'offPeakKwh', 'midPeakKwh', 'onPeakKwh']
  const extras = ['meterId', 'totalBilledAmount']
  const essScore = essentials.filter((k) => fields[k] != null).length / essentials.length
  const extScore = extras.filter((k) => fields[k] != null).length / extras.length
  const confidence = Math.round((essScore * 0.85 + extScore * 0.15) * 100) / 100
  const missing = [...essentials, ...extras].filter((k) => fields[k] == null)

  return { fields, confidence, missing }
}
