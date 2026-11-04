/**
 * Ground-truth text of a rendered page, for OCR character-error-rate (FR-DOC-02): every visible text op of the display
 * list, grouped into baselines, top to bottom, left to right within a line. Hidden (white 1 pt) text is not on the image.
 * Needs initEngine() to have run (glyph widths decide the left-to-right order of right- and centre-anchored ops).
 */
import { measure } from './engine'
import type { Op, TextOp } from './engine'

export function pageTruth(ops: Op[]): string {
  const t = ops.filter((o): o is TextOp => o.k === 'text' && !o.hidden).sort((a, b) => a.y - b.y)
  const left = (o: TextOp) => {
    const w = measure(o.s, o.size, { bold: o.bold, italic: o.italic, font: o.font })
    return o.anchor === 'middle' ? o.x - w / 2 : o.anchor === 'end' ? o.x - w : o.x
  }
  const lines: TextOp[][] = []
  for (const o of t) {
    const cur = lines[lines.length - 1]
    if (cur && o.y - cur[0].y < o.size * 0.4) cur.push(o)
    else lines.push([o])
  }
  return lines.map((l) => l.sort((a, b) => left(a) - left(b)).map((o) => o.s).join(' ')).join('\n')
}

export type OcrTruth = Record<string, Record<string, { handwritten: boolean; text: string }>>
