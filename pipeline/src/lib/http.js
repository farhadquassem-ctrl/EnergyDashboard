// Tiny fetch wrappers with a couple of retries. Uses Node's global fetch
// (Node 18+). These run on your machine / a server — the Claude Code sandbox
// blocks egress to reports-public.ieso.ca and api.weather.gc.ca.

const UA = 'ieso-peak-pipeline/0.1 (portfolio backtest)'

async function withRetry(fn, { tries = 3, label = 'request' } = {}) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const wait = 1000 * 2 ** i
      console.warn(`  ${label} failed (attempt ${i + 1}/${tries}): ${err.message}; retrying in ${wait}ms`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

export function fetchText(url) {
  return withRetry(
    async () => {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return res.text()
    },
    { label: url },
  )
}

export function fetchJson(url) {
  return withRetry(
    async () => {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return res.json()
    },
    { label: url },
  )
}
