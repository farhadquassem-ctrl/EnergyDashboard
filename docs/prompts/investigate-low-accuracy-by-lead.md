# Prompt — Investigate near-zero measured forecast accuracy (`accuracyByLead`), then fix or reframe

**Run this on a branch off `main`.** This is a diagnosis-first task: find the root
cause of the near-zero measured peak-forecast accuracy the first live refresh
surfaced, *then* choose a path forward from the decision tree below. **Do not
"fix the number" before you know which cause you're looking at** — several
candidate causes are expected/honest behavior that must be *labelled*, not tuned
away, and exactly one is a stop-ship regression. Read **`CLAUDE.md`** (the
honesty mandate and the "never re-rank raw demand" rule) and
**`docs/ARCHITECTURE.md §8`** (accuracy is embedded in Peak Forecast,
model-agnostic underneath) before touching anything.

---

## What triggered this

The `refresh-forecast.yml` run on 2026-07-04 (run `28721611841`) shipped real
`accuracyByLead` for the first time (it had been `null`). It came back very low,
and it now renders on the **live** Peak Forecast accuracy panel:

| lead | balanced top-5 recall — min / mean / max (6 base yrs) |
|------|------------------------------------------------------|
| 3d   | 0 / 0.03 / 0.20 |
| 7d   | 0 / 0.03 / 0.20 |
| 14d  | 0 / 0 / 0 |

The same run's forecast `predictedPeaks` came back at **P(top-5) ≈ 1%**, both
below the running #5 threshold (22,234 MW): Jul 8 @ 20,750 MW, Jul 9 @ 19,727 MW
— so both were correctly labelled `wouldRankTop5: false` ("monitor", not
"curtail"). Compare CLAUDE.md's documented lead-0 backtest: R² 0.53–0.61,
flagged-window top-5 recall **40–100%**. So the multi-horizon numbers are an
order of magnitude lower than the lead-0 baseline — that gap is what to explain.

---

## Two "low numbers" — do not conflate them

- **(A) Forecast `predictedPeaks` probabilities (~1%).** Per-day calibrated
  P(top-5) from `peak_probability.js` (`probabilityFor`), plus the
  `wouldRankTop5 = predictedMw > threshold` curtail/monitor flag in
  `forecast.js`.
- **(B) Backtest `accuracyByLead` recall (~3%, 0 at 14d).** The walk-forward
  `balancedTop5Recall` from `backtest_horizons.js` (`evaluateLead`), aggregated
  in `forecast.js:aggregateBacktest`.

**This investigation is primarily about (B).** (A) is context, and — see the
operator hypothesis below — is very likely *already correct*.

---

## The operator's hypothesis — test this first, it reframes the metric

> "When predicting peaks, once you have a top 5, a prediction lower than CP #5
> doesn't really count."

Resolve it explicitly in both frames:

- **Where it is already true and working (frame A).** `forecast.js` computes
  `cracksTop5(mw) = mw > threshold` (running #5) and only flags
  `wouldRankTop5` days as curtailment targets; a sub-#5 prediction correctly
  becomes "monitor." And P(top-5) is a percentile-within-lead logistic, so a
  sub-threshold summer day scores low *by design*. **The ~1% forecast numbers
  are therefore expected, not a bug** — confirm this and state it.
- **Where it does NOT literally apply (frame B).** `evaluateLead` flags the
  **top-15 predicted days** and scores recall of the actual CP hours inside
  their risk windows. There is **no MW/#5 threshold** in that metric — a flagged
  day counts regardless of magnitude. So the operator's rule does not
  mechanically drive the low `accuracyByLead`.
- **The real question it raises (H4 below).** Is "recall of all 5 CP hours" even
  the right *headline* metric for a running-board 5CP tool, or should scoring be
  reframed around the operational decision — "would this upcoming day beat the
  running #5, and did we act on it"? Carry this as a first-class hypothesis, not
  an afterthought.

---

## Reproduce (data is not committed — run where the fetch chain can)

`peak_dataset.csv` and `backtest_horizons.json` are generated, not committed, and
IESO/ECCC are sandbox-blocked. Reproduce on the user's machine or a CI runner:

```
cd pipeline
PIPELINE_START=2020-05-01 npm run fetch:demand && npm run fetch:weather && npm run fetch:peaks
PIPELINE_START=2020-05-01 npm run build
PIPELINE_START=2020-05-01 npm run backtest:horizons   # -> data/backtest_horizons.json
PIPELINE_START=2020-05-01 npm run calibrate           # -> data/peak_probability.json + calibration_report.html
```

Keep `data/backtest_horizons.json` — its per-year `horizons[]` carry the fields
the summary throws away.

---

## The decisive diagnostic: surface the day-vs-window split

`evaluateLead` **already computes `top5DayRecall`** (was the actual CP day
flagged *at all*, before the 3–5h window) but `aggregateBacktest` only surfaces
the windowed `balancedTop5Recall`. Emit both, per lead, plus supporting counts:

- `top5DayRecall` (day flagged) vs `balancedTop5Recall` (day flagged **and** CP
  hour inside the window).
- `candidateHours` per lead, and **how many actual CP hours survive the forecast
  temperature candidate filter** (`isCandidateRow` on surrogate temp) — a CP hour
  the surrogate filters out is an automatic, uncatchable miss; quantify it.
- The **lead-0 (observed weather) row** as the ceiling — it should reproduce the
  40–100% CLAUDE.md baseline. If lead-0 is *also* near zero, jump to H6.

That one split (`top5DayRecall` vs windowed) picks the branch:

- **day-recall decent, windowed ≈ 0** → hour-window misalignment (H2).
- **day-recall also ≈ 0, lead-0 fine** → day ranking loses skill with lead →
  surrogate-weather driven (H1) or candidate-filter loss (H3).
- **lead-0 also ≈ 0** → regression (H6), the only stop-ship branch.

---

## Ranked hypotheses (each: signature → path)

- **H1 — Surrogate weather flattens the extremes.** Climatology+persistence
  smooths a CP-day heat wave toward normal, so the CP day isn't top-ranked.
  *Signature:* lead-0 recall high; monotonic decay 3→7→14 toward 0; 14d≈0
  (persistence fully decayed to climatology); day-recall ≈ windowed. *Path:* this
  is the **honest degradation the code already defends** — do **not** tune tau or
  filters to lift it (CLAUDE.md). Reframe/label instead (see decision tree).
- **H2 — Hour-window misalignment.** Right day flagged, wrong predicted peak
  *hour*, so the narrow window misses the CP hour. *Signature:* `top5DayRecall`
  ≫ windowed recall. *Path:* improve peak-hour prediction or re-center/widen the
  window; legitimate accuracy fix.
- **H3 — Candidate temp-filter drops real CP hours.** Under surrogate temp, an
  actual CP hour fails `temp_c ≥ 25 || ≤ 10` and never enters the candidate set.
  *Signature:* actual CP hours absent from `candidates`; nonzero "CP hours
  excluded" count. *Path:* soften/remove the hard temp gate for *scoring* (keep
  it for candidate generation if needed), or widen thresholds — but only if it's
  a scoring artifact, not real.
