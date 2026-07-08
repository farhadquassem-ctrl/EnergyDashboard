import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DISCLAIMER_TEXT } from './disclaimer.js'

// The spec requires this exact wording, verbatim. Guard against drift.
test('disclaimer text is byte-for-byte the required wording', () => {
  assert.equal(
    DISCLAIMER_TEXT,
    'Disclaimer: This analysis is generated from optical character recognition (OCR) and may contain errors. It is for informational purposes only, does not constitute financial advice, and should not replace official utility data or professional energy audits.',
  )
})
