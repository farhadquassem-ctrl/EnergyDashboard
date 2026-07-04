// Shared tab chrome (the contract's <TabShell>): every tab composes this for
// its page layout — header (title / subtitle / right-aligned actions) plus
// the standard loading / error / empty states — instead of hand-rolling its
// own. Typography inside the slots stays per-tab (the existing tabs shipped
// with different header scales; forcing one would be a visual change), so the
// slots accept nodes as well as strings.
//
// The contract also puts a date-range picker + zone selector here. Today no
// tab consumes a date range (everything is "latest") and zone selection
// happens on the Overview map, so those controls land with the first tab
// that needs them (Prompt 1) rather than shipping dead UI — they'll read
// from the shared store (src/store/marketStore.jsx) when they do.

export default function TabShell({ title, subtitle, actions, align = 'start', gap = 'gap-4', className = '', children }) {
  const hasHeader = title || subtitle || actions
  return (
    <div className={`flex flex-1 flex-col ${gap} ${className}`}>
      {hasHeader && (
        <div className={`flex flex-wrap justify-between gap-3 ${align === 'center' ? 'items-center' : 'items-start'}`}>
          <div>
            {typeof title === 'string' ? (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                {title}
              </h2>
            ) : (
              title
            )}
            {typeof subtitle === 'string' ? (
              <p className="text-xs text-zinc-500">{subtitle}</p>
            ) : (
              subtitle
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

/** Full-area centered loading state (also used as the lazy-tab fallback). */
export function TabLoading({ children }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
      {children ?? 'Loading…'}
    </div>
  )
}

/** Prominent error card (amber, centered). */
export function TabError({ children }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-amber-500/40 bg-amber-500/5 p-6 text-center text-sm text-zinc-600 dark:text-zinc-300">
      {children}
    </div>
  )
}

/** Quiet empty state card. */
export function TabEmpty({ children }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-panel">
      {children}
    </div>
  )
}
