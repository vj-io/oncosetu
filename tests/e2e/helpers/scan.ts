// A scanned discharge summary for V02-E2E-02: the demo generator's hero discharge summary (scripts/demo-docs), each page
// photographed the way the demo's image documents are, in a PDF with no text layer. One page can be degraded (soft and
// faded, like a poor scan) so that its OCR confidence falls below the low-confidence threshold.
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { docs } from '../../../scripts/demo-docs/docs'
import { PH, PW, initEngine, layout, photograph, toSvg } from '../../../scripts/demo-docs/engine'

export async function scannedDischargeSummary(degradePage?: number): Promise<Buffer> {
  await initEngine()
  const d = docs.find((x) => x.patientKey === 'hero' && x.slug === 'discharge-summary')!
  const pdf = await PDFDocument.create()
  for (const [i, ops] of layout(d, { fs: d.fs ?? 1, foot: 7 }).entries()) {
    const seed = 90 + i
    let jpg = await photograph(toSvg(ops, '#f6f2e8', seed), { angle: i % 2 ? -0.8 : 0.9, paper: '#f6f2e8', desk: '#5a4a3a', seed })
    if (i + 1 === degradePage) jpg = await sharp(jpg).blur(DEGRADE.blur).linear(DEGRADE.contrast, 255 * (1 - DEGRADE.contrast)).jpeg({ quality: 40 }).toBuffer()
    pdf.addPage([PW, PH]).drawImage(await pdf.embedJpg(jpg), { x: 0, y: 0, width: PW, height: PH })
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }))
}

/** Tuned so the page still yields words, read with low confidence (a page with no words has no confidence to flag). */
const DEGRADE = { blur: 3, contrast: 0.4 }
