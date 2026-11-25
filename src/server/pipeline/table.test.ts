import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { analyse, headerFor } from './core'
import { clearBorders, pairCells, traceRules, verticalRules, wipeEdges } from './table'
import { readPages, tesseractOcr, type OcrProvider } from './text'

// A ruled header table read cell by cell (25 Nov 2026). Synthetic pixels and synthetic report text only.

/** A greyscale canvas, white, with dark rectangles drawn into it. */
const canvas = (W: number, H: number, rects: [number, number, number, number][]) => {
  const px = new Uint8Array(W * H).fill(255)
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[y * W + x] = 0
  return { px, dark: (x: number, y: number) => px[y * W + x] < 128 }
}

describe('finding the grid', () => {
  it('vertical rules are long unbroken runs; a column of stacked letters is not one', () => {
    // rules at x 10, 150 and 390; the first letters of three label rows stacked at x 50, 15 px each with gaps
    const { dark } = canvas(400, 100, [[10, 0, 12, 100], [150, 0, 152, 100], [390, 0, 392, 100], [50, 10, 53, 25], [50, 40, 53, 55], [50, 70, 53, 85]])
    expect(verticalRules(dark, 400, 100, 45).map((x) => Math.round(x))).toEqual([11, 151, 391])
  })
  it('a tilted, bending rule is traced across its block; a short stroke is not a rule', () => {
    const W = 300, H = 80
    const rects: [number, number, number, number][] = []
    for (let x = 0; x < W; x++) { const y = Math.round(20 + x * 0.04 + 3 * Math.sin(x / 60)); rects.push([x, y, x + 1, y + 3]) }
    rects.push([0, 60, 40, 63]) // a 40 px stroke (an underline, a dash)
    const rules = traceRules(canvas(W, H, rects).dark, 0, W - 1, H)
    expect(rules).toHaveLength(1)
    const truth = (x: number) => 20 + x * 0.04 + 3 * Math.sin(x / 60)
    expect(rules[0].every((y, x) => Math.abs(y - truth(x)) <= 3)).toBe(true)
  })
  it('wipes a rule left at a cell edge and keeps the strokes inside (the 1 of "41", the stem of "F")', () => {
    const W = 300, H = 60
    const { px } = canvas(W, H, [[0, 1, W, 4], [2, 0, 5, H], [150, 0, 154, H], [100, 10, 104, 52], [170, 29, 290, 32]])
    wipeEdges(px, W, H)
    const darkIn = (x0: number, y0: number, x1: number, y1: number) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (px[y * W + x] < 128) n++; return n }
    expect(darkIn(20, 1, W, 4)).toBe(0) // the rule along the top
    expect(darkIn(2, 10, 5, H)).toBe(0) // the cell border on the left
    expect(darkIn(150, 0, 154, H)).toBe(4 * (H - 3)) // a full-height stroke in the middle stays, but where the top rule crosses it
    expect(darkIn(100, 10, 104, 52)).toBe(4 * 42)
    expect(darkIn(170, 29, 290, 32)).toBe(120 * 3) // a dash across the middle ("------") is the cell's value, not a rule
  })
  it('clears what a cut leaves of a rule at the cell edge, grey edges too, and keeps glyphs that reach an edge', () => {
    const W = 300, H = 60
    const { px } = canvas(W, H, [[295, 5, W, 55], [200, 20, 206, H], [0, 20, 30, 45], [100, 15, 110, 45]])
    for (let y = 0; y < 3; y++) for (let x = 40; x < 120; x++) px[y * W + x] = 160 // a rule's soft grey edge along the top
    clearBorders(px, W, H)
    const inkIn = (x0: number, y0: number, x1: number, y1: number) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (px[y * W + x] < 255) n++; return n }
    expect(inkIn(40, 0, 120, 3)).toBe(0) // the grey edge, which OCR reads as ink
    expect(inkIn(295, 5, W, 55)).toBe(0) // a sliver of the right rule (reads as "I")
    expect(inkIn(200, 20, 206, H)).toBe(6 * 40) // a tall glyph down to the bottom edge stays
    expect(inkIn(0, 20, 30, 45)).toBe(30 * 25) // a wide glyph at the left edge stays
    expect(inkIn(100, 15, 110, 45)).toBe(10 * 30)
  })
})

