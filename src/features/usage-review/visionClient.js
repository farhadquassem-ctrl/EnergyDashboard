// Phase-2 client: POST a PII-redacted bill image to the serverless vision route
// and get structured fields back. This is the ONLY path in the Usage Review tab
// that leaves the browser, and it only runs after the user has redacted the
// image on the canvas and explicitly chosen to use it. The route is ephemeral
// (see api/parse-bill.js): nothing is stored or logged.

/**
 * @param {string} imageBase64 redacted image as a data URL or bare base64
 * @returns {Promise<{ fields: object, confidence: number, source: 'vision' }>}
 */
export async function parseWithVision(imageBase64) {
  // strip a data-URL prefix if present; the route wants bare base64 + media type
  const m = /^data:(image\/\w+);base64,(.*)$/s.exec(imageBase64)
  const mediaType = m ? m[1] : 'image/png'
  const data = m ? m[2] : imageBase64

  const res = await fetch('/api/parse-bill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64: data, mediaType }),
  })

  if (res.status === 501) {
    throw new Error('The vision fallback is not configured on this deployment (no API key set). Enter the values manually below.')
  }
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.error ?? '' } catch { /* ignore */ }
    throw new Error(`Vision parse failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}.`)
  }
  return res.json()
}
