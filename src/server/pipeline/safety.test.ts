import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { extractText, getDocumentProxy } from 'unpdf'
import { dHash, eicarScanner, hamming, hasEicar, NEAR_DUP_HAMMING, sanitisePdf, scanPdf, sniffMime, textSimilarity } from './safety'

const DOCS = join(process.cwd(), 'public', 'demo-docs')
const pdf = (name: string) => new Uint8Array(readFileSync(join(DOCS, name)))
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

describe('sniffMime (magic bytes, declared type ignored)', () => {
  it('recognises PDF, JPEG, PNG, WebP and HEIC', async () => {
    expect(sniffMime(pdf('hero__01-discharge-summary.pdf'))).toBe('application/pdf')
    expect(sniffMime(pdf('hero__03-ct-thorax-abdomen.jpg'))).toBe('image/jpeg')
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer()
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).webp().toBuffer()
    expect(sniffMime(png)).toBe('image/png')
    expect(sniffMime(webp)).toBe('image/webp')
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)])
    expect(sniffMime(heic)).toBe('image/heic')
  })
  it('rejects anything else, whatever its name', () => {
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull()
    expect(sniffMime(Buffer.from('MZ\x90\x00 executable'))).toBeNull()
    expect(sniffMime(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull() // zip
    expect(sniffMime(new Uint8Array())).toBeNull()
  })
})

describe('EICAR test signature (E-DOC-19)', () => {
  it('is found anywhere in the bytes', () => {
    expect(hasEicar(Buffer.from(EICAR))).toBe(true)
    expect(hasEicar(Buffer.concat([pdf('hero__09-mammography-2024.pdf'), Buffer.from(EICAR)]))).toBe(true)
    expect(hasEicar(pdf('hero__09-mammography-2024.pdf'))).toBe(false)
  })
  it('is the default MalwareScanner, labelled honestly (FR-ING-08, ADR-016)', async () => {
    expect(await eicarScanner.scan(Buffer.concat([pdf('hero__09-mammography-2024.pdf'), Buffer.from(EICAR)]))).toEqual({ infected: true, reason: 'eicar_signature' })
    expect(await eicarScanner.scan(pdf('hero__09-mammography-2024.pdf'))).toEqual({ infected: false, reason: null })
    expect(eicarScanner.label).toMatch(/signature check; full AV scan out of scope/)
  })
})

