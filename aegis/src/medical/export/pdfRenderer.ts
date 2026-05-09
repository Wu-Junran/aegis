import { marked } from 'marked'
import PDFDocument from 'pdfkit'

const REFUSED_PATTERNS: RegExp[] = [
	/<script\b/i,
	/<iframe\b/i,
	/\]\(\s*data:/i, // data: URI in markdown link
]

export class PdfRefusedContentError extends Error {
	constructor(reason: string) {
		super(`pdfRenderer refused content: ${reason}`)
		this.name = 'PdfRefusedContentError'
	}
}

/**
 * Render markdown to a deterministic PDF byte buffer.
 *
 * Determinism levers:
 *   - `info.CreationDate = info.ModDate = new Date(0)` — pdfkit otherwise
 *     stamps `Date.now()`.
 *   - Fixed font set (pdfkit's bundled Helvetica family + Courier). No system
 *     font lookup; `embedDefaultFontPaths()` is not called.
 *   - `pdfVersion: '1.4'` pinned to avoid dialect drift across pdfkit
 *     releases.
 *
 * Refused content (loud throw, never silent emit): `<script>`, `<iframe>`,
 * `data:` URIs in links. Mirrors the M4 `MediaBlockRefusedError` pattern.
 */
export async function markdownToPdf(markdown: string): Promise<Buffer> {
	for (const re of REFUSED_PATTERNS) {
		if (re.test(markdown)) {
			throw new PdfRefusedContentError(`pattern ${re.source} matched`)
		}
	}
	const tokens = marked.lexer(markdown)
	// (P2#5 fix) pdfkit derives the PDF document `id` (and a few other
	// internal identifiers) from `Math.random` at construction time. To
	// produce a byte-stable document for the golden test we shim
	// `Math.random` with a fixed sequence for the lifetime of this call,
	// and explicitly overwrite the doc's `_id` after construction (defends
	// against future pdfkit versions that move id generation elsewhere).
	// The shim is restored in `finally` so concurrent callers in the same
	// process are unaffected once the promise resolves.
	const realRandom = Math.random
	const seq = makeFixedRandom('aegis-pdf-determinism-seed-v1')
	Math.random = seq
	try {
		return await new Promise<Buffer>((resolve, reject) => {
			const doc = new PDFDocument({
				pdfVersion: '1.4',
				info: {
					Producer: 'aegis-pdf',
					Creator: 'aegis',
					CreationDate: new Date(0),
					ModDate: new Date(0),
					Title: 'Clinical note',
				},
				autoFirstPage: true,
				size: 'LETTER',
				margin: 56, // 0.78"
			})
			;(doc as any)._id = 'aegis-deterministic-id-v1'
			const chunks: Buffer[] = []
			doc.on('data', (c) => chunks.push(c as Buffer))
			doc.on('error', reject)
			doc.on('end', () => resolve(Buffer.concat(chunks)))
			try {
				renderTokens(doc, tokens)
				doc.end()
			} catch (err) {
				reject(err)
			}
		})
	} finally {
		Math.random = realRandom
	}
}

/**
 * Deterministic `Math.random` substitute. SplitMix32 seeded by a SHA-256
 * digest of the seed string. Returns floats in [0, 1) that are stable
 * across runs and Node versions. We don't use `Math.random` itself
 * because we are replacing it; we don't pull in `seedrandom` to keep the
 * dep surface minimal.
 */
function makeFixedRandom(seed: string): () => number {
	const { createHash } = require('node:crypto') as typeof import('node:crypto')
	const digest = createHash('sha256').update(seed).digest()
	let state = digest.readUInt32BE(0) || 1
	return function fixed(): number {
		state = (state + 0x9e3779b9) >>> 0
		let z = state
		z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
		z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
		z = (z ^ (z >>> 16)) >>> 0
		return z / 0x1_0000_0000
	}
}

function renderTokens(doc: PDFKit.PDFDocument, tokens: any[]): void {
	for (const t of tokens) {
		switch (t.type) {
			case 'heading': {
				const sizes = [22, 16, 13, 12, 11, 10]
				const size = sizes[Math.min(t.depth - 1, sizes.length - 1)] ?? 11
				doc.font('Helvetica-Bold').fontSize(size).text(t.text).moveDown(0.4)
				break
			}
			case 'paragraph': {
				doc.font('Helvetica').fontSize(11).text(t.text).moveDown(0.4)
				break
			}
			case 'list': {
				for (const item of t.items as any[]) {
					doc
						.font('Helvetica')
						.fontSize(11)
						.text(`• ${itemText(item)}`, { indent: 12 })
				}
				doc.moveDown(0.4)
				break
			}
			case 'code': {
				doc.font('Courier').fontSize(10).text(t.text, { indent: 12 }).moveDown(0.4)
				break
			}
			case 'hr': {
				doc.moveDown(0.4)
				const y = doc.y
				doc.strokeColor('#cccccc').moveTo(56, y).lineTo(556, y).stroke()
				doc.moveDown(0.4)
				break
			}
			case 'space':
			case 'html':
				// HTML tokens (including our section-fence comments) are filtered.
				break
			case 'blockquote': {
				doc
					.font('Helvetica-Oblique')
					.fontSize(11)
					.text(t.text ?? '', { indent: 12 })
					.moveDown(0.4)
				break
			}
			case 'table': {
				// Render as a monospace grid for determinism — no column-width math.
				const headers = (t.header as any[]).map((h) => h.text).join('  |  ')
				const rows = (t.rows as any[]).map((row) =>
					(row as any[]).map((c: any) => c.text).join('  |  '),
				)
				doc.font('Courier').fontSize(10).text(headers).text('-'.repeat(headers.length))
				for (const r of rows) doc.text(r)
				doc.moveDown(0.4)
				break
			}
			default:
				// Anything else (text, def, etc.) — render plain.
				if (typeof (t as any).text === 'string') {
					doc
						.font('Helvetica')
						.fontSize(11)
						.text((t as any).text)
						.moveDown(0.4)
				}
		}
	}
}

function itemText(item: any): string {
	if (typeof item.text === 'string') return item.text
	if (Array.isArray(item.tokens)) {
		return item.tokens.map((tok: any) => tok.text ?? '').join('')
	}
	return ''
}
