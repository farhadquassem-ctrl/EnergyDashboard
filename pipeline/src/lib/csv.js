// Minimal CSV helpers. The inputs here are simple (no embedded commas/quotes in
// the fields we use), so a tiny hand-rolled parser keeps the pipeline dependency
// -free and readable rather than pulling a CSV library.

// Parse CSV text into { header: string[], rows: string[][] }.
// `skipCommentPrefix` drops leading lines (e.g. IESO's "\\" preamble) so the
// real header row is found by content, not a fixed line number.
export function parseCsv(text, { skipCommentPrefix = null } = {}) {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .filter((l) => !(skipCommentPrefix && l.startsWith(skipCommentPrefix)))
  if (lines.length === 0) return { header: [], rows: [] }
  const header = splitLine(lines[0])
  const rows = lines.slice(1).map(splitLine)
  return { header, rows }
}

function splitLine(line) {
  return line.split(',').map((c) => c.trim())
}

// Find a column index by header name, case-insensitive, trimmed. Throws if
// absent so a silent wrong-column bug can't slip through.
export function columnIndex(header, name) {
  const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  if (i === -1) {
    throw new Error(
      `column "${name}" not found in header: [${header.join(', ')}]`,
    )
  }
  return i
}

// Serialize an array of row objects to CSV using an explicit column order.
export function toCsv(columns, rows) {
  const head = columns.join(',')
  const body = rows.map((r) =>
    columns
      .map((c) => {
        const v = r[c]
        return v === null || v === undefined ? '' : String(v)
      })
      .join(','),
  )
  return [head, ...body].join('\n') + '\n'
}