describe('pairing label cells with value cells', () => {
  const cell = (block: number, y: number, text: string, h = 28, x0 = block * 200) => ({ block, x0, x1: x0 + 190, top: [y, y], bot: [y + h, y + h], text, conf: 0.9 })
  it('each label cell takes the value cell to its right on the same row; two-line cells pair line by line', () => {
    const lines = pairCells([
      cell(0, 0, '‘Patient Name'), cell(1, 1, 'Mrs. Asha Testkar ~~'), cell(0, 28, 'Patient ID'), cell(1, 29, 'PET/2026/0412'),
      cell(0, 56, 'Study Date\nTime\t|', 56), cell(1, 57, '03 Mar 2026\n10:15am\t|', 56),
    ])
    expect(lines.map((l) => `${l.label} | ${l.value}`)).toEqual(['Patient Name | Mrs. Asha Testkar', 'Patient ID | PET/2026/0412', 'Study Date | 03 Mar 2026', 'Time | 10:15am'])
  })
  it('a label pairs with nothing when its value cell is empty, is itself a label, sits on another row, or holds another number of lines', () => {
    expect(pairCells([cell(0, 0, 'Age')])).toEqual([]) // no value cell read
    expect(pairCells([cell(0, 0, 'Age'), cell(1, 0, 'Sex')])).toEqual([]) // the next cell is a label too
    expect(pairCells([cell(0, 0, 'Age'), cell(1, 20, '47Yr')])).toEqual([]) // a row away
    expect(pairCells([cell(0, 0, 'Study Date\nTime', 56), cell(1, 0, '03 Mar 2026', 56)])).toEqual([])
    expect(pairCells([cell(0, 0, 'Clinical history'), cell(1, 0, 'Known case')])).toEqual([]) // not a header label
    expect(pairCells([cell(2, 0, 'Age'), cell(1, 0, '47Yr', 28, 400)])).toEqual([]) // a value cell left of its label
  })
})

/**
 * Synthetic photos of a ruled two-block header table (grey paper, tilted, slightly soft), made once by
 * scripts/test-fixtures/ruled-table.ts and read from disk: SVG text renders with each machine's own fonts, so a test that drew
 * the table itself would hand OCR other pixels on CI than here.
 */
const FIXTURES = join(process.cwd(), 'data', 'fixtures', 'ruled-table')
const photo = (file: string) => new Uint8Array(readFileSync(join(FIXTURES, file)))

describe('a photographed ruled header table, end to end', () => {
  const PATIENT = { name: 'Asha Testkar', aliases: [], dob: '1978-06-01', sex: 'female' } // 47 on 05 Mar 2026
  const RECEIVED = new Date('2026-11-20T06:00:00Z')
  const counting = () => { const p = { ...tesseractOcr, lines: 0 }; p.recognizeLine = async (img) => { p.lines++; return tesseractOcr.recognizeLine!(img) }; return p as OcrProvider & { lines: number } }
  const read = async (file: string, provider: OcrProvider = tesseractOcr) => {
    const r = await readPages(photo(file), 'image/jpeg', undefined, provider)
    if (r.kind !== 'pages') throw new Error(r.kind)
    return r.pages[0]
  }
  it.each(['full.jpg', 'full-serif.jpg', 'full-liberation.jpg'])('%s: reads every field, keeps the body, and every word is an exact slice of the page text', async (file) => {
    const p = await read(file)
    const h = headerFor(p.text)
    expect({ name: h.name?.value, age: h.age?.years, sex: h.sex?.sex, id: h.mrn?.value, date: h.reportDate?.value })
      .toEqual({ name: 'Mrs. Asha Testkar', age: 47, sex: 'F', id: 'PET/2026/0412', date: '05 Mar 2026' })
    expect(p.text).toContain('Impression: Complete metabolic response to therapy.')
    expect((p.words ?? []).every((w) => p.text.slice(w.s, w.e) === w.t)).toBe(true)
    expect((await analyse([p], PATIENT, RECEIVED)).identified.identity).toMatchObject({ result: 'match' })
  }, 60_000)
  it('the wrong patient still does not pass: another age, the other sex, or only a name', async () => {
    const id = async (file: string) => (await analyse([await read(file)], PATIENT, RECEIVED)).identified.identity
    expect(await id('age-52.jpg')).toMatchObject({ result: 'mismatch', reasons: ['age_mismatch'] })
    expect(await id('sex-male.jpg')).toMatchObject({ result: 'mismatch', reasons: ['sex_mismatch'] })
    expect((await id('name-only.jpg')).result).not.toBe('match')
  }, 120_000)
  it('a label whose value cell is blank gives no value', async () => {
    const h = headerFor((await read('age-blank.jpg')).text)
    expect(h.age).toBeUndefined()
    expect(h.sex?.sex).toBe('F')
  }, 60_000)
  it('the same header without ruled lines reads no cells at all', async () => {
    const p = counting()
    await read('unruled.jpg', p)
    expect(p.lines).toBeLessThanOrEqual(2) // the header date strips at most; no table cells
  }, 60_000)
})