describe('scanPdf active content (E-DOC-05)', () => {
  it('passes every demo PDF', () => {
    for (const f of readdirSync(DOCS).filter((x) => x.endsWith('.pdf'))) expect(scanPdf(pdf(f)), f).toEqual([])
  })
  it('flags JavaScript, OpenAction→JS, Launch, embedded files, RichMedia and /AA', () => {
    const body = (s: string) => Buffer.from(`%PDF-1.7\n1 0 obj << ${s} >> endobj\n%%EOF`)
    expect(scanPdf(body('/Type /Catalog /OpenAction 2 0 R /S /JavaScript /JS (app.alert(1))'))).toEqual(['JS', 'JavaScript', 'OpenAction'])
    expect(scanPdf(body('/S /Launch /F (cmd.exe)'))).toEqual(['Launch'])
    expect(scanPdf(body('/Names << /EmbeddedFiles 3 0 R >>'))).toEqual(['EmbeddedFiles'])
    expect(scanPdf(body('/Type /EmbeddedFile'))).toEqual(['EmbeddedFile'])
    expect(scanPdf(body('/RichMedia 4 0 R'))).toEqual(['RichMedia'])
    expect(scanPdf(body('/AA << /O 5 0 R >>'))).toEqual(['AA'])
  })
  it('sees through #-escaped names and Flate-compressed object streams', () => {
    expect(scanPdf(Buffer.from('%PDF-1.7\n1 0 obj << /S /J#61vaScript >> endobj'))).toEqual(['JavaScript'])
    const hidden = deflateSync(Buffer.from('<< /S /JavaScript /JS (x) >>'))
    const objStm = Buffer.concat([Buffer.from('%PDF-1.7\n5 0 obj << /Type /ObjStm /Filter /FlateDecode >>\nstream\n'), hidden, Buffer.from('\nendstream\nendobj')])
    expect(scanPdf(objStm)).toEqual(['JS', 'JavaScript'])
  })
  it('does not flag /OpenAction alone (jump to a page is benign)', () => {
    expect(scanPdf(Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction [3 0 R /Fit] >> endobj'))).toEqual([])
  })
})

describe('sanitisePdf strips active content and keeps the page (FR-ING-08)', () => {
  /** A real one-page report with JavaScript (document-level, OpenAction, page /AA), a Launch link and an embedded file. */
  async function hostilePdf() {
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 300])
    page.drawText('Discharge summary. Synthetic patient. Haemoglobin 11.2 g/dL.', { x: 20, y: 250, size: 10, font: await doc.embedFont(StandardFonts.Helvetica) })
    doc.addJavaScript('boot', 'app.alert(1)')
    await doc.attach(Buffer.from('MZ synthetic payload'), 'payload.exe', { mimeType: 'application/octet-stream' })
    const ctx = doc.context
    const js = ctx.register(ctx.obj({ S: 'JavaScript', JS: 'app.launchURL(1)' }))
    doc.catalog.set(PDFName.of('OpenAction'), js)
    page.node.set(PDFName.of('AA'), ctx.obj({ O: js }))
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: { S: 'Launch', F: 'cmd.exe' } }))
    page.node.set(PDFName.of('Annots'), ctx.obj([link]))
    return doc.save({ useObjectStreams: false })
  }
  const text = async (b: Uint8Array) => (await extractText(await getDocumentProxy(b.slice()), { mergePages: true })).text

  it('removes JavaScript, auto-open and page actions, Launch and the embedded file; the text survives', async () => {
    const bad = await hostilePdf()
    expect(scanPdf(bad)).toEqual(['AA', 'EmbeddedFile', 'EmbeddedFiles', 'JS', 'JavaScript', 'Launch', 'OpenAction'])
    const clean = await sanitisePdf(bad)
    expect(clean).not.toBeNull()
    expect(scanPdf(clean!)).toEqual([]) // raw bytes and every inflated stream
    const raw = Buffer.from(clean!).toString('latin1')
    for (const s of ['/JavaScript', '/JS', '/OpenAction', '/AA', '/Launch', '/EmbeddedFile', 'payload.exe', 'cmd.exe']) expect(raw, s).not.toContain(s)
    expect((await PDFDocument.load(clean!)).getPageCount()).toBe(1)
    expect(await text(clean!)).toContain('Haemoglobin 11.2 g/dL')
    expect(Buffer.from((await sanitisePdf(bad))!).equals(Buffer.from(clean!))).toBe(true) // deterministic: a re-upload still dedupes
  })
  it('handles a hand-written PDF with no xref and a #-escaped action name', async () => {
    const hand = Buffer.from([
      '%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 4 0 R>>endobj', '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj', '4 0 obj<</S/J#61vaScript/JS(app.alert\\(1\\))>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF',
    ].join('\n'), 'latin1')
    expect(scanPdf(hand)).toEqual(['JS', 'JavaScript', 'OpenAction'])
    const clean = await sanitisePdf(hand)
    expect(clean && scanPdf(clean)).toEqual([])
  })
  it('gives up (the caller quarantines) on a PDF it cannot parse', async () => {
    expect(await sanitisePdf(Buffer.from('%PDF-1.7\n1 0 obj << /S /JavaScript /JS (x) >> endobj\n%%EOF'))).toBeNull()
  })
})

describe('dHash near-duplicates (E-DOC-02)', () => {
  it('a re-photographed (resized, recompressed, slightly brighter) page stays within Hamming 6', async () => {
    const orig = pdf('hero__03-ct-thorax-abdomen.jpg')
    const retake = await sharp(orig).resize(1200).modulate({ brightness: 1.06 }).jpeg({ quality: 60 }).toBuffer()
    const d = hamming(await dHash(orig), await dHash(retake))
    expect(d).toBeLessThanOrEqual(NEAR_DUP_HAMMING)
  })
  it('different documents are far apart', async () => {
    const a = await dHash(pdf('hero__03-ct-thorax-abdomen.jpg'))
    const b = await dHash(pdf('hero__05-prescription-handwritten.jpg'))
    expect(hamming(a, b)).toBeGreaterThan(NEAR_DUP_HAMMING)
  })
  it('hamming counts differing bits', () => {
    expect(hamming('0000000000000000', '0000000000000000')).toBe(0)
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64)
    expect(hamming('0000000000000001', '0000000000000003')).toBe(1)
  })
})

describe('textSimilarity (FR-ING-06 ≥ 0.95 for text PDFs)', () => {
  it('is 1 for identical text, high for a one-word change, low for different reports', () => {
    const a = 'Patient Name Sunita Deshmukh Date of Admission 10/03/2026 Wide local excision done on 12/03/2026 under GA specimen sent'
    expect(textSimilarity(a, a)).toBe(1)
    expect(textSimilarity(a, a + ' Page 1 of 1')).toBeGreaterThan(0.8)
    expect(textSimilarity(a, 'Complete blood count haemoglobin 10.8 g/dL platelets 1.48 lakh')).toBeLessThan(0.1)
  })
})
