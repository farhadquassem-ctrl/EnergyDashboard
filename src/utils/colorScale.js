// Blue -> amber -> red gradient for locational marginal prices ($/MWh).
//
// The scale is anchored to a typical Ontario price band so colours stay
// meaningful once real IESO data is wired in:
//   low  (~$0)   -> cool blue   (cheap / surplus)
//   mid  (~$60)  -> amber       (normal market clearing)
//   high (~$120+) -> red        (scarcity / peak risk)

export const LMP_MIN = 0
export const LMP_MID = 60
export const LMP_MAX = 120

const COLOR_LOW = { r: 0x38, g: 0xbd, b: 0xf8 } // sky-400  (blue)
const COLOR_MID = { r: 0xf5, g: 0x9e, b: 0x0b } // amber-500
const COLOR_HIGH = { r: 0xef, g: 0x44, b: 0x44 } // red-500

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

const lerp = (a, b, t) => Math.round(a + (b - a) * t)

const mix = (c1, c2, t) => ({
  r: lerp(c1.r, c2.r, t),
  g: lerp(c1.g, c2.g, t),
  b: lerp(c1.b, c2.b, t),
})

const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')

/**
 * Map an LMP value ($/MWh) to a hex colour on the blue -> amber -> red scale.
 * @param {number} value
 * @returns {string} hex colour, e.g. "#f59e0b"
 */
export function lmpToColor(value) {
  const v = clamp(value, LMP_MIN, LMP_MAX)

  if (v <= LMP_MID) {
    const t = (v - LMP_MIN) / (LMP_MID - LMP_MIN)
    return toHex(mix(COLOR_LOW, COLOR_MID, t))
  }

  const t = (v - LMP_MID) / (LMP_MAX - LMP_MID)
  return toHex(mix(COLOR_MID, COLOR_HIGH, t))
}
