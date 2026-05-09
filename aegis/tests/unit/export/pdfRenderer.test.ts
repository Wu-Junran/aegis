import { test, expect } from 'bun:test'
import { markdownToPdf } from '../../../src/medical/export/pdfRenderer.js'

test('renders heading + paragraph + bullets to a PDF buffer', async () => {
  const md = `# Title\n\nLeading paragraph.\n\n- one\n- two\n`
  const buf = await markdownToPdf(md)
  expect(buf.byteLength).toBeGreaterThan(200)
  expect(buf.subarray(0, 4).toString()).toBe('%PDF')
})

test('two consecutive renders of the same input produce byte-equal PDFs', async () => {
  const md = `# Discharge Summary\n\nPatient stable. Discharge home.`
  const a = await markdownToPdf(md)
  const b = await markdownToPdf(md)
  expect(a.equals(b)).toBe(true)
})

test('refuses to emit when input contains a <script> tag', async () => {
  const md = `# Title\n<script>alert(1)</script>\n`
  await expect(markdownToPdf(md)).rejects.toThrow(/refused/i)
})

test('refuses to emit when input contains a data: URI link', async () => {
  const md = `# Title\n[click](data:text/html,<x>)\n`
  await expect(markdownToPdf(md)).rejects.toThrow(/refused/i)
})
