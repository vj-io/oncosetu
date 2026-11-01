/**
 * Tiny document engine for the synthetic demo documents.
 *
 * blocks (letterhead, header grid, table, signature ...) --layout()--> display list per page
 * display list --toPdf()--> text-layer PDF (pdf-lib)
 * display list --toSvg()--> SVG --photograph()--> "phone photo" JPEG (sharp / librsvg)
 *
 * One layout, two backends, so a PDF and a photographed page look like the same family of documents.
 * All coordinates are PDF points with a top-left origin (y grows downwards).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import sharp from 'sharp'

export type RGB = [number, number, number]
export type Font = 'sans' | 'deva' | 'hand' | 'mono'

export interface TextOp {
  k: 'text'
  x: number
  y: number
  s: string
  size: number
  color: RGB
  font: Font
  bold?: boolean
  italic?: boolean
  anchor?: 'start' | 'middle' | 'end'
  hidden?: boolean // PDF only: white 1pt text that still sits in the text layer
  rot?: number // SVG only (degrees about the text origin)
  wobble?: number // SVG only: per-glyph baseline/rotation jitter (handwriting look), seeded by the text
}
export type Op =
  | TextOp
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: RGB; stroke?: RGB; sw?: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; sw: number; color: RGB }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: RGB }
  | { k: 'path'; d: string; stroke?: RGB; fill?: RGB; sw?: number }

export interface Inst {
  name: string
  sub?: string
  addr: string
  contact: string
  accent: RGB
  shape?: 'circle' | 'square' | 'diamond'
  reg?: string
}
export interface Sig {
  name: string
  qual?: string
  reg?: string
  role?: string
}
export type Block =
  | { t: 'head' }
  | { t: 'title'; s: string; sub?: string }
  | { t: 'grid'; rows: string[][] } // [label, value, label2?, value2?]; value starting with "*" is bold
  | { t: 'h'; s: string }
  | { t: 'p'; s: string; size?: number; bold?: boolean; italic?: boolean; center?: boolean; color?: RGB }
  | { t: 'kv'; k: string; v: string }
  | { t: 'ul'; items: string[] }
  | { t: 'table'; head: string[]; w: number[]; rows: string[][]; size?: number } // "#x" = section row, "*x" = bold cell
  | { t: 'sig'; who: Sig[] }
  | { t: 'gap'; h: number }
  | { t: 'br' }
  | { t: 'hidden'; s: string }

export interface Layoutable {
  file?: string // only used in error messages
  inst: Inst
  cont?: string // running header on pages 2+
  footNote?: string
  blocks: Block[]
}
export interface Style {
  fs: number // font-size multiplier
  foot: number // footer font size (pt)
}

export const PW = 595.28
export const PH = 841.89
const M = 42
const TOP = 34
const BOT = PH - 52
const CW = PW - 2 * M
export const SYNTH = 'SYNTHETIC DOCUMENT — FOR DEMONSTRATION ONLY'

const INK: RGB = [0.09, 0.09, 0.11]
const GRAY: RGB = [0.38, 0.38, 0.41]
const LINE: RGB = [0.72, 0.72, 0.75]
const SHADE: RGB = [0.95, 0.95, 0.96]
const RED: RGB = [0.6, 0.1, 0.1]
const PEN: RGB = [0.1, 0.16, 0.5]
const tint = (c: RGB, t: number): RGB => [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t]

// ---------- deterministic randomness ----------
export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- text measurement ----------
const DEVA = /[ऀ-ॿ]/
const DEVA_MARK = /[ऀ-ःऺ़ा-ॏ॑-ॗॢॣ]/g
let mfonts: { sans: PDFFont; bold: PDFFont; ital: PDFFont } | null = null

export async function initEngine(): Promise<void> {
  const d = await PDFDocument.create()
  mfonts = {
    sans: await d.embedFont(StandardFonts.Helvetica),
    bold: await d.embedFont(StandardFonts.HelveticaBold),
    ital: await d.embedFont(StandardFonts.HelveticaOblique),
  }
}
interface MOpt {
  bold?: boolean
  italic?: boolean
  font?: Font
}
export function measure(s: string, size: number, o: MOpt = {}): number {
  if (!mfonts) throw new Error('initEngine() first')
  if (o.font === 'deva' || DEVA.test(s)) return s.replace(DEVA_MARK, '').length * size * 0.56 // ponytail: heuristic, only used for wrapping/centring Devanagari
  if (o.font === 'hand') return s.length * size * 0.5
  if (o.font === 'mono') return s.length * size * 0.6
  return (o.bold ? mfonts.bold : o.italic ? mfonts.ital : mfonts.sans).widthOfTextAtSize(s, size)
}
function wrap(s: string, size: number, maxW: number, o: MOpt = {}): string[] {
  const lines: string[] = []
  for (const para of s.split('\n')) {
    let cur = ''
    for (const w of para.split(' ')) {
      const t = cur ? cur + ' ' + w : w
      if (cur && measure(t, size, o) > maxW) {
        lines.push(cur)
        cur = w
      } else cur = t
    }
    lines.push(cur)
  }
  return lines
}

export function scribble(x: number, y: number, w: number, seed: number): string {
  const r = rng(seed)
  const n = 6
  const step = w / n
  let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`
  let cx = x
  for (let i = 0; i < n; i++) {
    d += ` C ${(cx + step * 0.3).toFixed(1)} ${(y - 9 - r() * 10).toFixed(1)}, ${(cx + step * 0.7).toFixed(1)} ${(y + 5 + r() * 7).toFixed(1)}, ${(cx + step).toFixed(1)} ${(y - r() * 8).toFixed(1)}`
    cx += step
  }
  return d + ` l ${(-w * 0.55).toFixed(1)} ${(3 + r() * 3).toFixed(1)}`
}

// ---------- layout ----------
export function layout(d: Layoutable, st: Style): Op[][] {
  const fs = st.fs
  const acc = d.inst.accent
  const pages: Op[][] = [[]]
  let y = TOP
  const out = (o: Op) => {
    pages[pages.length - 1].push(o)
  }
  const text = (x: number, yy: number, s: string, size: number, o: Partial<TextOp> = {}) =>
    out({ k: 'text', x, y: yy, s, size, color: INK, font: DEVA.test(s) ? 'deva' : 'sans', ...o })
  const hline = (x1: number, x2: number, yy: number, sw: number, color: RGB) =>
    out({ k: 'line', x1, y1: yy, x2, y2: yy, sw, color })
  const need = (h: number) => {
    if (y + h > BOT)
      throw new Error(`${d.file}: content overflows page ${pages.length} (y=${y.toFixed(0)} + ${h.toFixed(0)} > ${BOT.toFixed(0)})`)
  }

  for (const b of d.blocks) {
    switch (b.t) {
      case 'head': {
        const I = d.inst
        let ns = 16.5 * fs
        while (measure(I.name, ns, { bold: true }) > CW - 58 && ns > 9) ns -= 0.5
        const ex = M + 20
        const ey = y + 22 * fs
        const r = 19 * fs
        const white: RGB = [1, 1, 1]
        // logo mark is geometry only (no text), so nothing leaks into the PDF text layer
        if (I.shape === 'square') {
          out({ k: 'rect', x: ex - r, y: ey - r, w: 2 * r, h: 2 * r, fill: acc })
          out({ k: 'circle', cx: ex, cy: ey, r: r * 0.62, fill: white })
          out({ k: 'circle', cx: ex, cy: ey, r: r * 0.36, fill: acc })
        } else if (I.shape === 'diamond') {
          const dia = (k: number) => `M ${ex} ${ey - r * k} L ${ex + r * k} ${ey} L ${ex} ${ey + r * k} L ${ex - r * k} ${ey} Z`
          out({ k: 'path', d: dia(1.15), fill: acc })
          out({ k: 'path', d: dia(0.6), fill: white })
          out({ k: 'path', d: dia(0.3), fill: acc })
        } else {
          out({ k: 'circle', cx: ex, cy: ey, r, fill: acc })
          out({ k: 'rect', x: ex - r * 0.18, y: ey - r * 0.62, w: r * 0.36, h: r * 1.24, fill: white })
          out({ k: 'rect', x: ex - r * 0.62, y: ey - r * 0.18, w: r * 1.24, h: r * 0.36, fill: white })
        }
        const tx = M + 50
        let yy = y + ns * 0.95
        text(tx, yy, I.name, ns, { bold: true, color: acc })
        if (I.sub) {
          yy += 11.5 * fs
          text(tx, yy, I.sub, 8.8 * fs, { italic: true, color: GRAY })
        }
        yy += 10.5 * fs
        text(tx, yy, I.addr, 8.3 * fs, { color: INK })
        yy += 10 * fs
        text(tx, yy, I.contact, 7.8 * fs, { color: GRAY })
        if (I.reg) {
          // right-aligned registration number on the first row it fits beside; else its own row
          const rw = measure(I.reg, 7.4 * fs) + 14
          const room = CW - 50 * 1
          if (measure(I.addr, 8.3 * fs) + rw < room) text(PW - M, yy - 10 * fs, I.reg, 7.4 * fs, { color: GRAY, anchor: 'end' })
          else if (measure(I.contact, 7.8 * fs) + rw < room) text(PW - M, yy, I.reg, 7.4 * fs, { color: GRAY, anchor: 'end' })
          else {
            yy += 9.5 * fs
            text(tx, yy, I.reg, 7.4 * fs, { color: GRAY })
          }
        }
        yy += 6 * fs
        hline(M, PW - M, yy, 1.8, acc)
        hline(M, PW - M, yy + 2.6, 0.5, acc)
        y = yy + 9 * fs
        break
      }
      case 'title': {
        const sz = 12.5 * fs
        need(sz * 2)
        y += 4 * fs
        text(PW / 2, y + sz * 0.85, b.s, sz, { bold: true, anchor: 'middle' })
        const w = measure(b.s, sz, { bold: true })
        hline(PW / 2 - w / 2, PW / 2 + w / 2, y + sz * 1.12, 0.7, INK)
        y += sz * 1.35
        if (b.sub) {
          const s2 = 8.6 * fs
          text(PW / 2, y + s2 * 0.85, b.sub, s2, { italic: true, color: GRAY, anchor: 'middle' })
          y += s2 * 1.5
        }
        y += 5 * fs
        break
      }
      case 'grid': {
        const sz = 9 * fs
        const lh = sz * 1.3
        const pad = 4 * fs
        const half = CW / 2
        const lw1 = Math.max(...b.rows.map((r) => measure(r[0] + ':', sz))) + 10 * fs
        const lw2 = Math.max(...b.rows.map((r) => (r[2] ? measure(r[2] + ':', sz) : 0))) + 10 * fs
        const rows = b.rows.map((r) => {
          const span = !r[2]
          const w1 = (span ? CW : half) - lw1 - 2 * pad
          const v1 = (r[1] ?? '').replace(/^\*/, '')
          const l1 = wrap(v1, sz, w1, { bold: (r[1] ?? '').startsWith('*') })
          const v2 = (r[3] ?? '').replace(/^\*/, '')
          const l2 = span ? [] : wrap(v2, sz, half - lw2 - 2 * pad, { bold: (r[3] ?? '').startsWith('*') })
          return { r, span, l1, l2, h: Math.max(l1.length, l2.length, 1) * lh + pad * 1.2 }
        })
        const total = rows.reduce((a, r) => a + r.h, 0)
        need(total + 8 * fs)
        out({ k: 'rect', x: M, y, w: CW, h: total, fill: tint(acc, 0.93), stroke: LINE, sw: 0.7 })
        if (rows.some((r) => !r.span)) out({ k: 'line', x1: M + half, y1: y, x2: M + half, y2: y + total, sw: 0.4, color: LINE })
        let yy = y
        rows.forEach((row, i) => {
          if (i > 0) hline(M, PW - M, yy, 0.4, LINE)
          const base = yy + pad * 0.6 + sz * 0.85
          text(M + pad, base, row.r[0] + ':', sz, { color: GRAY })
          row.l1.forEach((l, j) => text(M + pad + lw1, base + j * lh, l, sz, { bold: (row.r[1] ?? '').startsWith('*') }))
          if (!row.span) {
            text(M + half + pad, base, row.r[2] + ':', sz, { color: GRAY })
            row.l2.forEach((l, j) => text(M + half + pad + lw2, base + j * lh, l, sz, { bold: (row.r[3] ?? '').startsWith('*') }))
          }
          yy += row.h
        })
        y += total + 7 * fs
        break
      }
      case 'h': {
        const sz = 10 * fs
        need(sz * 2.4)
        y += 5 * fs
        text(M, y + sz * 0.85, b.s, sz, { bold: true, color: acc })
        hline(M, PW - M, y + sz * 1.2, 0.5, tint(acc, 0.45))
        y += sz * 1.55 + 2 * fs
        break
      }
      case 'p': {
        const sz = (b.size ?? 9.5) * fs
        const lh = sz * 1.38
        const lines = wrap(b.s, sz, CW, { bold: b.bold, italic: b.italic })
        need(lines.length * lh + 3 * fs)
        lines.forEach((l, i) =>
          text(b.center ? PW / 2 : M, y + i * lh + sz * 0.85, l, sz, {
            bold: b.bold,
            italic: b.italic,
            color: b.color ?? INK,
            anchor: b.center ? 'middle' : 'start',
          }),
        )
        y += lines.length * lh + 3.5 * fs
        break
      }
      case 'kv': {
        const sz = 9.5 * fs
        const lh = sz * 1.38
        const lw = measure(b.k + ' ', sz, { bold: true })
        const lines = wrap(b.v, sz, CW - lw)
        need(lines.length * lh + 3 * fs)
        text(M, y + sz * 0.85, b.k, sz, { bold: true })
        lines.forEach((l, i) => text(M + lw, y + i * lh + sz * 0.85, l, sz))
        y += lines.length * lh + 3.5 * fs
        break
      }
      case 'ul': {
        const sz = 9.5 * fs
        const lh = sz * 1.38
        for (const it of b.items) {
          const lines = wrap(it, sz, CW - 14 * fs)
          need(lines.length * lh + 2 * fs)
          text(M + 3 * fs, y + sz * 0.85, '•', sz)
          lines.forEach((l, i) => text(M + 14 * fs, y + i * lh + sz * 0.85, l, sz))
          y += lines.length * lh + 2 * fs
        }
        y += 2 * fs
        break
      }
      case 'table': {
        const sz = (b.size ?? 8.8) * fs
        const lh = sz * 1.28
        const px = 3.5 * fs
        const py = 2.6 * fs
        const cw = b.w.map((w) => w * CW)
        const xs = cw.map((_, i) => M + cw.slice(0, i).reduce((a, v) => a + v, 0))
        const all = [{ cells: b.head, head: true }, ...b.rows.map((cells) => ({ cells, head: false }))]
        const rows = all.map(({ cells, head }) => {
          if (cells.length === 1 && cells[0].startsWith('#'))
            return { section: cells[0].slice(1), cells: [] as { lines: string[]; bold: boolean }[], head, h: lh + 2 * py }
          const cs = cells.map((c, i) => {
            const bold = head || c.startsWith('*')
            return { lines: wrap(c.replace(/^\*/, ''), sz, cw[i] - 2 * px, { bold }), bold }
          })
          return { section: undefined, cells: cs, head, h: Math.max(...cs.map((c) => c.lines.length)) * lh + 2 * py }
        })
        const total = rows.reduce((a, r) => a + r.h, 0)
        need(total + 8 * fs)
        out({ k: 'rect', x: M, y, w: CW, h: total, stroke: INK, sw: 0.7 })
        let yy = y
        for (const row of rows) {
          if (row.head) out({ k: 'rect', x: M, y: yy, w: CW, h: row.h, fill: tint(acc, 0.84), stroke: INK, sw: 0.7 })
          else if (row.section !== undefined) out({ k: 'rect', x: M, y: yy, w: CW, h: row.h, fill: SHADE, stroke: LINE, sw: 0.4 })
          else hline(M, PW - M, yy, 0.35, LINE)
          if (row.section !== undefined) text(M + px, yy + py + sz * 0.85, row.section, sz, { bold: true, color: acc })
          else
            row.cells.forEach((c, i) => {
              if (i > 0) out({ k: 'line', x1: xs[i], y1: yy, x2: xs[i], y2: yy + row.h, sw: 0.35, color: LINE })
              c.lines.forEach((l, j) => text(xs[i] + px, yy + py + sz * 0.85 + j * lh, l, sz, { bold: c.bold }))
            })
          yy += row.h
        }
        y += total + 7 * fs
        break
      }
      case 'sig': {
        need(66 * fs)
        const n = b.who.length
        const colW = CW / n
        b.who.forEach((w, i) => {
          const x = M + i * colW + (n === 1 ? CW - 200 * fs : 6)
          const y0 = y + 8 * fs
          out({ k: 'path', d: scribble(x + 6, y0 + 20 * fs, 78 * fs, hash(w.name)), stroke: PEN, sw: 1.05 })
          hline(x, x + 150 * fs, y0 + 27 * fs, 0.5, INK)
          text(x, y0 + 37 * fs, w.name, 9 * fs, { bold: true })
          if (w.qual) text(x, y0 + 46.5 * fs, w.qual, 8 * fs, { color: GRAY })
          if (w.reg) text(x, y0 + 55.5 * fs, w.reg, 8 * fs, { color: GRAY })
          if (w.role) text(x, y0 + (w.reg ? 64.5 : 55.5) * fs, w.role, 8 * fs, { italic: true, color: GRAY })
        })
        y += 74 * fs
        break
      }
      case 'gap':
        y += b.h * fs
        break
      case 'hidden':
        out({ k: 'text', x: M, y: y + 3, s: b.s, size: 1, color: [1, 1, 1], font: 'sans', hidden: true })
        y += 6
        break
      case 'br':
        pages.push([])
        y = TOP
        if (d.cont) {
          text(M, y + 7 * fs, d.cont, 8 * fs, { color: GRAY })
          hline(M, PW - M, y + 12 * fs, 0.5, LINE)
          y += 22 * fs
        }
        break
    }
  }

  // footers (every page) + "Page n" on continuation pages
  pages.forEach((ops, i) => {
    const sz = st.foot
    ops.push({ k: 'line', x1: M, y1: PH - 42, x2: PW - M, y2: PH - 42, sw: 0.5, color: LINE })
    ops.push({ k: 'text', x: M, y: PH - 31, s: d.footNote ?? 'Computer-generated report.', size: sz * 0.9, color: GRAY, font: 'sans' })
    ops.push({ k: 'text', x: PW - M, y: PH - 31, s: `Page ${i + 1} of ${pages.length}`, size: sz * 0.9, color: GRAY, font: 'sans', anchor: 'end' })
    ops.push({ k: 'text', x: PW / 2, y: PH - 18, s: SYNTH, size: sz, color: RED, font: 'sans', bold: true, anchor: 'middle' })
    if (i > 0) ops.push({ k: 'text', x: PW - M, y: TOP + 7 * st.fs, s: `Page ${i + 1}`, size: 8 * st.fs, color: GRAY, font: 'sans', anchor: 'end' })
  })
  return pages
}

