import { LMP_MIN, LMP_MID, LMP_MAX, lmpToColor } from '../utils/colorScale'

/**
 * Small gradient legend for the LMP colour scale, overlaid on the map.
 */
export default function ColorLegend() {
  const stops = [LMP_MIN, 30, LMP_MID, 90, LMP_MAX]
  const gradient = `linear-gradient(to right, ${stops
    .map((v) => lmpToColor(v))
    .join(', ')})`

  return (
    <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-zinc-700 bg-panel/90 px-3 py-2 backdrop-blur">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        LMP ($/MWh)
      </div>
      <div
        className="h-2 w-40 rounded-full"
        style={{ background: gradient }}
      />
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>${LMP_MIN}</span>
        <span>${LMP_MID}</span>
        <span>${LMP_MAX}+</span>
      </div>
    </div>
  )
}
