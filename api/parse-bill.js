// Vercel serverless route: Phase-2 vision fallback for the Usage Review tab.
//
// Accepts a PII-REDACTED bill image (the client masks name/address/account on a
// canvas first) and returns the same structured fields the client-side OCR path
// produces, extracted by a vision LLM (Claude by default).
//
// ── STRICT EPHEMERALITY (spec non-negotiable) ───────────────────────────────
// The image and every value parsed from it live ONLY in this function's memory
// for the duration of the request, then vanish when it returns. This route:
//   • writes nothing to any store, database, filesystem, or cache;
//   • logs NOTHING derived from the request body — not the image, not the
//     parsed fields, not PII. Only non-content diagnostics (a status code, a
//     provider error class) may be logged. Do not add console.log(payload).
// If you extend this file, preserve both properties.
//
// Dormant-by-default: with no ANTHROPIC_API_KEY (or OPENAI_API_KEY) configured
// it returns 501 so the client tells the user to type the values in manually.
// The Phase-1 in-browser OCR path works with no key at all.

const DEFAULT_MODEL = process.env.VISION_MODEL || 'claude-sonnet-5'
const MAX_IMAGE_BYTES = 6 * 1024 * 1024 // ~6 MB of base64 — a phone photo, not a scan farm

const EXTRACT_INSTRUCTION =
  'You are extracting structured data from a photo of an Ontario electricity bill. ' +
  'The image may have black redaction boxes over personal information — ignore those. ' +
  'Return ONLY a compact JSON object, no prose, with exactly these keys: ' +
  'meterId (string|null), startDate (YYYY-MM-DD|null), endDate (YYYY-MM-DD|null), ' +
  'offPeakKwh (number|null), midPeakKwh (number|null), onPeakKwh (number|null), ' +
  'totalKwh (number|null), totalBilledAmount (number|null), ' +
  'ratePlan ("TOU"|"ULO"|"TIERED"|"UNKNOWN"). ' +
  'Use null for any field you cannot read with confidence. Do not guess.'

const EXPECTED_KEYS = ['meterId', 'startDate', 'endDate', 'offPeakKwh', 'midPeakKwh', 'onPeakKwh', 'totalKwh', 'totalBilledAmount', 'ratePlan']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(501).json({ error: 'Vision fallback not configured (ANTHROPIC_API_KEY unset).' })
  }

  // -- read + validate body (never logged) ----------------------------------
  let imageBase64
  let mediaType
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    imageBase64 = body?.imageBase64
    mediaType = body?.mediaType || 'image/png'
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' })
  }
  if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
    return res.status(400).json({ error: 'Missing or too-small imageBase64.' })
  }
  if (imageBase64.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'Image too large; downscale before sending.' })
  }
  if (!/^image\/(png|jpe?g|webp)$/.test(mediaType)) {
    return res.status(415).json({ error: 'Unsupported image type.' })
  }

  // -- call the vision model in-memory --------------------------------------
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 500,
        temperature: 0,
        system: EXTRACT_INSTRUCTION,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: 'Extract the fields as specified. JSON only.' },
            ],
          },
        ],
      }),
    })

    if (!upstream.ok) {
      // Log only the status class — never the body (may echo request content).
      console.error(`parse-bill: vision provider returned ${upstream.status}`)
      return res.status(502).json({ error: `Vision provider error (${upstream.status}).` })
    }

    const payload = await upstream.json()
    const text = (payload?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    const fields = coerceFields(extractJson(text))
    if (!fields) return res.status(422).json({ error: 'Could not parse a structured result from the image.' })

    const filled = EXPECTED_KEYS.filter((k) => k !== 'ratePlan' && fields[k] != null).length
    const confidence = Math.round((filled / (EXPECTED_KEYS.length - 1)) * 100) / 100

    // No-store on the response too; nothing here is cacheable.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ fields, confidence, source: 'vision' })
  } catch (err) {
    console.error('parse-bill: request failed', err?.name || 'error')
    return res.status(500).json({ error: 'Vision request failed.' })
  }
}

/** Pull the first {...} JSON object out of a model reply (handles code fences). */
function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
}

/** Whitelist to the expected keys and coerce numeric fields; drop everything else. */
function coerceFields(obj) {
  if (!obj || typeof obj !== 'object') return null
  const numKeys = ['offPeakKwh', 'midPeakKwh', 'onPeakKwh', 'totalKwh', 'totalBilledAmount']
  const out = {}
  for (const k of EXPECTED_KEYS) {
    let v = obj[k]
    if (numKeys.includes(k)) {
      const n = typeof v === 'number' ? v : v == null ? null : Number(String(v).replace(/[^0-9.]/g, ''))
      out[k] = Number.isFinite(n) ? n : null
    } else {
      out[k] = v == null ? null : String(v)
    }
  }
  if (!['TOU', 'ULO', 'TIERED', 'UNKNOWN'].includes(out.ratePlan)) out.ratePlan = 'UNKNOWN'
  return out
}
