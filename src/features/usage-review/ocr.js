// Client-side OCR (Phase 1) via Tesseract.js. Deliberately thin — all field
// extraction is pure (billParsing.js). Tesseract is dynamically imported so its
// ~2 MB wasm/worker never lands in the initial bundle; it loads only when the
// user actually uploads a bill. Everything runs in the browser: the image is
// never sent anywhere in this path.

/**
 * OCR an image (File/Blob/HTMLImageElement/dataURL) entirely in the browser.
 * @param {*} imageSource anything Tesseract.recognize accepts
 * @param {(p:number)=>void} [onProgress] 0..1 recognize progress
 * @returns {Promise<{ text: string, confidence: number }>} confidence 0..1
 */
export async function runOcr(imageSource, onProgress) {
  const Tesseract = (await import('tesseract.js')).default
  const { data } = await Tesseract.recognize(imageSource, 'eng', {
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') onProgress(m.progress)
    },
  })
  return { text: data.text ?? '', confidence: (data.confidence ?? 0) / 100 }
}

/** Read a File/Blob to a data URL (for the redaction canvas + preview). */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read the image file.'))
    r.readAsDataURL(file)
  })
}
