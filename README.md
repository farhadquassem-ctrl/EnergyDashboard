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

Reports used:

| Purpose | Report |
| --- | --- |
| Per-zone real-time price (map + RT chart series) | `RealtimeOntarioZonalPrice/PUB_RealtimeOntarioZonalPrice.xml` |
| Per-zone day-ahead price (DA chart series) | `DAHourlyOntarioZonalPrice/PUB_DAHourlyOntarioZonalPrice.xml` |
| Provincial demand | `RealtimeTotals/PUB_RealtimeTotals.xml` |

### API endpoints (`/api/ieso`)

- `?report=snapshot` → `{ zones:[{id,lmp}], snapshot:{demandMW,price,systemCondition}, asOf }`
- `?report=series&zone=<id>` → `{ series:[{hour,realTime,dayAhead}], asOf }`
- add `&debug=1` to either → also returns the **raw parsed XML tree**, for
  confirming the real element names.

The frontend (`src/data/iesoClient.js` + `useIesoData.js`) calls these, merges
prices onto the zone geography, and **falls back to mock data** on any failure,
so the UI always renders. The header badge shows Live vs Mock.

### ⚠️ Tuning the XML field mapping

The parser in `api/ieso.js` was written **without a live sample** (the dev
sandbox couldn't reach the IESO host), so the element names are best-effort and
the extraction is deliberately tolerant. To confirm and tighten them against the
real reports once deployed:

1. Open the debug endpoint on your deployment, e.g.
   `https://<your-app>.vercel.app/api/ieso?report=snapshot&debug=1`
2. Inspect the `raw` tree to see the real element names (e.g. the actual zone
   and price tag names).
3. Adjust the field lookups in `extractZonePrices`, `extractZoneSeries`, and
   `extractDemand` in `api/ieso.js` to match.

If the snapshot shows real zone prices, the mapping is already working; the
demand figure and 24h real-time history are the most likely to need tuning.

### Refresh cadence

Real-time reports update every ~5 minutes. The function sets a 2-minute edge
cache (`s-maxage=120`), and the client re-fetches the snapshot every 5 minutes.
