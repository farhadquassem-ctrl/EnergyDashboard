// Tiny fetch wrappers with bounded retries. Uses Node's global fetch (Node 18+).
// These run on your machine / a GitHub runner — the Claude Code sandbox blocks
// egress to reports-public.ieso.ca and api.weather.gc.ca.
//
// The retry budget matters more than it looks. `.github/workflows/refresh-forecast.yml`
// chains every fetch step and aborts the whole run on the first throw (by
// design — a partial run must never publish a half-built forecast.json), so a
// momentary upstream blip costs a day of dashboard freshness. Run
// 33317650516 (2026-08-30) died exactly that way: api.weather.gc.ca was briefly
// unreachable and the old policy (3 tries, 1s/2s/4s) gave up after ~38 seconds.
//
// The budget below spans ~2 minutes of intermittent failure per URL instead.
// It is deliberately not larger: a genuinely down upstream should still fail
// the run promptly and loudly rather than grinding through a long budget on
// every URL, and a failed run self-heals on the next day's schedule (or a
// manual workflow_dispatch). Widen `tries`/`baseDelayMs` if blips get longer.

const UA = 'ieso-peak-pipeline/0.1 (portfolio backtest)'

export const RETRY_DEFAULTS = {
  tries: 5,
  baseDelayMs: 5000, // 5s, 10s, 20s, 30s (capped) between attempts, jittered
  maxDelayMs: 30_000,
  // Per attempt, so a socket that opens and then stalls can't hold the job
  // open until the workflow's own timeout. ~10x the normal whole-step time.
  timeoutMs: 90_000,
}

/** An upstream that answered, but not with 2xx. Carries the status so the
 *  retry policy can tell "come back later" apart from "never going to work". */
export class HttpError extends Error {
  constructor(status, url, retryAfterMs = null) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** `Retry-After` is either delta-seconds or an HTTP-date. Ignore nonsense. */
export function parseRetryAfter(header, now = Date.now()) {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return secs >= 0 ? Math.min(secs * 1000, RETRY_DEFAULTS.maxDelayMs) : null
  const at = Date.parse(header)
  if (Number.isNaN(at)) return null
  return Math.min(Math.max(at - now, 0), RETRY_DEFAULTS.maxDelayMs)
}

// undici reports every transport problem as a bare "fetch failed"; the real
// cause (DNS, TLS, connect timeout, reset) sits one or two levels down in
// `cause`. Run 33317650516's log said only "fetch failed", which is why
// diagnosing it took guesswork — unwrap the chain into the message instead.
export function describeError(err) {
  const parts = []
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    const code = e.code ? ` (${e.code})` : ''
    const text = `${e.message ?? e}${code}`
    if (text.trim() && !parts.includes(text)) parts.push(text)
    // Happy Eyeballs bundles the per-address failures into an AggregateError.
    if (Array.isArray(e.errors)) {
      for (const sub of e.errors) {
        const subText = `${sub.message ?? sub}${sub.code ? ` (${sub.code})` : ''}`
        if (!parts.includes(subText)) parts.push(subText)
      }
    }
  }
  return parts.join(' <- ')
}

/** 4xx is the request's own fault and will fail identically next time — don't
 *  burn the budget on it. Everything transport-level is worth another go. */
export function isRetryable(err) {
  if (err instanceof HttpError) {
    if (err.status === 408 || err.status === 425 || err.status === 429) return true
    return err.status >= 500
  }
  return true
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function withRetry(fn, opts = {}) {
  const { tries, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...opts }
  const label = opts.label ?? 'request'
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const why = describeError(err)
      // Bail without sleeping first: the old loop always waited out one more
      // backoff after the final attempt, and logged a "retrying" line for a
      // retry that never happened.
      if (attempt >= tries || !isRetryable(err)) {
        console.error(`  ${label} failed (attempt ${attempt}/${tries}): ${why}; giving up`)
        throw err
      }
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      // Jitter to 50-100% of the backoff so parallel callers don't all hit a
      // recovering upstream on the same tick.
      const wait = err.retryAfterMs ?? Math.round(backoff * (0.5 + Math.random() / 2))
      console.warn(`  ${label} failed (attempt ${attempt}/${tries}): ${why}; retrying in ${wait}ms`)
      await sleep(wait)
    }
  }
}

async function request(url, headers, opts) {
  const timeoutMs = opts.timeoutMs ?? RETRY_DEFAULTS.timeoutMs
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new HttpError(res.status, url, parseRetryAfter(res.headers.get('retry-after')))
  return res
}

export function fetchText(url, opts = {}) {
  return withRetry(() => request(url, {}, opts).then((r) => r.text()), { ...opts, label: opts.label ?? url })
}

export function fetchJson(url, opts = {}) {
  return withRetry(
    () => request(url, { Accept: 'application/json' }, opts).then((r) => r.json()),
    { ...opts, label: opts.label ?? url },
  )
}
