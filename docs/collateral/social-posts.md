# Social posts — EnergyDashboard

Ready-to-paste copy for a personal "I built this" share. Written in the first
person. Swap `[live link]` for your deployed URL before posting, and attach a
screenshot (the **Overview** or **Peak Forecast** tab reads best as a preview
image).

> Framing note: these are personal posts (you sharing something you built),
> while the pitch deck is the commercial version. Keep them personal — it's
> more credible and gets more reach than a product-launch tone on a personal
> profile.

---

## LinkedIn (primary)

I built a live dashboard for the Ontario electricity market — and the more I dug in, the more I realized the hard part isn't the math. It's *noticing*.

Ontario publishes an incredible amount of public data: real-time prices at hundreds of grid nodes, demand, and the official peak determinations that decide what large consumers pay in Global Adjustment. The settlement rules are all in public market manuals. But it arrives as a firehose of XML updated every five minutes — and the one number that sets a Class A consumer's bill (their share of the year's *five coincident peaks*) is buried in it, unwatched, on the afternoon it actually matters.

So I built **EnergyDashboard** to turn that public data into decisions:

🔹 **Peak Forecast** — which upcoming hours are likely to become one of this period's top-5 peaks, with a calibrated probability and a curtail-vs-monitor call.
🔹 **GA Exposure** — upload your interval meter data and see it in dollars: your Peak Demand Factor, Class A vs Class B, and whether curtailing each peak actually pays off. Your data never leaves the browser.
🔹 **Live market view** — a zonal price map, 24h price curve, and the full nodal LMP breakdown, straight from the IESO public reports.
🔹 A **retail side** too — snap a photo of your bill and get it read and checked for anomalies, entirely on your device.

Two design choices I care about most:

**Privacy by construction.** The sensitive stuff — meter data, bill photos — is analyzed client-side. No accounts, no server-side store of anyone's energy data.

**Honest by design.** When the forecast can't see far enough to be sure (there's no real weather forecast 14 days out), it reports near-zero skill instead of a flattering number. For a tool whose whole pitch is trustworthy observability, credibility *is* the product.

Stack: React + Vite, Leaflet, Recharts, AG Grid on the front end; a Vercel edge proxy for the live IESO feed; and a standalone Node pipeline (demand + weather + official peak labels) that backtests the model and refreshes the forecast nightly on CI.

Take a look 👉 [live link]

Always happy to talk Ontario energy markets, forecasting, or the engineering behind it.

#EnergyMarkets #Ontario #IESO #DemandResponse #EnergyManagement #DataVisualization #React #MachineLearning #Cleantech #Electricity

---

## LinkedIn (short alt)

Ontario's electricity market publishes everything — prices, demand, the official peaks that set your bill. The problem isn't transparency. It's that no one's watching the firehose at 4 p.m. on the day a peak hits.

So I built **EnergyDashboard**: live market data, a 5CP peak forecast with calibrated probabilities, and a Global Adjustment exposure tool that prices your meter data in dollars — all in the browser, nothing uploaded.

Built with React, a Vercel edge proxy for the live IESO feed, and a Node pipeline that backtests the model and refreshes nightly.

The design principle I'm proudest of: when the model can't be sure, it says so. Honest beats flattering.

Have a look 👉 [live link]

#EnergyMarkets #Ontario #IESO #EnergyManagement #React #Cleantech

---

## Facebook (primary)

I've been building something I'm pretty excited about: a dashboard that makes Ontario's electricity market actually understandable. ⚡

Two sides to it:

**For homeowners** — you can snap a photo of your electricity bill and it reads it right in your browser (nothing gets uploaded), charts your usage, and flags when something's off — like a sudden spike or too much power used during expensive on-peak hours. There's also a tool that tells you whether you're on the cheapest rate plan for how you actually use electricity.

**For businesses** — big electricity users in Ontario can save a *lot* by cutting back during a handful of specific peak hours each year. The tricky part is knowing which hours those will be, before they happen. My tool forecasts them and shows exactly what the savings are worth.

All of it runs on free, public data from the province's grid operator — I just built the part that turns it into something you can actually use. And the private stuff (your bill, your meter data) never leaves your device.

Take a look 👉 [live link]

Would love to hear what you think! 🙌

#Ontario #Energy #Electricity #SaveMoney #Cleantech

---

## Facebook (short alt)

Built a thing! ⚡ A dashboard that makes Ontario's electricity market make sense — snap a photo of your power bill and it reads and checks it right in your browser (nothing uploaded), tells you if you're on the best rate plan, and helps bigger users save by predicting the grid's peak hours.

All from free public data. Have a look 👉 [live link]

#Ontario #Energy #Electricity #Cleantech

---

## Posting tips

- **Attach an image.** Posts with a visual get far more reach. Best options:
  the **Overview** tab (the map + price chart is instantly recognizable) or the
  **Peak Forecast** tab (looks the most "product"). Screenshots are in
  `docs/collateral/assets/`.
- **Put the link in the post**, not the first comment — for a personal share
  the reach penalty is minor and the click-through is better.
- **LinkedIn**: the first two lines are all that show before "…see more" — the
  hook is "the hard part isn't the math. It's *noticing*." Lead with it.
- **Facebook**: keep it plain-language; most of your audience won't know what
  Global Adjustment is, so the primary version explains the idea without the jargon.
- **Timing**: LinkedIn lands best Tue–Thu morning (ET); Facebook, evenings/weekend.
- Add a note that it's a **portfolio project, not affiliated with the IESO**, if
  you want to be explicit — it's already stated in the app footer.
