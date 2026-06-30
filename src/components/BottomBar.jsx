import StatTile from './StatTile'
import { MOCK_SNAPSHOT } from '../data/mockData'

const CONDITION_ACCENT = {
  Normal: 'text-emerald-400',
  Tight: 'text-amber-400',
  Emergency: 'text-red-400',
}

const fmt = (v, digits = 0) =>
  v == null ? '—' : Number(v).toLocaleString('en-CA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

/**
 * Bottom bar: three system-level stat tiles.
 * `price` is the Ontario Zonal Price / OEMP (HOEP was retired May 2025).
 */
export default function BottomBar({ snapshot = MOCK_SNAPSHOT }) {
  const { demandMW, price, systemCondition } = snapshot

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatTile label="Ontario Demand" value={fmt(demandMW)} unit="MW" />
      <StatTile
        label="Ontario Zonal Price"
        value={price == null ? '—' : `$${fmt(price, 2)}`}
        unit="/MWh"
      />
      <StatTile
        label="System Condition"
        value={systemCondition}
        accentClass={CONDITION_ACCENT[systemCondition] ?? 'text-zinc-100'}
      />
    </div>
  )
}
