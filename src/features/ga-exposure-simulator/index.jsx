import { useMemo, useState } from 'react'
import TabShell, { TabEmpty, TabError, TabLoading } from '../../components/TabShell'
import { useMarketStore } from '../../store/marketStore.jsx'
import { forecastToGAForecasts } from '../../lib/ieso/peakForecast'
import { historicalPeaksFor, runningBoardToPeaks } from '../../lib/ieso/globalAdjustment'
import { useGAForecast, useMonthlyGA, useHistorical5CP } from './hooks'
import {
  normalizeMeterToHourly, validateMeterSeries, computePDF, expandMonthlyGA,
  computeGAExposure, compareClassAvsClassB, savingsByCoincidentPeak,
  simulateCurtailmentROI, annualConsumptionKwh, generateSampleCsv, fmtInt,
} from './calculations'
import SignalBanner from './components/SignalBanner'
import MeterUpload from './components/MeterUpload'
import PdfCard from './components/PdfCard'
import ClassComparisonCard from './components/ClassComparisonCard'
import SavingsByPeak from './components/SavingsByPeak'
import RoiTable from './components/RoiTable'
import AssumptionsPanel from './components/AssumptionsPanel'

// GA Exposure Simulator (ICI / Class A) — upload interval meter data, see the
// Peak Demand Factor it produces, Class A vs Class B dollars, savings
// decomposed by coincident peak, and probability-weighted curtailment ROI on
// the live peak forecast. All business math is pure (calculations.js); this
// file only wires data hooks + component composition.
//
// Two modes sharing the same calculations:
//   actual  — a COMPLETED base period, scored against its official final 5CP
//             (public/ga/historical_5cp.json, IESO AQEW ranks — never re-ranked)
//   forward — the in-progress base period: running board from forecast.json,
//             PDF-to-date + probability-weighted savings on predicted peaks.

// Base/billing period conventions mirror the pipeline's config.js helpers:
// base = May 1 (baseYear) – Apr 30 (baseYear+1); billed Jul 1 (baseYear+1) –
// Jun 30 (baseYear+2).
const basePeriodBounds = (y) => ({ start: `${y}-05-01`, end: `${y + 1}-04-30`, label: String(y) })
const billingPeriodBounds = (y) => ({
  start: `${y + 1}-07-01`,
  end: `${y + 2}-06-30`,
  label: `Jul ${y + 1} – Jun ${y + 2}`,
})

export default function GAExposureTab() {
  const forecastQ = useGAForecast()
  const gaQ = useMonthlyGA()
  const histQ = useHistorical5CP()
  const { customerProfile, setCustomerProfile } = useMarketStore()

  const [mode, setMode] = useState('forward')
  const [baseYear, setBaseYear] = useState(null) // actual mode; null = latest available
  const [meter, setMeter] = useState(null) // { table, mapping }
  const [pdfForm, setPdfForm] = useState('sum-over-sum')
  // null target = no curtailment (the honest starting point: show the
  // baseline exposure, let the user dial curtailment in).
  const [plan, setPlan] = useState({ mode: 'global', targetMw: null })

  const updateProfile = (patch) => setCustomerProfile({ ...customerProfile, ...patch })

  if (forecastQ.loading || gaQ.loading || histQ.loading) return <TabLoading>Loading GA data…</TabLoading>
  if (!gaQ.data) return <TabError>{gaQ.error ?? 'GA assumptions unavailable.'}</TabError>

  return (
    <GAExposureBody
      forecast={forecastQ.data}
      forecastError={forecastQ.error}
      gaConfig={gaQ.data}
      historical={histQ.data}
      customerProfile={customerProfile}
      updateProfile={updateProfile}
      state={{ mode, setMode, baseYear, setBaseYear, meter, setMeter, pdfForm, setPdfForm, plan, setPlan }}
    />
  )
}

