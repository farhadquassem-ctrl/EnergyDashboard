import { useRef, useState } from 'react'

// Image acquisition (Phase 1 entry): drag-and-drop, file picker, and camera
// capture (the `capture` attr opens the rear camera on phones). Emits the raw
// File up to the tab, which runs OCR → parse → confidence gate. The image is
// held in memory only; nothing is uploaded from here.

export default function BillUpload({ onImage, busy, progress, onLoadSample }) {
  const fileRef = useRef(null)
  const camRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const pick = (file) => { if (file) onImage(file) }

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-5 transition-colors ${
        dragOver ? 'border-sky-500 bg-sky-500/5' : 'border-zinc-300 dark:border-zinc-700'
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]) }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Add a photo of your electricity bill</p>
        <p className="max-w-md text-[11px] text-zinc-500">
          Processed with on-device OCR first — the image stays in your browser. If OCR can't read it confidently,
          you'll be asked to black out any personal info before an optional cloud read.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300"
          >
            Choose photo…
          </button>
          <button
            onClick={() => camRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Take photo
          </button>
          {onLoadSample && (
            <button
              onClick={onLoadSample}
              disabled={busy}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              title="Load 14 months of synthetic sample bills to see the anomaly detection and chart."
            >
              Load sample bills
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

        {busy && (
          <div className="w-full max-w-xs">
            <div className="mb-1 text-[11px] text-zinc-500">Reading bill… {Math.round((progress ?? 0) * 100)}%</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
