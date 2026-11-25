// A ruled header table read cell by cell (25 Nov 2026). A phone photo of a printed report with a bordered grid of label and
// value cells ("Patient Name | Asha Rao", "Age | 47Yr"): tesseract's single-block page mode keeps the grid's lines, merges
// neighbouring rows into one tall word and reads the cells as noise, while the same cells cut out one by one read cleanly.
// Pure over the page image and its first OCR; OCR through the page's provider.
import sharp from 'sharp'
import type { OcrWord } from '@/db/schema'
import { parseHeader } from '@/core/extract/header'
import type { OcrProvider, OcrResult } from './text'

/** A line of the header that holds a header label. */
const LABEL_LINE = /(?<![\p{L}])(?:Patient|Name|Age|Sex|Gender|UHID|MRN|Referr\w*|Ref|Study|Report\w*|Date|Time|Collected|Received|Lab\s*No|Reg)(?![\p{L}])/iu
/** A label cell's line: a header label alone. */
const LABEL_CELL = /^(?:(?:Patient(?:'s)?\s+)?(?:Name|ID|UHID|MRN)|Patient|Age|Sex|Gender|Age\s*\/\s*Sex|Referral\s+Dr\.?|Referring\s+(?:Dr\.?|Doctor)|Ref(?:erred|\.)?\s*(?:By|Dr\.?)|(?:Study|Report|Reported|Collection|Sample|Visit|Scan|Exam)\s+Date|Date|Time|Lab\s*No\.?|Reg(?:n|istration)?\.?\s*No\.?)\s*[:.|]?$/i
const HEADER_LINES = 15
const MAX_CELLS = 40

type Rect = [number, number, number, number]
type Cell = { block: number; x0: number; x1: number; top: number[]; bot: number[]; text: string; conf: number }

const runs = (n: number, on: (i: number) => boolean) => {
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) { if (!on(i)) continue; let e = i; while (e + 1 < n && on(e + 1)) e++; out.push([i, e]); i = e }
  return out
}

/** Vertical rules: columns (±1 px, for tilt) holding one continuous dark run over >= 30% of the band; stacked glyphs break. */
export function verticalRules(dark: (x: number, y: number) => boolean, W: number, H: number): number[] {
  const longest = (x: number) => {
    let best = 0, run = 0
    for (let y = 0; y < H; y++) { if (dark(x, y) || (x > 0 && dark(x - 1, y)) || (x + 1 < W && dark(x + 1, y))) { run++; if (run > best) best = run } else run = 0 }
    return best
  }
  const col = Array.from({ length: W }, (_, x) => longest(x))
  return runs(W, (x) => col[x] >= H * 0.3).map(([a, b]) => Math.round((a + b) / 2))
}

/**
 * Horizontal rules of one block (xa..xb), traced column by column so a tilted or curved line (a photographed page bends) is
 * followed: seeds are rows dark on >= 10 of the block's first 12 columns; each trace steps right to the dark pixel nearest
 * its last y (within 2 px), bridging gaps of up to 12 columns. A trace dark on >= 70% of the block's columns is a rule. Returns each rule's y per column, top to bottom.
 */
export function traceRules(dark: (x: number, y: number) => boolean, xa: number, xb: number, H: number): number[][] {
  const w = xb - xa + 1
  const seed = (y: number) => { let n = 0; for (let x = xa; x < xa + 12 && x <= xb; x++) if (dark(x, y)) n++; return n >= 10 }
  const rules: number[][] = []
  for (const [a, b] of runs(H, seed)) {
    const ys: number[] = []
    let y = Math.round((a + b) / 2), hits = 0, gap = 0
    for (let i = 0; i < w; i++) {
      const x = xa + i
      let found = -1
      for (let d = 0; d <= 2 && found < 0; d++) for (const yy of [y - d, y + d]) if (yy >= 0 && yy < H && dark(x, yy)) { found = yy; break }
      if (found >= 0) { y = found; hits++; gap = 0 } else if (++gap > 12) break
      ys.push(y)
    }
    if (hits >= w * 0.7 && !rules.some((r) => Math.abs(r[0] - ys[0]) < 4)) {
      while (ys.length < w) ys.push(ys[ys.length - 1])
      rules.push(ys)
    }
  }
  return rules.sort((p, q) => p[0] - q[0])
}

/**
 * Erases what is left of the rules at a cell's edges: horizontal dark runs over >= 30% of its width in its top or bottom
 * fifth, vertical runs over >= 85% of its height in its left or right 6%. Strokes inside (the 1 of "41", the stem of "F") stay.
 */
export function wipeEdges(px: Uint8Array, W: number, H: number): void {
  const kill = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    if (y >= H * 0.2 && y <= H * 0.8) continue
    for (let x = 0, run = 0; x <= W; x++) {
      if (x < W && px[y * W + x] < 128) { run++; continue }
      if (run >= W * 0.3) for (let k = x - run; k < x; k++) kill[y * W + k] = 1
      run = 0
    }
  }
  for (let x = 0; x < W; x++) {
    if (x >= W * 0.06 && x <= W * 0.94) continue
    for (let y = 0, run = 0; y <= H; y++) {
      if (y < H && px[y * W + x] < 128) { run++; continue }
      if (run >= H * 0.85) for (let k = y - run; k < y; k++) kill[k * W + x] = 1
      run = 0
    }
  }
  for (let i = 0; i < W * H; i++) if (kill[i]) px[i] = 255
}

/** Every cell of the ruled grid in a greyscale band (W x H), read through the provider. `textH`: the text's height in px. */
export async function readCells(g: Uint8Array, W: number, H: number, textH: number, provider: OcrProvider & Required<Pick<OcrProvider, 'recognizeLine'>>): Promise<Cell[]> {
  const dark = (x: number, y: number) => g[y * W + x] < 128
  const vr = verticalRules(dark, W, H)
  const cells: Cell[] = []
  let reads = 0
  for (let i = 0; i + 1 < vr.length; i++) {
    const xa = vr[i] + 3, xb = vr[i + 1] - 3
    if (xb - xa < Math.max(3 * textH, W * 0.04)) continue
    const rules = traceRules(dark, xa, xb, H)
    for (let k = 0; k + 1 < rules.length && reads < MAX_CELLS; k++) {
      const top = rules[k], bot = rules[k + 1], w = xb - xa + 1
      const tall = Math.max(...bot.map((y, j) => y - top[j]))
      if (bot[0] - top[0] < textH * 0.8) continue
      // the cell between the two traced rules, 3 px inside each, column by column
      const h = Math.max(1, tall - 6)
      const px = new Uint8Array(w * h).fill(255)
      for (let j = 0; j < w; j++) for (let r = 0; top[j] + 3 + r <= bot[j] - 3 && r < h; r++) px[r * w + j] = g[(top[j] + 3 + r) * W + xa + j]
      const big = await sharp(px, { raw: { width: w, height: h, channels: 1 } }).resize({ width: w * 3 }).normalise().extractChannel(0).raw().toBuffer({ resolveWithObject: true })
      wipeEdges(big.data, big.info.width, big.info.height)
      const png = await sharp(big.data, { raw: { width: big.info.width, height: big.info.height, channels: 1 } }).png().toBuffer()
      // a cell of two lines ("Study Date / Time") is read as a block, a cell of one line as one line
      reads++
      const read = tall > textH * 1.8 ? await provider.recognize(png, 'eng') : await provider.recognizeLine(png)
      const text = read.text.trim()
      if (text) cells.push({ block: i, x0: xa, x1: xb, top, bot, text, conf: read.mean ?? 0.5 })
    }
  }
  return cells
}

export type TableLine = { y: number; label: string; value: string; labelRect: Rect; valueRect: Rect; conf: number }

/**
 * Pairs each label cell with the value cell to its right: the cell of the next block whose middle, where the two cells meet,
 * is within half the label cell's height. A cell of two label lines pairs line by line with a cell of two values. A label
 * whose value cell is empty or itself a label, or whose rows do not line up, pairs with nothing.
 */
export function pairCells(cells: readonly Pick<Cell, 'block' | 'x0' | 'x1' | 'top' | 'bot' | 'text' | 'conf'>[]): TableLine[] {
  // a cell's lines, without the marks a rule or the paper leaves at their ends ("‘Patient Name", "6:20pm\t|")
  const lines = (t: string) => t.split('\n').map((l) => l.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)]+$/gu, '')).filter(Boolean)
  const midStart = (c: (typeof cells)[number]) => (c.top[0] + c.bot[0]) / 2
  const midEnd = (c: (typeof cells)[number]) => (c.top.at(-1)! + c.bot.at(-1)!) / 2
  const rect = (c: (typeof cells)[number]): Rect => [c.x0, Math.min(...c.top), c.x1, Math.max(...c.bot)]
  const out: TableLine[] = []
  const used = new Set<(typeof cells)[number]>()
  for (const c of cells) {
    const labels = lines(c.text)
    if (!labels.length || !labels.every((l) => LABEL_CELL.test(l))) continue
    const half = (c.bot.at(-1)! - c.top.at(-1)!) / 2
    const v = cells.filter((d) => d.block === c.block + 1 && !used.has(d) && Math.abs(midStart(d) - midEnd(c)) < half)
      .sort((p, q) => Math.abs(midStart(p) - midEnd(c)) - Math.abs(midStart(q) - midEnd(c)))[0]
    if (!v) continue
    const values = lines(v.text)
    if (values.length !== labels.length || values.some((x) => LABEL_CELL.test(x))) continue
    used.add(v)
    labels.forEach((l, k) => out.push({
      y: midEnd(c) + k, label: l.replace(/\s*[:.|]$/, ''), value: values[k], labelRect: rect(c), valueRect: rect(v), conf: Math.min(c.conf, v.conf),
    }))
  }
  return out.sort((p, q) => p.y - q.y)
}

