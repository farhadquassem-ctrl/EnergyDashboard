// Persistent disclaimer (Phase 5). Verbatim text lives in ../disclaimer.js so a
// Node test can assert it stays exact (the wording is a spec non-negotiable).

import { DISCLAIMER_TEXT } from '../disclaimer.js'

export default function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
      <span aria-hidden className="mt-0.5 shrink-0">⚠</span>
      <p>{DISCLAIMER_TEXT}</p>
    </div>
  )
}