function GAExposureBody({ forecast, forecastError, gaConfig, historical, customerProfile, updateProfile, state }) {
  const { mode, setMode, baseYear, setBaseYear, meter, setMeter, pdfForm, setPdfForm, plan, setPlan } = state

  // ---- assumptions (shared profile overrides win over the committed file) --
  const annualPool = customerProfile.gaAnnualClassADollars ?? gaConfig.annualClassAGADollars ?? 0
  const classBRate = customerProfile.gaClassBRatePerKwh ?? gaConfig.classBRateDollarsPerKwh ?? 0
  const curtailableMw = customerProfile.curtailableMw ?? customerProfile.mw ?? 1
  const costPerEvent = customerProfile.curtailmentCostPerEvent ?? 5000

  // ---- which base period + which 5CP set -----------------------------------
  const availableYears = historical?.baseYears ?? []
  const actualYear = baseYear ?? availableYears.at(-1) ?? null
  const forwardYear = forecast?.basePeriod?.baseYear ?? null

  const activeYear = mode === 'actual' ? actualYear : forwardYear
  const basePeriod = mode === 'forward' && forecast?.basePeriod
    ? forecast.basePeriod
    : activeYear != null ? basePeriodBounds(activeYear) : null
  const billingPeriod = mode === 'forward' && forecast?.billingPeriod
    ? forecast.billingPeriod
    : activeYear != null ? billingPeriodBounds(activeYear) : null

  const peaks = useMemo(() => (
    mode === 'actual'
      ? historicalPeaksFor(historical, actualYear)
      : runningBoardToPeaks(forecast)
  ) ?? [], [mode, historical, actualYear, forecast])

  const gaForecasts = useMemo(() => forecastToGAForecasts(forecast), [forecast])

  // ---- meter -> hourly -> validation -> PDF ---------------------------------
  const norm = useMemo(
    () => (meter ? normalizeMeterToHourly(meter.table.rows, meter.mapping) : null),
    [meter],
  )
  const issues = useMemo(
    () => (norm ? validateMeterSeries(norm, basePeriod, peaks) : []),
    [norm, basePeriod, peaks],
  )
  const pdfResult = useMemo(
    () => (norm ? computePDF(norm.hourly, peaks, { form: pdfForm }) : null),
    [norm, peaks, pdfForm],
  )

  // ---- dollars --------------------------------------------------------------
  const monthly = useMemo(
    () => (billingPeriod ? expandMonthlyGA({ ...gaConfig, annualClassAGADollars: annualPool }, billingPeriod) : []),
    [gaConfig, annualPool, billingPeriod],
  )
  const exposure = useMemo(
    () => (pdfResult ? computeGAExposure(pdfResult.pdf, monthly) : null),
    [pdfResult, monthly],
  )
  // Annualize consumption from whatever coverage the file has — flagged below.
  const { annualKwh, hoursCovered } = useMemo(() => {
    if (!norm?.hourly.length) return { annualKwh: 0, hoursCovered: 0 }
    const kwh = annualConsumptionKwh(norm.hourly)
    return { annualKwh: (kwh * 8760) / norm.hourly.length, hoursCovered: norm.hourly.length }
  }, [norm])
  const comparison = useMemo(
    () => (pdfResult ? compareClassAvsClassB(pdfResult.pdf, annualKwh, monthly, classBRate) : null),
    [pdfResult, annualKwh, monthly, classBRate],
  )
  const savings = useMemo(
    () => (pdfResult ? savingsByCoincidentPeak(pdfResult.perPeak, annualPool, plan) : null),
    [pdfResult, annualPool, plan],
  )
  const referenceOntarioMw = useMemo(
    () => runningBoardToPeaks(forecast).reduce((s, p) => s + p.ontarioMw, 0),
    [forecast],
  )
  const roiRows = useMemo(
    () => simulateCurtailmentROI({
      predictedPeaks: gaForecasts, curtailableMw, curtailmentCostPerEvent: costPerEvent,
      annualPool, referenceOntarioMw,
    }),
    [gaForecasts, curtailableMw, costPerEvent, annualPool, referenceOntarioMw],
  )

  const peakCustomerMwMax = pdfResult
    ? Math.max(0, ...pdfResult.perPeak.map((p) => p.customerMw ?? 0))
    : 0

  const btn = (active) =>
    `px-3 py-1.5 text-xs font-medium ${active
      ? 'bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
      : 'bg-white text-zinc-500 hover:text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`

  return (
    <TabShell
      className="mx-auto w-full max-w-5xl"
      title={
        <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          GA Exposure Simulator
          <span className="ml-2 align-middle text-xs font-medium text-zinc-500">Class A (ICI) vs Class B, in dollars</span>
        </h2>
      }
      subtitle="Upload your interval meter data — your Peak Demand Factor, GA bill, and what curtailing each coincident peak is worth."
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-500">Mode</span>
          <div className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            <button className={btn(mode === 'forward')} onClick={() => setMode('forward')}
              title="The in-progress base period: running 5CP board + predicted peaks.">
              Forward {forwardYear != null && `(${forwardYear})`}
            </button>
            <button className={btn(mode === 'actual')} onClick={() => setMode('actual')}
              title="A completed base period, scored against its official final 5CP.">
              Actual
            </button>
          </div>
          {mode === 'actual' && (
            <select
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              value={actualYear ?? ''}
              onChange={(e) => setBaseYear(Number(e.target.value))}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>base {y} (May {y} – Apr {y + 1})</option>
              ))}
            </select>
          )}
        </div>
      }
    >
      {/* Today's signal — standalone component, forecast-fed, tab-state-free */}
      {forecast && (
        <SignalBanner predictedPeaks={gaForecasts} threshold={forecast.threshold} />
      )}
      {forecastError && !forecast && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Peak forecast unavailable — forward mode and the ROI table need it. {forecastError}
        </div>
      )}
      {mode === 'actual' && !historical && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Historical 5CP labels unavailable — actual mode needs public/ga/historical_5cp.json.
        </div>
      )}

      <MeterUpload
        table={meter?.table}
        mapping={meter?.mapping}
        onLoad={(table, mapping) => setMeter({ table, mapping })}
        onMappingChange={(mapping) => setMeter((m) => ({ ...m, mapping }))}
        issues={issues}
        intervalMinutes={norm?.intervalMinutes}
        onLoadSample={peaks.length ? () => generateSampleCsv(peaks) : null}
      />

      {!norm && (
        <TabEmpty>
          Upload an interval meter export (or load the sample profile) to compute your Peak Demand Factor and GA exposure
          {mode === 'forward' ? ' for the in-progress base period.' : ` for base ${actualYear}.`}
        </TabEmpty>
      )}

      {norm && pdfResult && peaks.length > 0 && (
        <>
          {mode === 'forward' && (
            <p className="text-[11px] text-zinc-500">
              Forward mode scores your load against the <b>running</b> 5CP board (through {forecast?.datasetThrough}) —
              a PDF-to-date, not a final figure: later peaks can displace the board until Apr 30.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PdfCard
              pdfResult={pdfResult}
              basePeriod={basePeriod}
              billingPeriod={billingPeriod}
              form={pdfForm}
              onFormChange={setPdfForm}
            />
            {comparison && <ClassComparisonCard comparison={comparison} pdf={pdfResult.pdf} />}
          </div>

          {savings && (
            <SavingsByPeak
              savings={savings}
              plan={plan}
              onPlanChange={setPlan}
              peakCustomerMwMax={peakCustomerMwMax}
            />
          )}

          <p className="text-[11px] text-zinc-500">
            Class B volumetric base: {fmtInt(annualKwh)} kWh/yr, annualized from {fmtInt(hoursCovered)} hours of
            uploaded data{hoursCovered < 8000 ? ' — partial coverage; treat the Class B figure as an estimate' : ''}.
            Annual GA exposure at this PDF: <b className="tabular-nums text-zinc-700 dark:text-zinc-300">
              {exposure?.annualDollars == null ? '—' : `$${Math.round(exposure.annualDollars).toLocaleString('en-CA')}`}
            </b> over {billingPeriod?.label}.
          </p>
        </>
      )}

      {forecast && (
        <RoiTable
          rows={roiRows}
          curtailableMw={curtailableMw}
          costPerEvent={costPerEvent}
          onProfileChange={updateProfile}
        />
      )}

      <AssumptionsPanel
        gaConfig={gaConfig}
        annualPool={annualPool}
        classBRatePerKwh={classBRate}
        onProfileChange={updateProfile}
      />

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Methodology: PDF = Σ(your MW at the 5 CPs) / Σ(Ontario AQEW at the 5 CPs) per the IESO ICI settlement rules;
        Class A GA = PDF × monthly Class A pool; coincident peaks are IESO's official AQEW ranking (historical) or the
        live running board (forward) — never re-derived from raw demand. Meter timestamps are aligned to Eastern
        Prevailing Time. Your file never leaves this browser. Not affiliated with the IESO; not billing advice.
      </p>
    </TabShell>
  )
}
