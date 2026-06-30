# IESO LMP Dashboard

A public-facing **Ontario electricity market dashboard** — a portfolio project
visualizing locational marginal prices (LMP), provincial demand, and the Hourly
Ontario Energy Price (HOEP).

> ⚠️ The dashboard currently renders **realistic mock data**. The next step is
> wiring in the IESO public reports API (see [Next step](#next-step-connect-to-the-ieso-public-reports-api)).

## Features

- **Dark-themed single-page app** (near-black canvas, slate/zinc palette).
- **Ontario map** (React-Leaflet, left 60%) with markers for the 7 IESO pricing
  zones — Northwest, Northeast, Ottawa, East, West, Southwest, Toronto — each
  colour-coded by LMP on a **blue → amber → red** gradient. Click a zone to
  load its price series.
- **24h price chart** (Recharts, right 40%) with **Real-Time** and **Day-Ahead**
  series for the selected zone.
- **GA Peak Risk** indicator (Green / Yellow / Red).
- **Bottom stat bar**: Ontario Demand (MW), HOEP ($/MWh), and System Condition
  (Normal / Tight / Emergency).

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
└── src/
    ├── main.jsx              # React root
    ├── index.css             # Tailwind layers + Leaflet CSS + dark tweaks
    ├── App.jsx               # Layout: header, map | chart/risk, bottom bar
    ├── data/
    │   └── mockData.js       # ← single seam to swap in the real IESO API
    ├── utils/
    │   └── colorScale.js     # blue → amber → red LMP colour mapping
    └── components/
        ├── MapPanel.jsx      # Leaflet map + zone markers
        ├── ColorLegend.jsx   # LMP gradient legend
        ├── PriceChart.jsx    # Recharts RT vs DA line chart
        ├── GAPeakRisk.jsx    # Green/Yellow/Red indicator
        ├── StatTile.jsx      # Single bottom-bar tile
        └── BottomBar.jsx     # Demand / HOEP / System Condition
```

## Deploying to Vercel

This repo is preconfigured for Vercel via `vercel.json` (framework preset
`vite`, build command `npm run build`, output `dist`).

1. Push the branch to GitHub.
2. Import the repo in Vercel — it auto-detects the Vite settings.
3. Deploy. No environment variables are required for the mock-data version.

## Next step: connect to the IESO public reports API

The IESO publishes free, public market data (no API key) as XML/CSV reports at:

```
http://reports.ieso.ca/public/RealtimeMktResults/
```

Relevant public report families include:

- **Real-Time** zonal/locational prices under `RealtimeMktResults/`.
- **Predispatch / Day-Ahead** prices (separate report folders).
- **Ontario Demand** and **HOEP** under their own public report folders
  (e.g. `Demand/`, `RealtimeMktTotals/`).

### How to wire it in

All UI components read from **`src/data/mockData.js`**. That file is the only
seam you need to touch — keep the exported shapes the same and the components
won't change:

- `ZONES` → array of `{ id, name, lat, lng, lmp }`
- `getZonePriceSeries(zoneId)` → `[{ hour, realTime, dayAhead }]` (24 points)
- `getGAPeakRisk(demandMW)` → `{ level: 'Green'|'Yellow'|'Red', label, detail }`
- `SYSTEM_SNAPSHOT` → `{ demandMW, hoep, systemCondition }`

Suggested approach:

1. **Add a fetch layer** (e.g. `src/data/iesoClient.js`) that downloads and
   parses the relevant report XML. The reports are static files, so a small
   serverless function or build-time/edge fetch works well on Vercel.
2. **CORS / mixed content:** the endpoint is `http://` (not `https`) and does
   not send permissive CORS headers, so a browser `fetch` directly from the
   page will be blocked. Proxy it through a **Vercel Serverless/Edge Function**
   (e.g. `/api/ieso/[report]`) that fetches the report server-side and returns
   parsed JSON.
3. **Parse XML → JSON** (e.g. `fast-xml-parser`) inside that function and map
   the fields onto the shapes above.
4. **Swap the mock functions** in `mockData.js` for calls to your client (or
   load via `useEffect` / a data hook), then add loading and error states.
5. **Refresh cadence:** real-time reports update every 5 minutes — cache
   responses and poll on a matching interval.

Once that proxy returns data in the shapes above, the map, chart, risk
indicator, and stat tiles all light up with live IESO data.
