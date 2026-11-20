/**
 * Adds SYNTHETIC scans and written reports so the demo patients have a date-ordered imaging history (never real scans).
 *   npx tsx scripts/demo-docs/make-imaging-history.ts
 * Writes the new files into public/demo-docs and adds their entries to imaging-manifest.json (existing entries are kept).
 * Every picture, DICOM header and PDF says SYNTHETIC. Run scripts/demo-docs/make-imaging.ts first for the older samples.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { buildSyntheticDicom } from '../../src/server/pipeline/dicom-synthetic'

const OUT = resolve(process.cwd(), 'public', 'demo-docs')
type Item = { file: string; patientKey: string; title: string; demoStep: string; kind: string; expect: string; studyDate?: string }
const added: Item[] = []
const put = (file: string, data: Uint8Array | Buffer, m: Omit<Item, 'file'>) => { writeFileSync(join(OUT, file), data); added.push({ file, ...m }); console.log('wrote', file, Math.round(data.length / 1024), 'KB') }

const SUNITA = { name: 'Deshmukh^Sunita', sex: 'F' as const, age: '051Y', id: 'SYN-HERO' }
const KHAN = { name: 'Khan^Mohd Abdul Rahim', sex: 'M' as const, age: '064Y', id: 'SYN-RET' }
const UID = (n: number) => `1.2.826.0.1.3680043.8.498.${900000 + n}`

async function textPdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595, 842])
  let y = 790
  for (const [i, l] of lines.entries()) {
    const head = i === 0 || /^[A-Z][A-Z \-/]+$/.test(l)
    page.drawText(l, { x: 50, y, size: head ? 13 : 10.5, font: head ? bold : font, color: rgb(0.1, 0.1, 0.1) })
    y -= head ? 24 : 16
  }
  page.drawText('SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY', { x: 50, y: 30, size: 9, font: bold, color: rgb(0.7, 0.1, 0.1) })
  pdf.setCreationDate(new Date('2026-01-01T00:00:00Z')); pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'))
  return pdf.save()
}

async function main() {
  // ── Khan: an earlier chest CT, five months before the April one (same body part, for "earlier studies") ──
  const ct: Record<string, Uint8Array> = {}
  for (let i = 1; i <= 10; i++) ct[`CT/IM${String(i).padStart(4, '0')}`] = await buildSyntheticDicom({ modality: 'CT', patientName: KHAN.name, sex: KHAN.sex, age: '063Y', patientId: KHAN.id, studyDate: '20251110', studyUid: UID(40), description: 'CT chest', bodyPart: 'CHEST', institution: 'Upvan Multispeciality Hospital', instance: i, size: 128, slice: i / 10 })
  put('returning__17-ct-chest-earlier.zip', zipSync({ DICOMDIR: await buildSyntheticDicom({ modality: 'CT', patientName: KHAN.name, studyUid: UID(40), size: 8 }), ...ct }, { level: 6 }),
    { patientKey: 'returning', title: 'CT chest, 10 slices in a ZIP, 10 Nov 2025 (earlier study of the same area)', demoStep: 'imaging: earlier study for comparison', kind: 'zip', studyDate: '2025-11-10', expect: 'one CT study of 10 images dated 10 Nov 2025; the 12 Apr 2026 CT chest lists it under earlier studies' })
  put('returning__18-ct-chest-report-earlier.pdf', await textPdf([
    'Upvan Multispeciality Hospital', 'Patient Name: Mohd. Abdul Rahim Khan     Age: 63 Y     Sex: M     DOB: 02/01/1962', 'CT CHEST REPORT', 'Date of study: 10/11/2025',
    'CT of the chest was performed with contrast.', 'Report issued by the department of radiology.',
  ]), { patientKey: 'returning', title: 'CT chest report, 10 Nov 2025 (typed PDF)', demoStep: 'imaging: the report of the earlier CT', kind: 'pdf', expect: 'imaging report dated 10 Nov 2025, pairs with returning__17' })

  // ── Sunita: breast imaging before her March surgery, a chest X-ray after it ──
  put('hero__19-mammogram-report.pdf', await textPdf([
    'Medha Imaging & Diagnostic Centre', 'Patient Name: Sunita Deshmukh     Age: 51 Y     Sex: F     DOB: 14/08/1974', 'MAMMOGRAPHY REPORT', 'Date of study: 05/01/2026',
    'Mammography of both breasts, two views each, was performed.', 'Report issued by the department of radiology.',
  ]), { patientKey: 'hero', title: 'Mammography report, 5 Jan 2026 (typed PDF)', demoStep: 'imaging: report of the mammogram (hero__14)', kind: 'pdf', expect: 'imaging report dated 5 Jan 2026, pairs with hero__14' })
  put('hero__20-breast-ultrasound.dcm', await buildSyntheticDicom({ modality: 'US', patientName: SUNITA.name, sex: SUNITA.sex, age: SUNITA.age, patientId: SUNITA.id, studyDate: '20260108', studyUid: UID(41), description: 'Ultrasound both breasts', bodyPart: 'BREAST', institution: 'Medha Imaging & Diagnostic Centre', size: 160, frames: 12 }),
    { patientKey: 'hero', title: 'Breast ultrasound, 12 frames (DICOM), 8 Jan 2026', demoStep: 'imaging: breast ultrasound', kind: 'dicom', studyDate: '2026-01-08', expect: 'identity: match; Ultrasound study of 12 frames' })
  put('hero__21-breast-ultrasound-report.pdf', await textPdf([
    'Medha Imaging & Diagnostic Centre', 'Patient Name: Sunita Deshmukh     Age: 51 Y     Sex: F     DOB: 14/08/1974', 'ULTRASOUND BREAST REPORT', 'Date of study: 08/01/2026',
    'Ultrasound of both breasts was performed.', 'Report issued by the department of radiology.',
  ]), { patientKey: 'hero', title: 'Breast ultrasound report, 8 Jan 2026 (typed PDF)', demoStep: 'imaging: report of the breast ultrasound (hero__20)', kind: 'pdf', expect: 'imaging report dated 8 Jan 2026, pairs with hero__20' })

  const path = join(OUT, 'imaging-manifest.json')
  const old = JSON.parse(readFileSync(path, 'utf8')) as Item[]
  const keep = old.filter((o) => !added.some((a) => a.file === o.file))
  writeFileSync(path, JSON.stringify([...keep, ...added], null, 2) + '\n')
}

void main()
