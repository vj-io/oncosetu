// A long scanned PDF is read page by page: every page reports progress, a retry resumes from the pages already read, and
// staff see "Reading page 7 of 16". The OCR here is a fake provider (no tesseract).
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { readingNote } from './queries'
import { readPages, type CachedPage, type OcrProvider } from './text'

const line = 'Patient Name: Asha Rao Haemoglobin 10.8 g/dL'
const words = line.split(' ').reduce<{ t: string; c: number; s: number; e: number; b: [number, number, number, number] }[]>((acc, t) => {
  const s = acc.length ? acc[acc.length - 1].e + 1 : 0
  return [...acc, { t, c: 0.9, s, e: s + t.length, b: [s, 0, s + t.length, 10] }]
}, [])

function provider() {
  const seen: number[] = []
  const p: OcrProvider = {
    name: 'fake-ocr', version: '1',
    recognize: async (_img, langs) => {
      if (langs === 'eng+hin') seen.push(seen.length + 1) // one entry per page: the first (eng+hin) pass
      return { text: line, words, lines: [{ text: line, conf: words.map((w) => w.c) }], mean: 0.9 }
    },
  }
  return { p, seen }
}

async function scannedPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    // Each page a different image, so nothing is shared between pages.
    const png = await sharp({ create: { width: 120 + i, height: 80, channels: 3, background: { r: 255 - i * 5, g: 255, b: 255 } } }).png().toBuffer()
    doc.addPage([300, 200]).drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 300, height: 200 })
  }
  return new Uint8Array(await doc.save())
}

describe('a long scanned PDF is read page by page', () => {
  it('reports "page n of total" before each page and the finished page after it', async () => {
    const { p } = provider()
    const events: string[] = []
    const r = await readPages(await scannedPdf(4), 'application/pdf', undefined, p, {
      onPage: ({ pageNo, total, page, fresh }) => { events.push(`${pageNo}/${total}:${page ? (fresh ? 'read' : 'cached') : 'start'}`) },
    })
    expect(r.kind === 'pages' && r.pages.map((x) => x.pageNo)).toEqual([1, 2, 3, 4])
    expect(events).toEqual(['1/4:start', '1/4:read', '2/4:start', '2/4:read', '3/4:start', '3/4:read', '4/4:start', '4/4:read'])
  })

  it('a retry resumes: pages already read are not OCR\'d again, and still come back with their image', async () => {
    const bytes = await scannedPdf(5)
    const first = provider()
    const saved = new Map<number, CachedPage>()
    // The first attempt dies after page 3 (as a crashed runner would): pages 1-3 were saved as they were read.
    await expect(readPages(bytes, 'application/pdf', undefined, first.p, {
      onPage: ({ pageNo, page, fresh }) => {
        if (page && fresh) saved.set(pageNo, { ...page, image: undefined } as CachedPage)
        if (pageNo === 4 && !page) throw new Error('runner died')
      },
    })).rejects.toThrow('runner died')
    expect([...saved.keys()]).toEqual([1, 2, 3])
    expect(first.seen).toHaveLength(3)

    const second = provider()
    const r = await readPages(bytes, 'application/pdf', undefined, second.p, { cached: saved })
    expect(second.seen).toHaveLength(2) // only pages 4 and 5
    expect(r.kind === 'pages' && r.pages.map((x) => [x.pageNo, x.text === line, x.image instanceof Buffer])).toEqual(
      [1, 2, 3, 4, 5].map((n) => [n, true, true]))
  })

  it('a cached page from another OCR version is read again', async () => {
    const bytes = await scannedPdf(2)
    const { p, seen } = provider()
    const stale: CachedPage = { pageNo: 1, text: 'old', words: [], ocrConfidence: 0.5, lowConfidence: true, source: 'ocr', handwriting: null, hidden: null, processor: 'fake-ocr', processorVersion: '0' }
    const r = await readPages(bytes, 'application/pdf', undefined, p, { cached: new Map([[1, stale]]) })
    expect(seen).toHaveLength(2)
    expect(r.kind === 'pages' && r.pages[0].text).toBe(line)
  })

  it('a hook that throws stops an image read instead of calling the file unreadable', async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer()
    await expect(readPages(new Uint8Array(png), 'image/png', undefined, provider().p, { onPage: () => { throw new Error('lock_lost') } })).rejects.toThrow('lock_lost')
  })
})

describe('what staff see while a long file is read', () => {
  const d = (over: Partial<Parameters<typeof readingNote>[0]> = {}) => ({ status: 'processing' as const, stage: 'text', readProgress: { page: 7, total: 16 }, ...over })
  it('"Reading page 7 of 16" only while processing the text stage of a multi-page file', () => {
    expect(readingNote(d())).toBe('Reading page 7 of 16')
    expect(readingNote(d({ readProgress: { page: 99, total: 16 } }))).toBe('Reading page 16 of 16')
    expect(readingNote(d({ readProgress: { page: 1, total: 1 } }))).toBeNull() // one page: nothing to count
    expect(readingNote(d({ readProgress: null }))).toBeNull()
    expect(readingNote(d({ stage: 'classified' }))).toBeNull()
    expect(readingNote(d({ status: 'queued' }))).toBeNull()
    expect(readingNote(d({ status: 'failed' }))).toBeNull()
  })
})