describe('when the cell reading replaces the page OCR', () => {
  // A plain ruled grid, 2 columns x 3 rows (rules at y 100, 130, 160, 190; columns at x 100 | 400 | 800), and a fake OCR:
  // the page read is scripted, and every cell read answers in turn from `cellTexts` (column by column, top to bottom).
  const gridPng = async (cols = [100, 400, 800], rows = [100, 130, 160, 190]) => {
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200"><rect width="100%" height="100%" fill="#fff"/>'
    for (const y of rows) svg += `<rect x="${cols[0]}" y="${y}" width="${cols.at(-1)! - cols[0]}" height="3"/>`
    for (const x of cols) svg += `<rect x="${x}" y="${rows[0]}" width="3" height="${rows.at(-1)! - rows[0] + 3}"/>`
    return sharp(Buffer.from(`${svg}</svg>`)).flatten({ background: '#fff' }).png().toBuffer()
  }
  const scripted = (pageLines: [string, number][], cellTexts: string[]) => {
    let text = ''
    const words: { t: string; c: number; s: number; e: number; b: [number, number, number, number] }[] = []
    for (const [line, y] of pageLines) {
      if (text) text += '\n'
      for (const tok of line.split(/(\s+)/)) {
        if (!tok.trim()) { text += tok; continue }
        const s = text.length
        text += tok
        words.push({ t: tok, c: 0.9, s, e: text.length, b: [110 + s * 3, y, 110 + s * 3 + tok.length * 9, y + 18] })
      }
    }
    const ocr = { text, words, lines: [], mean: 0.9 }
    const p = { name: 'fake', version: '1', lines: 0, recognize: async () => ocr, recognizeLine: async () => ({ text: cellTexts[p.lines++] ?? '', words: [], lines: [], mean: 0.9 }) }
    return { p, ocr }
  }
  const BODY: [string, number][] = [['FINDINGS: No focal lesion in the lungs.', 600], ['IMPRESSION: Normal study.', 640]]
  const table = (pageLines: [string, number][], cells: string[]) => scripted([['CITY IMAGING CENTRE', 40], ...pageLines, ...BODY], cells)
  const run = async (s: ReturnType<typeof table>) => (await import('./table')).readHeaderTable(s.ocr, await gridPng(), s.p)
  const CELLS = ['Patient Name', 'Age', 'Sex', 'Asha Testkar', '47Yr', 'Female']

  it('a header the page OCR read whole is left alone, and no cell is read', async () => {
    const s = table([['Patient Name: Asha Testkar', 106], ['Age: 47 Yrs  Sex: Female', 136]], CELLS)
    expect(await run(s)).toBe(s.ocr)
    expect(s.p.lines).toBe(0)
  })
  it('a garbled header gives way to the cells: label <TAB> value lines, the rest kept, every offset exact', async () => {
    const s = table([['Patient Xqw7 ~~ ##', 106], ['Ag| 4 Sx', 136], ['Referral Dr ##', 166]], CELLS)
    const out = await run(s)
    expect(out.text.split('\n')).toEqual(['CITY IMAGING CENTRE', 'Patient Name\tAsha Testkar', 'Age\t47Yr', 'Sex\tFemale', ...BODY.map(([l]) => l)])
    expect(out.words.every((w) => out.text.slice(w.s, w.e) === w.t)).toBe(true)
  })
  it('cells that would lose a field the page OCR found, or add none, change nothing', async () => {
    // the page read a report date the cells do not hold
    const lost = table([['Patient Xqw7 ~~', 106], ['Report Date: 05 Mar 2026', 136], ['Referral Dr ##', 166]], CELLS)
    expect((await run(lost)).text).toBe(lost.ocr.text)
    // the cells hold only the name the page already read
    const same = table([['Patient Name: Asha Testkar', 106], ['Ag| 4', 136], ['Referral Dr ##', 166]], ['Patient Name', 'Referral Dr', 'Asha Testkar', 'Dr A Rao'])
    expect((await run(same)).text).toBe(same.ocr.text)
  })
  it('only the file\'s first page is read cell by cell (it carries the header the identity check reads)', async () => {
    const s = table([['Patient Xqw7 ~~ ##', 106], ['Ag| 4 Sx', 136], ['Referral Dr ##', 166]], [...CELLS, ...CELLS])
    const doc = await PDFDocument.create()
    const png = await doc.embedPng(await gridPng())
    for (let i = 0; i < 2; i++) doc.addPage([1000, 1200]).drawImage(png, { x: 0, y: 0, width: 1000, height: 1200 })
    const r = await readPages(new Uint8Array(await doc.save()), 'application/pdf', undefined, { ...s.p, recognize: async () => s.ocr })
    expect(r.kind === 'pages' && r.pages.map((pg) => pg.text.includes('Age\t47Yr'))).toEqual([true, false])
    expect(s.p.lines).toBe(6)
  })
  it('a gap between double rules is no cell', async () => {
    const s = table([['Patient Xqw7 ~~ ##', 106], ['Ag| 4 Sx', 136], ['Referral Dr ##', 166]], CELLS)
    const out = await (await import('./table')).readHeaderTable(s.ocr, await gridPng([100, 400, 800], [94, 100, 130, 160, 190]), s.p)
    expect(s.p.lines).toBe(6)
    expect(out.text).toContain('Age\t47Yr')
  })
  it('with one label line read, the band is the page\'s top 45%, and a table much shorter than that is still read', async () => {
    // a rule must span two rows of the table, not a share of the band: 90 px of rules in a 540 px band
    const s = table([['Patient Xqw7 ~~ ##', 106], ['## 4 Sx', 136]], CELLS)
    const out = await run(s)
    expect(s.p.lines).toBe(6)
    expect(out.text).toContain('Age\t47Yr')
  })
  it('rows the page OCR garbled between two label lines stay in the band, down to the last row', async () => {
    // six rows; the page OCR read labels on the first two rows and the last, and noise between them
    const rows = [100, 130, 160, 190, 220, 250, 280]
    const s = table([['Patient Xqw7 ~~ ##', 106], ['Patient ~~ ##', 136], ['~~ ## ~', 166], ['## ~~', 196], ['~ ##', 226], ['Report Dxte ~~', 256]],
      ['Patient Name', 'Patient ID', 'Referral Dr', 'Age', 'Sex', 'Report Date', 'Asha Testkar', 'PET/1', 'Dr A Rao', '47Yr', 'Female', '05 Mar 2026'])
    const out = await (await import('./table')).readHeaderTable(s.ocr, await gridPng([100, 400, 800], rows), s.p)
    expect(out.text).toContain('Sex\tFemale')
    expect(out.text).toContain('Report Date\t05 Mar 2026')
  })
  it('reads at most 40 cells, however many the grid has', async () => {
    // no label line read: the band is the page's top 45%; 2 columns x 27 rows of blank cells, 16 px apart
    const rows = Array.from({ length: 28 }, (_, i) => 100 + i * 16)
    const s = table([['Xqw7 ~~', 106], ['## 4', 136]], [])
    await (await import('./table')).readHeaderTable(s.ocr, await gridPng([100, 400, 800], rows), s.p)
    expect(s.p.lines).toBe(40)
  })
})
