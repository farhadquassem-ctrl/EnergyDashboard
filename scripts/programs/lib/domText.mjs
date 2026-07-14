// Dependency-free HTML → normalized-text + content-hash, plus a line diff.
// Used by the weekly Save-on-Energy scraper to detect when a program page's
// substance changes (rebate criteria, tiers, dollar amounts) without tripping
// on cosmetic/markup churn. Pure and unit-tested (domText.test.mjs).

import { createHash } from 'node:crypto'

const BLOCK_TAGS = /<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi

/**
 * Reduce an HTML document to the visible text that matters for change
 * detection: scripts/styles/comments removed, tags stripped, entities decoded,
 * whitespace collapsed, block boundaries kept as newlines so the diff is
 * line-oriented. Deliberately ignores <head>, nav, and footer boilerplate when
 * a `mainSelector`-ish marker is present (best-effort, regex-based — these are
 * marketing pages, not XML).
 */
export function htmlToText(html) {
  let s = String(html ?? '')
  // drop non-content regions
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<head[\s\S]*?<\/head>/gi, ' ')
  s = s.replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
  // keep block boundaries as newlines
  s = s.replace(BLOCK_TAGS, '\n')
  // strip remaining tags
  s = s.replace(/<[^>]+>/g, ' ')
  // decode the handful of entities that show up in rebate copy
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&(?:deg|#176);/gi, '°')
  // normalize whitespace per line, drop empties
  return s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

/**
 * Detect a soft-404: Save on Energy serves its "page doesn't exist" body with
 * HTTP 200, so `res.ok` alone can't catch a moved/dead page. Baseline-hashing
 * an error page poisons change detection (the first live run did exactly this
 * for three restructured URLs), so the refresh job skips pages that match.
 * Heuristic on the *normalized* text: a not-found phrase in a very short body.
 */
export function looksLikeErrorPage(text) {
  const s = String(text ?? '')
  if (s.length > 1500) return false // real program pages are thousands of chars
  return /(page\s+(doesn'?t|does\s+not)\s+exist|page\s+(was\s+)?not\s+found|\b404\b)/i.test(s)
}

export function contentHash(text) {
  return createHash('sha256').update(String(text ?? '')).digest('hex')
}

/**
 * Line-level diff between two normalized texts. Returns added/removed lines
 * (set difference — order-insensitive, which is what we want for "did the
 * substance change"), and a boolean `changed`.
 */
export function diffText(oldText, newText) {
  const a = new Set(String(oldText ?? '').split('\n').filter(Boolean))
  const b = new Set(String(newText ?? '').split('\n').filter(Boolean))
  const added = [...b].filter((l) => !a.has(l))
  const removed = [...a].filter((l) => !b.has(l))
  return { changed: added.length > 0 || removed.length > 0, added, removed }
}