/** Which identity fields a header shows: name, age or DOB, sex, hospital ID, report date. */
const fieldsOf = (text: string) => {
  const h = parseHeader(text)
  return [h.name, h.age ?? h.dob, h.sex, h.mrn, h.reportDate].map(Boolean)
}

/**
 * When the first page's header lacks the patient's name, age (or DOB) or sex and its top holds a ruled grid, the grid is read
 * cell by cell: its vertical lines split it into columns, each column's horizontal lines are traced, each cell is read on
 * its own, and every label cell is paired with the value cell to its right. When the pairs show more identity fields than
 * the page OCR did, they replace the page's lines over the grid ("label <TAB> value", one line each); every other line and
 * every word's offsets stay exact. Measured 25 Nov 2026 on a photographed PET-CT report: the page OCR read no name, age, sex
 * or ID; cell by cell read all of them, in about 1.2 s (only the first page, only when a field is missing).
 */
export async function readHeaderTable(ocr: OcrResult, image: Buffer, provider: OcrProvider): Promise<OcrResult> {
  if (!provider.recognizeLine) return ocr
  const head = ocr.text.split('\n').slice(0, HEADER_LINES).join('\n')
  const h0 = parseHeader(head)
  if (h0.name && (h0.age || h0.dob) && h0.sex) return ocr
  // the band: from the first to the last header-label line the page OCR read, else the page's top 45%
  const spans: { s: number; e: number }[] = []
  let at0 = 0
  for (const l of ocr.text.split('\n')) { spans.push({ s: at0, e: at0 + l.length }); at0 += l.length + 1 }
  const lineWords = spans.map(({ s, e }) => ocr.words.filter((w) => w.s >= s && w.e <= e && w.b))
  // the text's height from the page's words (the header's alone are few, and a grid's lines inflate their boxes)
  const heights = ocr.words.filter((w) => w.b && /[A-Za-z0-9]{2,}/.test(w.t)).map((w) => w.b![3] - w.b![1]).sort((a, b) => a - b)
  if (!heights.length) return ocr
  const textH = heights[heights.length >> 1]
  // the header's label lines: the first run of lines holding a header label, each within three text heights of the last
  // (a later "Study" or "Date" in the report's body is not part of the table)
  const labelLines = spans.slice(0, HEADER_LINES).map((sp, i) => ({ i, ws: lineWords[i] }))
    .filter(({ i, ws }) => ws.length && LABEL_LINE.test(ocr.text.slice(spans[i].s, spans[i].e)))
    .map(({ ws }) => ({ ws, top: Math.min(...ws.map((w) => w.b![1])), bot: Math.max(...ws.map((w) => w.b![3])) }))
    .sort((p, q) => p.top - q.top)
  const cluster = labelLines.slice(0, 1)
  for (const l of labelLines.slice(1)) { if (l.top - Math.max(...cluster.map((c) => c.bot)) > 3 * textH) break; cluster.push(l) }
  const labelWords = cluster.length >= 2 ? cluster.flatMap((c) => c.ws) : []
  const meta = await sharp(image).metadata()
  const Wd = meta.width ?? 0, Hd = meta.height ?? 0
  const top = labelWords.length >= 2 ? Math.max(0, Math.min(...labelWords.map((w) => w.b![1])) - 2 * textH) : 0
  // below the last label line: room for a cell of two lines ("Report Date / Time") whose second line the page OCR lost
  const bottom = labelWords.length >= 2 ? Math.min(Hd, Math.max(...labelWords.map((w) => w.b![3])) + 4 * textH) : Math.round(Hd * 0.45)
  if (bottom - top < 3 * textH || !Wd) return ocr
  const { data: g } = await sharp(image).extract({ left: 0, top, width: Wd, height: bottom - top }).greyscale().normalise().extractChannel(0).raw().toBuffer({ resolveWithObject: true })
  const pairs = pairCells(await readCells(new Uint8Array(g), Wd, bottom - top, textH, provider as OcrProvider & Required<Pick<OcrProvider, 'recognizeLine'>>))
  // Only a read that keeps every field the page OCR found and adds at least one replaces anything.
  const before = fieldsOf(head)
  const kept = fieldsOf(pairs.map((p) => `${p.label}\t${p.value}`).join('\n'))
  if (!pairs.length || before.some((f, i) => f && !kept[i]) || kept.filter(Boolean).length <= before.filter(Boolean).length) return ocr

  // Splice: the page's lines whose words lie between the grid's first and last paired rows give way to the pairs.
  const gridTop = top + Math.min(...pairs.map((p) => p.labelRect[1])), gridBot = top + Math.max(...pairs.map((p) => p.labelRect[3]))
  const centre = (ws: OcrWord[]) => { const c = ws.map((w) => (w.b![1] + w.b![3]) / 2).sort((a, b) => a - b); return c[c.length >> 1] }
  const replaced = lineWords.map((ws) => ws.length > 0 && centre(ws) >= gridTop && centre(ws) <= gridBot)
  const at = replaced.indexOf(true) >= 0 ? replaced.indexOf(true) : lineWords.findIndex((ws) => ws.length > 0 && centre(ws) > gridTop)
  type Line = { text: string; words: OcrWord[] } // word offsets relative to the line
  const pairLines: Line[] = pairs.map((p) => {
    const line: Line = { text: '', words: [] }
    for (const [part, r, sep] of [[p.label, p.labelRect, ''], [p.value, p.valueRect, '\t']] as const) {
      line.text += sep
      part.split(/\s+/).forEach((t, k) => {
        if (k) line.text += ' '
        const s = line.text.length
        line.text += t
        line.words.push({ t, c: Math.round(p.conf * 100) / 100, s, e: line.text.length, b: [r[0], r[1] + top, r[2], r[3] + top] })
      })
    }
    return line
  })
  const out: Line[] = []
  ocr.text.split('\n').forEach((l, i) => {
    if (i === at) out.push(...pairLines)
    if (!replaced[i]) out.push({ text: l, words: ocr.words.filter((w) => w.s >= spans[i].s && w.e <= spans[i].e).map((w) => ({ ...w, s: w.s - spans[i].s, e: w.e - spans[i].s })) })
  })
  if (at < 0) out.push(...pairLines)
  let off = 0
  const words = out.flatMap((l) => { const o = off; off += l.text.length + 1; return l.words.map((w) => ({ ...w, s: w.s + o, e: w.e + o })) })
  // `lines` stays as read: it only feeds the handwriting verdict, taken before this re-read.
  return { ...ocr, text: out.map((l) => l.text).join('\n'), words, mean: words.length ? words.reduce((a, w) => a + w.c, 0) / words.length : null }
}
