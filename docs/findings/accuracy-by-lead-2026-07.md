# Root-cause finding: near-zero `accuracyByLead` (2026-07)

Investigation deliverable for `docs/prompts/investigate-low-accuracy-by-lead.md`.
Reproduced on a GitHub Actions runner (workflow `refresh-forecast.yml`, new
`diagnose_only` dispatch mode, run
[28726900170](https://github.com/farhadquassem-ctrl/EnergyDashboard/actions/runs/28726900170),
2026-07-05, `PIPELINE_START=2020-05-01`, 6 evaluated base years 2021–2026).
The full per-year `backtest_horizons.json` is dumped in that run's log.

## The decisive diagnostic table (pooled Σhits/Σtruths across 6 base years)

| lead | day-recall (CP day flagged at all) | Balanced windowed recall | CP-hour temp-filter survival |
|------|-----------------------------------|--------------------------|------------------------------|
| **0d** (observed weather) | **93 %** (27/29) | **72 %** (21/29) | 97 % (28/29) |
| 3d (surrogate) | 7 % (2/29) | 3 % (1/29) | 55 % (16/29) |
| 7d (surrogate) | 3 % (1/29) | 3 % (1/29) | 48 % (14/29) |
| 14d (surrogate) | 0 % (0/29) | 0 % (0/29) | 55 % (16/29) |

Per-year lead-0 Balanced recall: 40 / 80 / 60 / 100 / 100 / 50 % — reproduces
the CLAUDE.md v1 baseline (40–100 %) exactly.

## Verdict, by hypothesis

- **H6 (regression) — RULED OUT.** Lead-0 is healthy (93 % day / 72 % windowed,
  R² 0.53–0.61 per year). The labels, joins, and hour alignment are fine. Not
  stop-ship.
- **H2 (hour-window misalignment) — RULED OUT.** Day-recall ≈ windowed recall
  at every surrogate lead (7→3, 3→3, 0→0). When the right day is flagged, the
  window usually contains the hour; the model fails earlier, at day *ranking*.
- **H1 (surrogate weather flattens the extremes) — DOMINANT.** The collapse is
  93 % → 7 % between observed weather and a 3-day surrogate. Climatology +
  decayed anomaly persistence (τ = 5 d) simply cannot tell the specific
  heat-wave day from its neighbours, so the top-15 flagged days are the wrong
  days. This is the honest degradation the code already defends — per the
  guardrails, **nothing was tuned**.
- **H3 (candidate temp filter drops real CP hours) — REAL, SECONDARY.** Under
  surrogate temps only ~half of actual CP hours survive `temp ≥ 25 °C`
  (48–55 % vs 97 % at lead 0). It compounds H1 but is not binding: at 14d
  survival is 55 % yet day-recall is 0 % — ranking, not the gate, is the
  constraint. Left unchanged (softening it for scoring would flatter the metric
  the honesty mandate says not to flatter; the live path's real forecasts have
  materially better survival).
- **H5 (small samples) — PRESENT.** 29 positives across 6 years; per-year
  recalls are 0-or-20 % lumps. Addressed by emitting pooled Σ/Σ counts
  (`pooled` in `accuracyByLead`) alongside the yearly spread.
- **H4 (metric frame) — CONFIRMED IN FRAME A.** The operator's read was right:
  the live forecast's ~1 % P(top-5) and `wouldRankTop5:false` "monitor" calls
  are *correct behavior* — both July days sat below the running #5 (22,234 MW).
  The calibration agrees the surrogate percentile carries no signal at long
  leads: logistic slopes are 2.48 (3d), **−1.50 (7d), −0.34 (14d)** — at 7/14
  days the fit collapses to the ~1.4 % base rate. A decision-frame metric
  (curtail-call precision / peaks-protected) can now be built from the
  prospective `prediction_log.json` as it accrues; recall stays the backtest
  headline with the ceiling row for context.

## What shipped (reframe, per decision-tree branch 1)

- `backtest_horizons.js` emits the day-vs-window split, CP-hour filter
  survival, and pooled counts; prints the table + branch guide every run.
- `forecast.json` (schemaVersion 2): `accuracyByLead[lead]` gains
  `top5DayRecall` + `pooled`; new envelope field `accuracyBaseline` = the
  lead-0 ceiling. Additive; v1 consumers unaffected.
- `AccuracyPanel` reframed: dashed **"0-day / known weather" ceiling bar**
  anchors the chart; surrogate bars use pooled recall with counts in the
  tooltip; captions now say the gap is the measured cost of weather
  uncertainty, 3/7-day are lower bounds vs the live ECCC path, and **14-day ≈
  0 % by design (climatology only)** — a bare "0 %" can no longer read as
  "model broken". Falls back gracefully on v1 files (no ceiling bar, yearly
  means) until the next daily refresh regenerates the JSON.

## Follow-ups (not done here, deliberately)

- Decision-frame metric (H4) from the prospective log once it has resolved
  base periods — model-agnostic scorers already exist
  (`features/model-backtest/calculations.js`).
- If 3/7-day live skill matters commercially: acquire a real forecast archive
  (ECCC CaSPAr is registration-gated) and rerun the backtest with actual NWP
  forecasts instead of the surrogate lower bound.
