// Unit tests for the retry policy. Run: npm test (node --test).
// No network: withRetry is exercised against fake work functions, and delays
// are zeroed so the suite stays instant.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry, isRetryable, describeError, parseRetryAfter, HttpError } from './http.js'

// The retry loop is deliberately chatty in CI; keep the test output readable.
const real = { warn: console.warn, error: console.error }
beforeEach(() => { console.warn = () => {}; console.error = () => {} })
afterEach(() => { console.warn = real.warn; console.error = real.error })

const fast = { baseDelayMs: 0, maxDelayMs: 0 }

test('returns the first successful result without retrying', async () => {
  let calls = 0
  const out = await withRetry(async () => { calls++; return 'ok' }, fast)
  assert.equal(out, 'ok')
  assert.equal(calls, 1)
})

test('retries transport failures and returns once one succeeds', async () => {
  let calls = 0
  const out = await withRetry(async () => {
    calls++
    if (calls < 3) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
    return 'ok'
  }, fast)
  assert.equal(out, 'ok')
  assert.equal(calls, 3)
})

test('gives up after `tries` attempts and rethrows the last error', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => { calls++; throw new TypeError('fetch failed') }, { ...fast, tries: 5 }),
    /fetch failed/,
  )
  // The old loop also slept after the final attempt; assert we spend exactly
  // the budget and no more.
  assert.equal(calls, 5)
})

test('does not retry a 404 — it will fail identically next time', async () => {
  let calls = 0
  await assert.rejects(
    withRetry(async () => { calls++; throw new HttpError(404, 'http://x/y') }, fast),
    /HTTP 404/,
  )
  assert.equal(calls, 1)
})

test('does retry 5xx, 429 and 408', async () => {
  for (const status of [500, 503, 429, 408]) {
    let calls = 0
    await assert.rejects(
      withRetry(async () => { calls++; throw new HttpError(status, 'http://x/y') }, { ...fast, tries: 3 }),
      new RegExp(`HTTP ${status}`),
    )
    assert.equal(calls, 3, `status ${status} should have been retried`)
  }
})

test('isRetryable classifies by status, and treats transport errors as retryable', () => {
  assert.equal(isRetryable(new HttpError(400, 'u')), false)
  assert.equal(isRetryable(new HttpError(404, 'u')), false)
  assert.equal(isRetryable(new HttpError(429, 'u')), true)
  assert.equal(isRetryable(new HttpError(502, 'u')), true)
  assert.equal(isRetryable(new TypeError('fetch failed')), true)
  assert.equal(isRetryable(new DOMException('timed out', 'TimeoutError')), true)
})

test('describeError unwraps undici cause chains and AggregateErrors', () => {
  const err = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' }),
  })
  const text = describeError(err)
  assert.match(text, /fetch failed/)
  assert.match(text, /ECONNREFUSED/)

  const agg = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new AggregateError([Object.assign(new Error('v6 unreachable'), { code: 'ENETUNREACH' })], 'all failed'), {}),
  })
  assert.match(describeError(agg), /ENETUNREACH/)
})

test('parseRetryAfter handles delta-seconds, HTTP-dates and junk', () => {
  const now = Date.parse('2026-08-30T14:44:00Z')
  assert.equal(parseRetryAfter('5', now), 5000)
  assert.equal(parseRetryAfter('Sun, 30 Aug 2026 14:44:10 GMT', now), 10_000)
  assert.equal(parseRetryAfter('not-a-date', now), null)
  assert.equal(parseRetryAfter(null, now), null)
  // Never wait longer than the cap, however generous the header.
  assert.equal(parseRetryAfter('99999', now), 30_000)
})

test('a Retry-After hint overrides the computed backoff', async () => {
  const started = Date.now()
  let calls = 0
  await assert.rejects(
    withRetry(async () => { calls++; throw new HttpError(429, 'http://x/y', 20) }, { ...fast, tries: 3 }),
    /HTTP 429/,
  )
  assert.equal(calls, 3)
  assert.ok(Date.now() - started >= 40, 'should have honoured the two 20ms hints')
})
