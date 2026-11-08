// FR-ING-06 near-duplicate recall on a small synthetic duplicate set (PRD: near-dup recall >= 0.9), built here from the
// demo documents so nothing new is stored: every image re-photographed or re-scanned six ways (re-encoded smaller,
// tilted, brighter, cropped, sent on as a phone-sized PNG, slightly out of focus) and every typed PDF forwarded twice
// (same pages, new bytes) or re-exported by another program (same words, new layout). Each pair goes through the same
// test intake uses: perceptual hash (Hamming <= 6) for images, word-trigram similarity (>= 0.95) for PDF text.
// Pairs of different documents must not be flagged. The end-to-end flag (intake + pipeline) is tested in
// tests/integration/document-integrity.test.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { dHash, hamming, NEAR_DUP_HAMMING, textSimilarity } from './safety'
import { readPages } from './text'

const DOCS = join(process.cwd(), 'public', 'demo-docs')
const files = readdirSync(DOCS).sort()
const images = files.filter((f) => f.endsWith('.jpg'))
const pdfs = files.filter((f) => f.endsWith('.pdf'))

const IMAGE_VARIANTS: Record<string, (b: Buffer) => Promise<Buffer>> = {
  'reencoded smaller': (b) => sharp(b).resize({ width: 1600 }).jpeg({ quality: 60 }).toBuffer(),
  'tilted 1 degree': (b) => sharp(b).rotate(1, { background: '#ffffff' }).jpeg().toBuffer(),
  'brighter': (b) => sharp(b).modulate({ brightness: 1.12 }).jpeg().toBuffer(),
  'cropped 2%': async (b) => {
    const m = await sharp(b).metadata()
    const dx = Math.round(m.width! * 0.02), dy = Math.round(m.height! * 0.02)
    return sharp(b).extract({ left: dx, top: dy, width: m.width! - 2 * dx, height: m.height! - 2 * dy }).jpeg().toBuffer()
  },
  'phone png': (b) => sharp(b).resize({ width: 1080 }).png().toBuffer(),
  'out of focus': (b) => sharp(b).blur(1.2).jpeg({ quality: 75 }).toBuffer(),
}

const pdfText = async (bytes: Uint8Array) => {
  const r = await readPages(bytes, 'application/pdf')
  if (r.kind !== 'pages') throw new Error(r.kind)
  return r.pages.map((p) => p.text).join('\n')
}

/** The same words typeset again by another program (one line per text line, Helvetica 9 pt, new page breaks). */
async function reexport(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  let page = doc.addPage([595, 842])
  let y = 800
  const lines = text.split('\n').flatMap((raw) => {
    const line = [...raw.replace(/\t/g, '    ')].filter((c) => { try { font.encodeText(c); return true } catch { return false } }).join('')
    return line.match(/.{1,100}(?:\s|$)|\S+/g) ?? [''] // wrapped at a space, never cut
  })
  for (const line of lines) {
    if (y < 40) { page = doc.addPage([595, 842]); y = 800 }
    if (line.trim()) page.drawText(line, { x: 30, y, size: 9, font })
    y -= 12
  }
  doc.setProducer('Another PDF printer')
  return doc.save()
}

type Pair = { kind: string; source: string; flagged: boolean; score: number }

describe('near-duplicate detection on a synthetic duplicate set (FR-ING-06)', () => {
  it('finds at least 90% of re-photographed, re-scanned, forwarded and re-exported copies, and flags no distinct pair', async () => {
    const pairs: Pair[] = []
    const hashes = new Map<string, string>()
    for (const f of images) {
      const original = readFileSync(join(DOCS, f))
      const h = await dHash(original)
      hashes.set(f, h)
      for (const [kind, make] of Object.entries(IMAGE_VARIANTS)) {
        const d = hamming(h, await dHash(await make(original)))
        pairs.push({ kind: `image: ${kind}`, source: f, flagged: d <= NEAR_DUP_HAMMING, score: d })
      }
    }
    const texts = new Map<string, string>()
    for (const f of pdfs) {
      const original = new Uint8Array(readFileSync(join(DOCS, f)))
      const text = await pdfText(original)
      texts.set(f, text)
      const fwd = await PDFDocument.load(original)
      fwd.setProducer('WhatsApp forward')
      fwd.setModificationDate(new Date('2026-07-02T10:00:00Z'))
      for (const [kind, copy] of [['pdf: forwarded twice', await fwd.save()], ['pdf: re-exported', await reexport(text)]] as const) {
        const s = textSimilarity(text, await pdfText(copy))
        pairs.push({ kind, source: f, flagged: s >= 0.95, score: Math.round(s * 1000) / 1000 })
      }
    }

    const recall = pairs.filter((p) => p.flagged).length / pairs.length
    const byKind = Object.fromEntries([...new Set(pairs.map((p) => p.kind))].map((k) => {
      const ps = pairs.filter((p) => p.kind === k)
      return [k, `${ps.filter((p) => p.flagged).length}/${ps.length}`]
    }))
    console.log(`near-duplicate recall ${recall.toFixed(3)} on ${pairs.length} pairs`, byKind, pairs.filter((p) => !p.flagged).map((p) => `${p.kind} ${p.source} ${p.score}`))
    expect(pairs.length).toBeGreaterThanOrEqual(60)
    expect(recall).toBeGreaterThanOrEqual(0.9)
    expect(pairs.filter((p) => p.kind === 'pdf: forwarded twice').every((p) => p.flagged)).toBe(true)

    // Different documents of the same family must not look like copies of each other.
    const imgs = [...hashes]
    for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(hamming(imgs[i][1], imgs[j][1]), `${imgs[i][0]} vs ${imgs[j][0]}`).toBeGreaterThan(NEAR_DUP_HAMMING)
    const docs = [...texts]
    for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) expect(textSimilarity(docs[i][1], docs[j][1]), `${docs[i][0]} vs ${docs[j][0]}`).toBeLessThan(0.95)
  }, 120_000)
})
