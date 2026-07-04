export default function SelectBadge({ selected, rank }) {
  if (selected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
        Curtail · would be #{rank}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      Monitor · #{rank}
    </span>
  )
}