// ---------- PDF backend ----------
const FIXED_DATE = new Date('2026-07-01T09:00:00+05:30')
export async function toPdf(meta: { title: string; author: string }, pages: Op[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(meta.title)
  pdf.setAuthor(meta.author)
  pdf.setSubject(SYNTH)
  pdf.setCreator('OncoSetu demo-docs generator')
  pdf.setProducer('OncoSetu demo-docs generator (pdf-lib)')
  pdf.setCreationDate(FIXED_DATE)
  pdf.setModificationDate(FIXED_DATE)
  const f = {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    ital: await pdf.embedFont(StandardFonts.HelveticaOblique),
    mono: await pdf.embedFont(StandardFonts.Courier),
  }
  const c = (v: RGB) => rgb(v[0], v[1], v[2])
  for (const ops of pages) {
    const pg = pdf.addPage([PW, PH])
    for (const o of ops) {
      if (o.k === 'text') {
        const font = o.font === 'mono' ? f.mono : o.bold ? f.bold : o.italic ? f.ital : f.sans
        const w = font.widthOfTextAtSize(o.s, o.size)
        const x = o.anchor === 'middle' ? o.x - w / 2 : o.anchor === 'end' ? o.x - w : o.x
        pg.drawText(o.s, { x, y: PH - o.y, size: o.size, font, color: c(o.color) })
      } else if (o.k === 'line')
        pg.drawLine({ start: { x: o.x1, y: PH - o.y1 }, end: { x: o.x2, y: PH - o.y2 }, thickness: o.sw, color: c(o.color) })
      else if (o.k === 'rect')
        pg.drawRectangle({
          x: o.x,
          y: PH - o.y - o.h,
          width: o.w,
          height: o.h,
          color: o.fill ? c(o.fill) : undefined,
          borderColor: o.stroke ? c(o.stroke) : undefined,
          borderWidth: o.stroke ? (o.sw ?? 0.5) : 0,
        })
      else if (o.k === 'circle') pg.drawCircle({ x: o.cx, y: PH - o.cy, size: o.r, color: o.fill ? c(o.fill) : undefined })
      else
        pg.drawSvgPath(o.d, {
          x: 0,
          y: PH,
          color: o.fill ? c(o.fill) : undefined,
          borderColor: o.stroke ? c(o.stroke) : undefined,
          borderWidth: o.stroke ? (o.sw ?? 1) : 0,
        })
    }
  }
  return pdf.save()
}

// ---------- SVG backend + "phone photo" ----------
const FAM: Record<Font, string> = {
  sans: 'Helvetica, Arial, sans-serif',
  deva: 'Kohinoor Devanagari, Devanagari Sangam MN, sans-serif',
  hand: 'Bradley Hand, Noteworthy, cursive',
  mono: 'Courier New, Courier, monospace',
}
const hex = (v: RGB) => '#' + v.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const PAGE_PX = 1760
export const SCALE = PAGE_PX / PW

export function toSvg(ops: Op[], paper: string, seed: number): string {
  const W = PAGE_PX
  const H = Math.round(PH * SCALE)
  const body = ops
    .filter((o) => !(o.k === 'text' && o.hidden))
    .map((o) => {
      if (o.k === 'text') {
        const anchor = o.anchor === 'middle' ? 'middle' : o.anchor === 'end' ? 'end' : 'start'
        const rot = o.rot ? ` transform="rotate(${o.rot} ${o.x} ${o.y})"` : ''
        let inner = esc(o.s)
        if (o.wobble) {
          // per-glyph size and baseline jitter (tspans), seeded by the text -> hand-written look, lower OCR confidence
          const r = rng(hash(o.s))
          let prev = 0
          inner = [...o.s]
            .map((ch) => {
              const cur = (r() - 0.5) * 2 * o.wobble!
              const dy = cur - prev
              prev = cur
              return `<tspan dy="${dy.toFixed(2)}" dx="${((r() - 0.5) * o.wobble! * 0.9).toFixed(2)}" font-size="${(o.size * (0.9 + r() * 0.22)).toFixed(2)}">${esc(ch)}</tspan>`
            })
            .join('')
        }
        return `<text x="${o.x.toFixed(2)}" y="${o.y.toFixed(2)}" font-family="${FAM[o.font]}" font-size="${o.size.toFixed(2)}"${o.bold ? ' font-weight="bold"' : ''}${o.italic ? ' font-style="italic"' : ''} fill="${hex(o.color)}" text-anchor="${anchor}"${rot} xml:space="preserve">${inner}</text>`
      }
      if (o.k === 'line') return `<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${hex(o.color)}" stroke-width="${o.sw}"/>`
      if (o.k === 'rect')
        return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${o.fill ? hex(o.fill) : 'none'}"${o.stroke ? ` stroke="${hex(o.stroke)}" stroke-width="${o.sw ?? 0.5}"` : ''}/>`
      if (o.k === 'circle') return `<circle cx="${o.cx}" cy="${o.cy}" r="${o.r}" fill="${o.fill ? hex(o.fill) : 'none'}"/>`
      return `<path d="${o.d}" fill="${o.fill ? hex(o.fill) : 'none'}"${o.stroke ? ` stroke="${hex(o.stroke)}" stroke-width="${o.sw ?? 1}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`
    })
    .join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="${seed % 1000}"/><feColorMatrix type="saturate" values="0"/></filter>
<linearGradient id="light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.16"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="${paper}"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.05"/>
<g transform="scale(${SCALE})">
${body}
</g>
<rect y="${H * 0.5}" width="${W}" height="3" fill="#000" opacity="0.05"/>
<rect y="${H * 0.5 + 3}" width="${W}" height="2" fill="#fff" opacity="0.18"/>
<rect width="${W}" height="${H}" fill="url(#light)"/>
</svg>`
}

export interface Photo {
  angle: number // degrees, 1-2
  paper: string
  desk: string
  dx?: number
  dy?: number
  seed: number
}
const CANVAS_W = 2000
const CANVAS_H = 2700

/** Page SVG -> desk photo: rotation, soft drop shadow, vignette, mild sensor noise, JPEG. */
export async function photograph(pageSvg: string, p: Photo, maxBytes = 1_450_000): Promise<Buffer> {
  const W = PAGE_PX
  const H = Math.round(PH * SCALE)
  const page = await sharp(Buffer.from(pageSvg)).png().toBuffer()
  const cx = CANVAS_W / 2 + (p.dx ?? 0)
  const cy = CANVAS_H / 2 + (p.dy ?? 0)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CANVAS_W}" height="${CANVAS_H}">
<defs>
<filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="${p.seed % 997}"/><feColorMatrix type="saturate" values="0"/></filter>
<linearGradient id="desk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.desk}"/><stop offset="1" stop-color="#2b2723"/></linearGradient>
<radialGradient id="vig" cx="50%" cy="48%" r="72%"><stop offset="58%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.42"/></radialGradient>
</defs>
<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#desk)"/>
<g transform="rotate(${p.angle} ${cx} ${cy})">
<rect x="${cx - W / 2 + 12}" y="${cy - H / 2 + 20}" width="${W}" height="${H}" fill="#000" opacity="0.5" filter="url(#blur)"/>
<image x="${cx - W / 2}" y="${cy - H / 2}" width="${W}" height="${H}" xlink:href="data:image/png;base64,${page.toString('base64')}"/>
</g>
<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#vig)"/>
<rect width="${CANVAS_W}" height="${CANVAS_H}" filter="url(#noise)" opacity="0.05"/>
</svg>`
  const raster = await sharp(Buffer.from(svg)).toBuffer()
  for (const q of [80, 72, 64, 56]) {
    const jpg = await sharp(raster).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer()
    if (jpg.length <= maxBytes) return jpg
  }
  throw new Error('JPEG still above size cap at quality 56')
}
