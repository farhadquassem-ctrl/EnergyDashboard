# Collateral

Customer- and reader-facing material for EnergyDashboard. Source files live
here alongside the rendered PDFs so they can be regenerated.

| File | What it is | Audience |
| --- | --- | --- |
| `EnergyDashboard-User-Manual.pdf` | Full six-tab walkthrough with screenshots, privacy notes, FAQ | End users |
| `EnergyDashboard-Pitch-Deck.pdf` | 10-slide commercial pitch, Class A lead | Prospects / investors |
| `social-posts.md` | Ready-to-paste LinkedIn + Facebook posts (personal framing) | You, to post |
| `user-manual.html` | Source for the manual PDF | — |
| `pitch-deck.html` | Source for the deck PDF | — |
| `assets/` | Screenshots embedded in the PDFs | — |

Companion docs (in `../`): [`DESIGN.md`](../DESIGN.md) (product rationale),
[`TECH-SPECS.md`](../TECH-SPECS.md) (technical spec / enhanced README),
[`ARCHITECTURE.md`](../ARCHITECTURE.md) (per-tab contract).

## Regenerating the PDFs

The PDFs are rendered from the HTML sources with headless Chromium. To
regenerate after editing a source file:

```js
// .render_pdf.mjs — node .render_pdf.mjs <in.html> <out.pdf> [landscape]
import { chromium } from 'playwright-core'
import { pathToFileURL } from 'node:url'
const [, , inPath, outPath, orientation] = process.argv
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(pathToFileURL(inPath).href, { waitUntil: 'networkidle' })
await page.emulateMedia({ media: 'print' })
await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true,
  ...(orientation === 'landscape' ? { landscape: true } : {}) })
await browser.close()
```

```bash
node .render_pdf.mjs docs/collateral/user-manual.html docs/collateral/EnergyDashboard-User-Manual.pdf
node .render_pdf.mjs docs/collateral/pitch-deck.html   docs/collateral/EnergyDashboard-Pitch-Deck.pdf   landscape
```

**Before posting the social copy:** replace `[live link]` with the deployed
URL, and in the pitch deck's closing slide replace `[ your-live-url ]` and
`[ your-contact-email ]`.
