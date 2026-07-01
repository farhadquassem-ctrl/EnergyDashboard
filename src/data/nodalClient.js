// Client data path for the Nodal tab. Calls /api/ieso?report=nodal and falls
// back to generated mock rows (isLive:false) so the grid always has data.
// Fully separate from the Overview snapshot/series path.

const TIMEOUT_MS = 12000 // ~1000 rows + server parse

async function getJson(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`API ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/**
 * @returns {Promise<{ rows, onzp, asOf, isLive }>}
 */
export async function fetchNodal() {
  try {
    const data = await getJson('/api/ieso?report=nodal')
    if (!data.rows?.length) throw new Error('empty nodal')
    return {
      rows: data.rows,
      onzp: data.onzp ?? null,
      asOf: data.asOf ?? new Date().toISOString(),
      isLive: true,
    }
  } catch {
    return { ...generateMockNodal(), isLive: false }
  }
}

// ---------------------------------------------------------------------------
// Mock generator: ~900 plausible nodes with realistic component splits.
// LMP = energy + loss + congestion; most nodes uncongested, a constrained tail.
// ---------------------------------------------------------------------------
const TYPE_MIX = [
  ['Load', 440],
  ['Generator', 340],
  ['DRA', 70],
  ['Storage', 40],
  ['Other', 20],
  ['Node', 10],
]
const NAME_STEMS = [
  'KENORA', 'WAWA', 'ESSA', 'CHATHAM', 'BRANTFORD', 'MARTINDALE', 'PICKERING',
  'GREENFIELD', 'ATLANTIC', 'DOWCHEM', 'NIAGARA', 'BRUCE', 'LENNOX', 'NANTICOKE',
  'CLARABELLE', 'HEARST', 'PEMBROKE', 'WOODSTOCK', 'LEAMINGTON', 'CALEDONIA',
]

function seeded(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}
const r2 = (v) => Math.round(v * 100) / 100

export function generateMockNodal() {
  const rand = seeded(42)
  const onzp = 35
  const energy = 36.2 // ~uniform reference price
  const rows = []
  let i = 0
  for (const [type, n] of TYPE_MIX) {
    for (let k = 0; k < n; k++) {
      const stem = NAME_STEMS[i % NAME_STEMS.length]
      const name = `${stem}${i}-LT.${type === 'Node' ? '' : 'X'}${type === 'Generator' ? 'AG' : type === 'Load' ? 'LF' : ''}`
      // ~80% uncongested; constrained tail can hit the price floor.
      const congested = rand() < 0.2
      const congestion = congested ? -(5 + rand() * 130) : (rand() - 0.85) * 4
      const loss = (rand() - 0.5) * 5
      const lmp = Math.max(-100, r2(energy + loss + congestion))
      rows.push({
        nodeId: name,
        nodeName: name,
        locationType: type,
        zone: null,
        lmp,
        energy: r2(energy),
        congestion: r2(congestion),
        loss: r2(loss),
        basis: r2(lmp - onzp),
        congestionPct: Math.abs(lmp) > 1 ? r2((congestion / lmp) * 100) : null,
      })
      i++
    }
  }
  return { rows, onzp, asOf: new Date().toISOString() }
}
