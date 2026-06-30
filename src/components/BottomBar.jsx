import StatTile from './StatTile'
import { SYSTEM_SNAPSHOT } from '../data/mockData'

const CONDITION_ACCENT = {
  Normal: 'text-emerald-400',
  Tight: 'text-amber-400',
  Emergency: 'text-red-400',
}

/**
 * Bottom bar: three system-level stat tiles.
 */
export default function BottomBar({ snapshot = SYSTEM_SNAPSHOT }) {
  const { demandMW, hoep, systemCondition } = snapshot

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatTile
        label="Ontario Demand"
        value={demandMW.toLocaleString('en-CA')}
        unit="MW"
      />
      <StatTile label="HOEP" value={`$${hoep.toFixed(2)}`} unit="/MWh" />
      <StatTile
        label="System Condition"
        value={systemCondition}
        accentClass={CONDITION_ACCENT[systemCondition] ?? 'text-zinc-100'}
      />
    </div>
  )
}
