import { BAND_START, BAND_END, pct } from '../calculations'

// 24h rail with the candidate band, the three curtailment windows nested, and a
// peak marker. `compact` shows only the Balanced window (for the table view).
export default function CurtailStrip({ hourStart, windows, compact = false }) {
  const shown = compact ? windows.filter((w) => w.profile === 'Balanced') : windows
  return (
    <div
      className={`relative w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700/70 dark:bg-zinc-800/60 ${
        compact ? 'h-6' : 'h-10'
      }`}
    >
      <div className="absolute inset-y-0 bg-sky-500/10" style={{ left: pct(BAND_START), width: pct(BAND_END + 1 - BAND_START) }} />
      {shown.map((w, i) => {
        const inset = compact ? 3 : 6 + i * 4 // nest the widths visually
        return (
          <div
            key={w.profile}
            className="absolute rounded-sm"
            title={`${w.profile}: ${w.label}`}
            style={{
              left: pct(w.hourStart),
              width: pct(w.windowHours),
              top: inset,
              bottom: inset,
              background: 'rgba(245,158,11,0.16)',
              border: '1px solid rgba(245,158,11,0.5)',
            }}
          />
        )
      })}
      <div className="absolute inset-y-0 w-0.5 bg-red-500" style={{ left: pct(hourStart + 0.5) }}>
        <span className="absolute -left-[3px] -top-[3px] h-2 w-2 rounded-full bg-red-500" />
      </div>
    </div>
  )
}
