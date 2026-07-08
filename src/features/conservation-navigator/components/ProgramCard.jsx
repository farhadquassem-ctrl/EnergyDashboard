// One curated program. Renders its use case + key detail (the value-add over a
// raw link), a source attribution, a verify-against-source note, and a single
// primary action (internal comparator, another tab, or the official page).

const AUDIENCE_BADGE = {
  residential: { label: 'Residential', cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  commercial: { label: 'Business', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
}

export default function ProgramCard({ program, onAction }) {
  const p = program
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-tight text-zinc-900 dark:text-zinc-100">{p.name}</h4>
        <div className="flex shrink-0 gap-1">
          {(p.audience ?? []).map((a) => (
            <span key={a} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${AUDIENCE_BADGE[a]?.cls ?? ''}`}>
              {AUDIENCE_BADGE[a]?.label ?? a}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{p.useCase}</p>
      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{p.keyDetail}</p>

      {p.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.tags.slice(0, 5).map((t) => (
            <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{t}</span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <button
          onClick={() => onAction(p)}
          className="rounded-md border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-500/20 dark:text-sky-300"
        >
          {p.action?.label ?? 'Learn more'}
          {p.action?.type === 'external' && ' ↗'}
        </button>
        <a
          href={p.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          title={`Source: ${p.sourceName}`}
        >
          {p.verify ? 'verify at source ↗' : 'source ↗'}
        </a>
      </div>
    </div>
  )
}
