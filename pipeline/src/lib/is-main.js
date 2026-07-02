// Cross-platform "was this module run directly?" check.
//
// The common `import.meta.url === 'file://' + process.argv[1]` idiom breaks on
// Windows (file:///C:/… vs C:\…), silently skipping the run block. Comparing
// resolved OS paths works on Windows, macOS, and Linux.

import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function isMain(importMetaUrl) {
  const invoked = process.argv[1]
  if (!invoked) return false
  return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(invoked)
}
