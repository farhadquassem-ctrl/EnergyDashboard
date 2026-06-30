# IESO LMP Dashboard

A public-facing **Ontario electricity market dashboard** — a portfolio project
visualizing the IESO's zonal energy prices, provincial demand, and system
status.

> 🔌 The dashboard reads **live data from the IESO public reports** via a Vercel
> serverless proxy, and falls back to realistic mock data if the feed is
> unavailable (see [Live data](#live-data-from-the-ieso-public-reports)).

## Features

- **Dark-themed single-page app** (near-black canvas, slate/zinc palette).
- **Ontario map** (React-Leaflet, left 60%) with markers for the 7 IESO pricing
  zones — Northwest, Northeast, Ottawa, East, West, Southwest, Toronto — each
  colour-coded by its **Ontario Zonal Price** on a **blue → amber → red**
  gradient. Click a zone to load its price series.
- **24h price chart** (Recharts, right 40%) with **Real-Time** and **Day-Ahead**
  series for the selected zone.
- **GA Peak Risk** indicator (Green / Yellow / Red).
- **Bottom stat bar**: Ontario Demand (MW), Ontario Zonal Price ($/MWh), and
  System Condition (Normal / Tight / Emergency).
- **Live/Mock status badge** in the header so it's always clear which data the
  page is showing.

> ℹ️ **Note on the renewed market:** Ontario's Market Renewal Program (May 2025)
> retired the single **HOEP** and introduced **nodal LMP** plus per-zone
> **Ontario Zonal Prices (OZP)**. This dashboard uses the public zonal-price
> reports; the headline price tile is the OZP / Ontario Electricity Market Price
> (OEMP), the successor to HOEP.

## Tech stack

| Concern   | Choice                              |
| --------- | ----------------------------------- |
| Framework | React 18 + Vite                     |
| Map       | react-leaflet + Leaflet (OSM tiles) |
| Charts    | Recharts                            |
| Styling   | Tailwind CSS (configured via PostCSS) |
| Deploy    | Vercel                              |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (http://localhost:5173)
npm run dev

# 3. Production build + local preview
npm run build
npm run preview
```

## Project structure

```
ieso-lmp-dashboard/
├── index.html               # App entry / dark theme + metadata
├── package.json
├── vite.config.js
├── tailwind.config.js        # darkMode: 'class', canvas/panel colours
├── postcss.config.js
├── vercel.json               # Vite framework preset for Vercel
├── api/
│   └── ieso.js              # Serverless proxy: fetches + parses IESO XML
└── src/
    ├── main.jsx              # React root
    ├── index.css             # Tailwind layers + Leaflet CSS + dark tweaks
    ├── App.jsx               # Layout: header, map | chart/risk, bottom bar
    ├── data/
    │   ├── zones.js          # Canonical zone geography (shared)
    │   ├── iesoClient.js     # Fetches /api/ieso, falls back to mock
    │   ├── useIesoData.js    # React hooks (snapshot + per-zone series)
    │   └── mockData.js       # Fallback data + GA-risk / condition logic
    ├── utils/
    │   └── colorScale.js     # blue → amber → red price colour mapping
    └── components/
        ├── MapPanel.jsx      # Leaflet map + zone markers
        ├── ColorLegend.jsx   # Price gradient legend
        ├── PriceChart.jsx    # Recharts RT vs DA line chart
        ├── GAPeakRisk.jsx    # Green/Yellow/Red indicator
        ├── StatusBadge.jsx   # Live / Mock header pill
        ├── StatTile.jsx      # Single bottom-bar tile
        └── BottomBar.jsx     # Demand / Price / System Condition
```

## Deploying to Vercel

This repo is preconfigured for Vercel via `vercel.json` (framework preset
`vite`, build command `npm run build`, output `dist`).

1. Push the branch to GitHub.
2. Import the repo in Vercel — it auto-detects the Vite settings and the
   `api/` serverless function.
3. Deploy. No environment variables are required.

> **Local dev caveat:** `npm run dev` runs only the Vite frontend, so `/api/ieso`
> isn't served locally — the app will show **Mock data**. The live feed works on
> Vercel (and `vercel dev`), where the serverless function runs. See
> `docs/LOCAL_DEV.md`.

## Live data from the IESO public reports

The IESO publishes free, public market data (no API key) as XML on
`reports-public.ieso.ca`. Because those files are served without CORS headers
(and the legacy host is `http`), the browser can't fetch them directly — so a
**Vercel serverless function** (`api/ieso.js`) fetches and parses them
server-side and returns clean JSON.

### Data flow

```
browser  →  /api/ieso?report=…  →  reports-public.ieso.ca/*.xml
                 (parse XML → JSON, normalize, cache)
```

Reports used (field mappings confirmed against `docs/Sample-Reports/`):

| Purpose | Report |
| --- | --- |
| Per-zone 5-min price (map colour + chart "This zone" line) | `RealtimeZonalEnergyPrices/PUB_RealtimeZonalEnergyPrices.xml` |
| Province-wide price (price tile + chart "Ontario" line) | `RealtimeOntarioZonalPrice/PUB_RealtimeOntarioZonalPrice.xml` |
| Ontario demand (demand tile + GA risk) | `RealtimeZonalDemand/PUB_RealtimeZonalDemand.csv` |

Zone names in the price report are virtual-zone hubs (`TORONTO:HUB`,
`NORTHWEST:HUB`, …); we strip `:HUB` and match the 7 plotted zones. Each zone
lists 12 five-minute `IntervalPrice` rows for the current `DELIVERYHOUR`; the
"current price" is the latest interval that has a value.

### API endpoints (`/api/ieso`)

- `?report=snapshot` → `{ zones:[{id,lmp}], snapshot:{demandMW,price,systemCondition}, asOf }`
- `?report=series&zone=<id>` → `{ series:[{label,zonePrice,ontarioPrice}], asOf }`
- add `&debug=1` to either → also returns the **raw parsed report tree(s)**.

The frontend (`src/data/iesoClient.js` + `useIesoData.js`) calls these, merges
prices onto the zone geography, and **falls back to mock data** on any failure,
so the UI always renders. The header badge shows Live vs Mock.

### Refresh cadence

Real-time reports update every ~5 minutes. The function sets a 5-minute edge
cache (`s-maxage=300`, stale-while-revalidate), and the client re-fetches the
snapshot every 5 minutes.

### ⚠️ Verify once deployed (couldn't be tested without live network)

The parsers are validated against the committed sample files, but a few things
can only be confirmed against the live server (the dev sandbox can't reach the
IESO host). Open `https://<your-app>.vercel.app/api/ieso?report=snapshot&debug=1`
and check:

1. **Live report URLs / filenames** — especially the demand CSV path
   (`RealtimeZonalDemand/PUB_RealtimeZonalDemand.csv` is best-effort; the sample
   was named `PUB_RealtimeDemandZonal.csv`). If `demandMW` is `null`, fix the
   `REPORTS.demand` URL in `api/ieso.js`.
2. **Demand magnitude / units** — the sample CSV's "Ontario Demand" values are
   implausibly low (~1,300), suggesting test/sandbox data. The
   `deriveSystemCondition` thresholds (19,000 / 22,000 MW) assume real
   production magnitudes — sanity-check against the live feed.
3. **Range requests** — demand uses an HTTP `Range: bytes=-65536` tail fetch to
   avoid downloading the full (multi-MB) CSV. If the server ignores `Range`, the
   whole file is downloaded (still works, just heavier).
4. **Actual 5-min refresh timing** — confirm new intervals appear roughly every
   5 minutes.

### Known limitations / next enhancements

- **Chart history is the current hour only.** The real-time price report covers
  the current dispatch hour (≤12 five-minute points), so early in an hour the
  chart is sparse. A true 24h history needs an hourly/daily price report (e.g. a
  predispatch or day-ahead zonal report) — not included in the samples.
- **No Day-Ahead series yet** (the original RT-vs-DA design). The chart shows
  *zone vs province* real-time instead. Add `DAHourlyOntarioZonalPrice` to
  restore a day-ahead line.
- **Nodal LMP** (`PUB_RealtimeEnergyLMP.csv`, 900+ nodes) is available for a
  future node-level drill-down but needs a node→zone reference to aggregate.
