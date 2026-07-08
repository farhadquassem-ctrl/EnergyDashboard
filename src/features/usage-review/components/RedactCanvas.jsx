import { useEffect, useRef, useState } from 'react'

// Phase-2 privacy step: draw the uploaded image on a <canvas> and let the user
// swipe black boxes over Name, Address, Account Number, and anything else
// personal BEFORE the redacted image is sent to the serverless vision route.
// The redaction is burned into the pixels (we export the composited canvas), so
// what leaves the browser genuinely has the PII painted out — not merely hidden
// by an overlay.

export default function RedactCanvas({ dataUrl, onRedacted, onCancel, busy }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const drawing = useRef(null)
  const [boxes, setBoxes] = useState([])
  const [ready, setReady] = useState(false)

  // load image, size canvas to a max width, draw
  useEffect(() => {
    const img = new Image()
    img.onload = () => { imgRef.current = img; setReady(true) }
    img.src = dataUrl
  }, [dataUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const maxW = 520
    const scale = Math.min(1, maxW / img.width)
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000'
    for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h)
  }, [ready, boxes])

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const p = e.touches?.[0] ?? e
    return { x: p.clientX - rect.left, y: p.clientY - rect.top }
  }
  const start = (e) => { e.preventDefault(); drawing.current = pos(e) }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const p = pos(e)
    const s = drawing.current
    setBoxes((prev) => [...prev.filter((b) => !b._live), { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y), _live: true }])
  }
  const end = () => {
    setBoxes((prev) => prev.map((b) => ({ ...b, _live: false })).filter((b) => b.w > 3 && b.h > 3))
    drawing.current = null
  }

  const apply = () => {
    const canvas = canvasRef.current
    if (canvas) onRedacted(canvas.toDataURL('image/png'))
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-panel">
      <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Black out personal information</h3>
      <p className="mb-3 text-[11px] text-zinc-500">
        Swipe to draw black boxes over your <b>name, address, and account number</b> (and anything else personal). The
        boxes are painted into the image before it's sent for reading — only what you leave visible is transmitted.
      </p>
      <div className="flex flex-col items-start gap-3">
        <canvas
          ref={canvasRef}
          className="max-w-full touch-none rounded border border-zinc-300 dark:border-zinc-700"
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={apply} disabled={busy} className="rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300">
            {busy ? 'Reading…' : 'Redact & read bill'}
          </button>
          <button onClick={() => setBoxes([])} disabled={busy} className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
            Clear boxes
          </button>
          <button onClick={onCancel} disabled={busy} className="rounded-md px-2.5 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300">
            Cancel
          </button>
          <span className="text-[11px] text-zinc-400">{boxes.length} box{boxes.length === 1 ? '' : 'es'}</span>
        </div>
      </div>
    </div>
  )
}
