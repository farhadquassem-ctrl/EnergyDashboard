// Loads the Peak Forecast tab's data — the pipeline's forecast, exported as a
// static file to public/peak-forecast/forecast.json (see pipeline
// `npm run export:dashboard`). No API/backend: the app just reads the committed
// JSON, so this stays a pure renderer of pipeline output.
//
// The file carries its own freshness (generatedAt / datasetThrough / staleNote)
// and a `sample` flag when it's the checked-in illustrative sample rather than
// a real run.

export async function fetchPeakForecast() {
  try {
    const res = await fetch('/peak-forecast/forecast.json', { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!data?.predictedPeaks) throw new Error('malformed forecast.json')
    return { data, error: null }
  } catch (e) {
    return {
      data: null,
      error:
        'Forecast data not found. Run `npm run export:dashboard` in the pipeline and commit public/peak-forecast/forecast.json.',
    }
  }
}