- **H4 — Metric frame mismatch (the operator's point).** Recall of all 5 CP
  hours vs. the running-board decision "would this upcoming day beat #5, and did
  we curtail it." *Signature:* recall low yet curtail-precision / peaks-protected
  looks reasonable. *Path:* add a decision-relevant metric (precision of curtail
  calls; CP hours protected; $ at risk covered) and consider promoting it to the
  headline, keeping recall secondary.
- **H5 — Small-sample noise.** ~5 positives/year × few evaluated years → a mean
  near 0 is dominated by structural scarcity. *Signature:* wide spread (min 0,
  max 0.2), unstable across years. *Path:* report pooled recall + CIs, more base
  years; don't over-read the mean.
- **H6 — Genuine regression (STOP-SHIP).** Peak-label hour shift regressed (see
  the `iciPeakToDateTime` DST bug in CLAUDE.md), day-key timezone mismatch, or a
  broken `is_top5_peak` join. *Signature:* **lead-0 recall also low/degenerate**,
  R² off, or `actualTop5` counts ≠ ~5/year. *Path:* fix before it sits on prod;
  revert the live panel to "—" until fixed.

---

## Decision tree — path forward per root cause

1. **H1 dominant (most likely, and expected):** don't chase recall upward.
   (a) Relabel the panel so near-zero reads honestly — e.g. "14-day = climatology
   only; catching a specific day this far out is near-impossible by design."
   (b) Lead with the lead-0 / 3-day rows and note the **live** path uses the real
   ECCC citypage forecast (`fetch_forecast.js`), which beats the backtest
   surrogate at 3–7 days, so live 3-day ≥ this lower bound. (c) Consider not
   surfacing a bare "0%" for 14-day without that caption.
2. **H2:** ship the hour-prediction/window fix; re-measure.
3. **H3:** soften the scoring-side candidate filter; re-measure; document.
4. **H4:** add the running-board metric; make the panel answer "would we have
   curtailed the right days," not only "did we recall every CP hour."
5. **H6:** treat as a regression — fix, and pull the live panel back to "—"
   (as it was pre-refresh) until the fix lands.

Most likely outcome is a **combination**: H1 explains the floor, H5 explains the
volatility, and either H2 or H4 is the real lever — so the deliverable is
probably *both* an honest relabel **and** one substantive metric/hour fix.

---

## Guardrails (from CLAUDE.md / ARCHITECTURE.md)

- **Honesty mandate:** never tune `ANOMALY_TAU_DAYS`, the temp thresholds, or the
  window widths *against recall*. The degradation curve must stay honest.
- **Never re-rank raw demand** to find peaks — use the pipeline's IESO peak
  labels.
- All logic stays **pipeline-side**; the Peak Forecast tab is a pure renderer of
  `forecast.json`. If a new metric is added, thread it through the JSON schema
  (bump `schemaVersion`) and the model-agnostic
  `features/model-backtest/calculations.js`.
- The live tab must **never** show a misleadingly precise "0% accurate" without
  the context that explains it.

---

## Deliverable

A written root-cause finding (which hypothesis, with the diagnostic table:
`top5DayRecall` vs windowed recall vs lead-0 ceiling, CP-hour candidate survival,
per-year spread), surfaced in the run output / PR so a human can check it; **plus**
either a fix PR or a reframe PR (panel copy + any new metric) per the decision
tree. Report every methodology decision and any contract deviation.
