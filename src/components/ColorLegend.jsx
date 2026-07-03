import { LMP_FLOOR, LMP_MID, LMP_MAX, lmpToColor } from '../utils/colorScale'

/**
 * Small gradient legend for the LMP colour scale, overlaid on the map.
 * Spans the negative band (indigo) through the $0+ blue→amber→red range.
 */
export default function ColorLegend() {
  const stops = [LMP_FLOOR, 0, 30, LMP_MID, 90, LMP_MAX]
  const gradient = `linear-gradient(to right, ${stops
    .map((v) => lmpToColor(v))
    .join(', ')})`

  return (
    <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-zinc-300 bg-white/90 px-3 py-2 backdrop-blur dark:border-zinc-700 dark:bg-panel/90">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        LMP ($/MWh)
      </div>
      <div className="h-2 w-44 rounded-full" style={{ background: gradient }} />
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>-${Math.abs(LMP_FLOOR)}</span>
        <span>$0</span>
        <span>${LMP_MID}</span>
        <span>${LMP_MAX}+</span>
      </div>
    </div>
  )
}
