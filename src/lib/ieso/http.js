// Shared HTTP helper for every lib/ieso adapter: JSON GET against our own
// /api/ieso serverless proxy (or a static file) with an abort timeout.
// Adapters own their fallback behavior; this just fetches.

export const DEFAULT_TIMEOUT_MS = 8000

export async function getJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`API ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}
