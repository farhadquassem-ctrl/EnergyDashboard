# Spec: Forecast archive + trailing-accuracy display

> Status: **approved, ready to build** (2026-07-18). Implement on a fresh
> `claude/<topic>` branch off `main` per `docs/WORKFLOW.md`. Everything below
> was validated against the code as of this commit; line references are
> anchors, not gospel — re-check them before editing.

## Context

The backtest (`pipeline/src/backtest_horizons.js`) must use a climatology
**surrogate** for all lead times because ECCC publishes no archive of past
forecasts — and neither do we: each daily run **overwrites**
`pipeline/data/forecast_citypage.json` (gitignored). Separately, the
prospective prediction log (`public/peak-forecast/prediction_log.json`,
committed daily by the refresh Action since ~2026-07-04) is never displayed —
its scorers in `src/features/model-backtest/calculations.js`
(`computeHitRate`/`computeCalibration`/`computeTrendOverTime`) are implemented,
tested, and **unused by any UI**.

This change: **(A)** archive every downloaded ECCC citypage forecast into a
committed append-only file (the historical-forecast dataset that doesn't exist
today), **(B)** add a live trailing-accuracy panel ("x% error, trailing y
months") to the Peak Forecast tab driven by the prediction log, **(C)** tests +
verification. Consuming the archive in the backtest (replacing the surrogate)
is **v2, out of scope** — this spec only guarantees the schema supports that
lookup.

**Honesty constraint (verified in the committed log):** every row has
`actualHit: null` — no base period closes until 2027-04-30, so a "top-5 hit
rate" is unshowable for months. But `actualValue` (daily peak MW) resolves the
day after each target day, so **MW-error metrics (MAE/MAPE/bias) are computable
now**. The panel leads with those; hit rate renders as an explicit "resolves
Apr 30" pending state.

## Key design decisions

- **D1 — Archive location: `public/peak-forecast/weather_archive.json`**
  (committed, publicly served). Sits beside the two files the workflow already
  diffs/commits; follows `prediction_log.js`'s precedent of resolving
  `PUBLIC_DIR` locally for committed durable artifacts (NOT via
  `config.js FILES`, which is gitignored-intermediates only). Growth ≈ 0.6
  KB/day (~220 KB/yr) — fine for years; note pruning as far-future in the
  module header.
- **D2 — De-dupe key `${siteId}|${issuedAt ?? fetchedAt}`, keep-first** (one
  entry per distinct ECCC issuance; `issuedAt` can be null per `parseCitypage`
  fallback). Matches `mergePredictions` semantics.
- **D3 — Store parsed days, not raw XML.** `days:[{date,highC,lowC}]` is
  exactly what `predictDayPeak` consumes; raw XML is ~100× larger. Tradeoff
  (parser-bug ⇒ raw lost) documented; mitigated by the fixture-tested parser.
  Keep `sourceUrl` for provenance.
- **D4 — Enrich prediction-log rows now** with optional `weatherSource`/`tempC`
  (already present on `forecast.json`'s `predictedPeaks`) so accuracy can later
  be sliced real-forecast vs surrogate. Purely additive; `resolvePredictions`
  spreads `...p` (prediction_log.js:125) so the fields survive resolution.
- **D5 — Trailing window filters by `targetDate`** (the days being predicted),
  not `predictedAt`. Document in JSDoc.

---

## Part A — Pipeline: weather-forecast archive

### A1. New `pipeline/src/forecast_archive.js`

Clone the `prediction_log.js` structure (pure core + IO wrapper + `isMain`
entry; same `PUBLIC_DIR = join(here,'..','..','public','peak-forecast')`
derivation). Header comment: purpose, D1/D3 rationale, growth note, and the
**v2 contract**: a future `buildLeadCandidates()` (`backtest_horizons.js`
surrogate swap ~line 73) picks the newest snapshot with
`issuedAt <= (target − leadDays)` and reads
`days.find(d => d.date === targetDate)`, surrogate fallback when absent.

- `SCHEMA_VERSION = 1`; `ARCHIVE_FILE = join(PUBLIC_DIR, 'weather_archive.json')`.
- Pure, exported for tests:
  - `snapshotFromCitypage(parsed)` → `{ issuedAt, fetchedAt, siteId,
    sourceUrl: parsed.sourceUrl ?? null, days:[{date,highC,lowC}] }` — picks
    exactly these fields, throws on missing/empty `days` (never archive an
    empty snapshot).
  - `snapshotKey(s)` per D2.
  - `mergeSnapshots(existing, incoming)` — keep-first by key, idempotent,
    sorted ascending by `(issuedAt ?? fetchedAt)` then `siteId`.
- IO `updateWeatherArchive()`: throw if `FILES.forecastCitypage` missing
  (`run npm run fetch:forecast first`); load prior archive defensively
  (missing/corrupt → empty envelope, like `loadLog()`); merge; write
  `{ schemaVersion, updatedAt, siteIds:[...unique], snapshots }`
  pretty-printed; log `archive:forecast: N snapshots (+0|+1 new) -> <path>`.

Envelope example:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-18T10:05:00.000Z",
  "siteIds": ["s0000458"],
  "snapshots": [
    {
      "issuedAt": "2026-07-18T09:45:00Z",
      "fetchedAt": "2026-07-18T10:04:12.000Z",
      "siteId": "s0000458",
      "sourceUrl": "https://dd.weather.gc.ca/today/citypage_weather/ON/09/...",
      "days": [{ "date": "2026-07-18", "highC": 31, "lowC": 21 }]
    }
  ]
}
```

### A2. `pipeline/src/prediction_log.js` — enrichment

In `predictionsFromForecast()` (lines 50-60), append two optional fields to the
mapped row: `weatherSource: p.weatherSource ?? null, tempC: p.tempC ?? null`.
Do NOT touch `keyOf`/`mergePredictions`/`resolvePredictions`.

### A3. `src/types/market.js` — `ModelPrediction` typedef (~89-100)

Add optional `@property {string} [weatherSource]` and
`@property {number} [tempC]` (absent on older rows).

### A4. `pipeline/package.json`

`"archive:forecast": "node src/forecast_archive.js"` next to `fetch:forecast`.

### A5. Seed file + `.github/workflows/refresh-forecast.yml`

- **Commit a seed** `public/peak-forecast/weather_archive.json` =
  `{ "schemaVersion": 1, "updatedAt": null, "siteIds": [], "snapshots": [] }`.
  **Why:** `git diff --quiet -- <untracked file>` reports no change, so the
  workflow's diff guard would silently never commit the first archive. Seeding
  keeps the guard a plain `git diff`.
- New step right after "Fetch ECCC citypage forecast" (line 112-115), with the
  same `if: ${{ inputs.diagnose_only != true }}` guard:
  `run: npm run archive:forecast` (working-directory pipeline), with a comment
  explaining it appends to the committed append-only archive.
- Commit step: add `public/peak-forecast/weather_archive.json` to **both** the
  diff guard (line 135) and the `git add` (line 139); update the step name and
  the header/permissions comments (lines 28-30) that say only forecast.json is
  pushed.

### A6. `pipeline/README.md`

Short "Weather-forecast archive" section: what/where/why + v2 payoff. Brief.

---

## Part B — App: trailing-accuracy panel

### B1. `src/features/model-backtest/calculations.js` — new pure helpers (JSDoc, no React)

- `filterTrailingWindow(predictions, { modelName, months = 6, now = new Date() })`
  — rows whose `targetDate` (D5) is within the trailing `months` calendar
  months ending at `now`, inclusive; YYYY-MM-DD string compare (repo
  convention).
- `computeTrailingSummary(predictions, { modelName, months = 6, now, threshold = 0.5 })`
  → `{ months, windowStart, windowEnd, n, resolvedN, mae, mape, bias, byLead,
  hit, hitPendingN }`:
  - MW-error over rows with both `predictedValue` and `actualValue`: `mae`,
    `mape` (guard `actualValue > 0`), **signed `bias`** (the committed log
    shows consistent under-prediction — e.g. 20,750 predicted vs 23,255 actual
    — so bias is genuinely informative). All `null` when nothing resolved.
  - `byLead`: buckets from `leadTimeDays` — '1-3d', '4-7d', '8-14d' — each
    `{ bucket, n, mae, mape }`; emit empty buckets with `n:0` for a stable
    3-column UI.
  - `hit` = `computeHitRate(windowRows, { modelName, threshold })` (resolved 0
    until a base period closes); `hitPendingN` = rows resolved but
    `actualHit == null`.

### B2. `src/features/peak-forecast/hooks.js` — `usePredictionLog()`

Mirror `usePeakForecast`:
`useMarketQuery({ market:'GA', zone:'ontario', dateRange:'prediction-log' }, loadPredictionLog)`
where the loader calls `fetchPredictionLog({ bustCache })` from
`src/lib/ieso/predictionLog.js`. **Caveat:** `fetchPredictionLog` never rejects
(missing log = normal "not accrued yet" → empty predictions) — do not copy any
throw-on-error wrapper.

### B3. New `src/features/peak-forecast/components/TrailingAccuracyPanel.jsx`

Props `{ predictions, updatedAt }`; internal state `months` (3/6/12, default
6). Match `AccuracyPanel.jsx` card + honesty conventions; **both themes**
(light unprefixed + `dark:`).

1. Header "Live accuracy — trailing record", subtitle distinguishing it from
   the backtest panel ("prospective prediction log · scored as reality
   arrives").
2. 3/6/12-month segmented control styled like the Horizon selector
   (`index.jsx:105-119`, `bg-sky-500/15 text-sky-700 …` active state).
3. Headline from `computeTrailingSummary(..., { modelName: 'ga-5cp-peak' })`:
   MAPE as "±X% mean peak-MW error", sub-stats MAE (MW), signed bias ("model
   runs ~N MW low/high"), "n = N predictions resolved".
4. By-lead 3-column stat row (MAPE + n per bucket), `tabular-nums`, `title`
   tooltips.
5. Hit-rate section: real recall/precision from `hit` when
   `hit.resolved > 0`; else a **neutral zinc** pending state: "Top-5 hit rate:
   pending — a day's top-5 outcome is only final when its base period closes
   (Apr 30). {hitPendingN} resolved predictions await that close." Never fake
   a number.
6. Empty state when `resolvedN === 0`: TabEmpty-style "The prospective log is
   young — predictions accrue daily; errors appear once target days pass."
7. Footnote (`text-[11px] text-zinc-500`): "Unlike the backtest panel above
   (recomputed from history), these are the model's real, timestamped
   predictions scored against what happened."

### B4. `src/features/peak-forecast/index.jsx` — mount

Call `usePredictionLog()` alongside `usePeakForecast()`; **must not gate the
tab** — render
`{logData && <TrailingAccuracyPanel predictions={logData.predictions} updatedAt={logData.updatedAt} />}`
directly after `<AccuracyPanel …/>` (line 152-156), before the closing
footnote.

---

## Part C — Tests

**Pipeline** — new `pipeline/src/forecast_archive.test.js` (pure core, modeled
on `prediction_log.test.js`): field-picking + throw-on-empty-days; merge
idempotency; append + ascending sort; keep-first on same key with different
days; null-`issuedAt` → `fetchedAt` key fallback; fixture round-trip
`parseCitypage(fixtures/citypage_sample_SYNTHETIC.xml)` →
`snapshotFromCitypage` → `mergeSnapshots`. Extend `prediction_log.test.js` for
`weatherSource`/`tempC` passthrough + null defaults.

**App** — extend `src/features/model-backtest/calculations.test.js` (reuse its
row factory): trailing-window inclusive boundary / exclusion / modelName filter
/ empty input; MAE/MAPE/bias on hand-checked rows; unresolved rows in `n` not
`resolvedN`; all-null metrics when nothing resolved; lead bucketing (2/5/10
days) + `n:0` empty bucket; `actualHit:null` → `hit.resolved === 0` + correct
`hitPendingN`.

## Ordering

1. A1 module + A4 script + pipeline tests.
2. A2/A3 enrichment + tests.
3. A5 seed file.
4. A5 workflow edits.
5. B1 helpers + tests.
6. B2/B3/B4.
7. Full test suites + dev-server check; commit, push, merge to `main` per
   `docs/WORKFLOW.md`.

## Verification

Sandbox (no ECCC/IESO egress):

- `cd pipeline && npm test`; root `npm test` + `npm run typecheck`.
- Offline archive dry-run:
  `node src/fetch_forecast.js --parse fixtures/citypage_sample_SYNTHETIC.xml`
  (existing offline mode, fetch_forecast.js:145-150) confirms the parse shape;
  exercise `updateWeatherArchive()` against a hand-made
  `data/forecast_citypage.json` (uncommitted).
- `npm run dev` → Peak Forecast tab: panel renders under AccuracyPanel with
  **real numbers** (the committed log already has resolved MW rows); hit
  section shows pending state; 3/6/12 toggle; dark + light; with the log fetch
  failing (rename), tab unaffected and panel absent/empty.

First real verification = next Action run (or manual dispatch, `diagnose_only`
unchecked):

- Log line `archive:forecast: 1 snapshots (+1 new)`; bot commit touches
  `weather_archive.json`; snapshot matches that morning's weather.gc.ca
  Toronto page.
- Next day appends (not replaces); same-day re-dispatch adds nothing
  (idempotency in production).
- Deployed `/peak-forecast/weather_archive.json` fetchable; panel live.
- One dispatch with `diagnose_only: true`: archive step skipped, no commit.

## Out of scope (say so in comments/commit message)

v2 backtest swap to archived real forecasts (needs ≥1 summer of accrual;
contract in module header) · CaSPAr / gated archives · backfilling (impossible
— the point of starting now) · raw-XML retention, pruning, multi-site ·
calibration/Brier UI (meaningless until `actualHit` populates) ·
accuracy-by-weatherSource UI slicing (data accrues via A2; display later).
