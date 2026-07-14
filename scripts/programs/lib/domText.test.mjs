import { test } from 'node:test'
import assert from 'node:assert/strict'
import { htmlToText, contentHash, diffText, looksLikeErrorPage } from './domText.mjs'

const PAGE_V1 = `
<html><head><title>ignored</title><style>.x{color:red}</style></head>
<body>
<nav>Home | Business | Contact</nav>
<main>
<h1>Peak Perks</h1>
<p>Get $75 to enroll and $20 per year.</p>
<ul><li>Central A/C required</li><li>Smart thermostat required</li></ul>
</main>
<footer>© 2026 Save on Energy</footer>
<script>analytics()</script>
</body></html>`

// same substance, different markup/boilerplate → NO change
const PAGE_V1_RESKIN = `
<html><head><title>totally different</title></head>
<body><header>new promo banner</header>
<section><h1>Peak&nbsp;Perks</h1>
<div>Get $75 to enroll and $20 per year.</div>
<div>Central A/C required</div><div>Smart thermostat required</div></section>
<footer>different footer</footer></body></html>`

// substance changed: enrollment incentive dropped to $50
const PAGE_V2 = PAGE_V1.replace('$75', '$50')

test('htmlToText strips scripts/styles/nav/footer and keeps content lines', () => {
  const t = htmlToText(PAGE_V1)
  assert.match(t, /Peak Perks/)
  assert.match(t, /\$75 to enroll/)
  assert.doesNotMatch(t, /analytics/)
  assert.doesNotMatch(t, /color:red/)
  assert.doesNotMatch(t, /Save on Energy/) // footer dropped
  assert.doesNotMatch(t, /Home \| Business/) // nav dropped
})

test('cosmetic reskin with the same substance produces the same hash', () => {
  assert.equal(contentHash(htmlToText(PAGE_V1)), contentHash(htmlToText(PAGE_V1_RESKIN)))
})

test('a real criteria change flips the hash and the diff reports it', () => {
  const a = htmlToText(PAGE_V1)
  const b = htmlToText(PAGE_V2)
  assert.notEqual(contentHash(a), contentHash(b))
  const d = diffText(a, b)
  assert.equal(d.changed, true)
  assert.ok(d.added.some((l) => /\$50/.test(l)))
  assert.ok(d.removed.some((l) => /\$75/.test(l)))
})

test('diffText: identical text → no change', () => {
  assert.equal(diffText('a\nb', 'a\nb').changed, false)
})

test('looksLikeErrorPage catches the Save on Energy soft 404 (HTTP 200 body)', () => {
  // Verbatim shape of what the first live cron run baselined for three moved URLs
  const soft404 = htmlToText(`<html><body><div>Home</div>
    <h1>Sorry but it looks like this page doesn't exist</h1>
    <p>Don't let this drain your energy. Please return to our homepage .</p></body></html>`)
  assert.equal(looksLikeErrorPage(soft404), true)
  // A real program page must NOT be treated as dead
  assert.equal(looksLikeErrorPage(htmlToText(PAGE_V1)), false)
  // Long marketing copy that happens to include "not found" is still a real page
  assert.equal(looksLikeErrorPage('page not found '.padEnd(2000, 'x')), false)
})
