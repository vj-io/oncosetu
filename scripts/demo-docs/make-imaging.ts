/**
 * Generates SYNTHETIC imaging, ECG, video and photo samples for the demo (never real scans or patients).
 *   npx tsx scripts/demo-docs/make-imaging.ts        (set FFMPEG_PATH to make the MP4 clip; without it the clip is skipped)
 * Output: public/demo-docs/*  and public/demo-docs/imaging-manifest.json. Every picture and header says SYNTHETIC.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import { buildSyntheticDicom, buildSyntheticEcgDicom, syntheticPicture } from '../../src/server/pipeline/dicom-synthetic'

const OUT = resolve(process.cwd(), 'public', 'demo-docs')
mkdirSync(OUT, { recursive: true })
type Item = { file: string; patientKey: string; title: string; demoStep: string; kind: string; expect: string }
const manifest: Item[] = []
const put = (file: string, data: Uint8Array | Buffer, m: Omit<Item, 'file'>) => { writeFileSync(join(OUT, file), data); manifest.push({ file, ...m }); console.log('wrote', file, Math.round(data.length / 1024), 'KB') }

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
  // ── DICOM scans ──
  put('hero__12-chest-xray.dcm', await buildSyntheticDicom({ modality: 'DX', patientName: SUNITA.name, sex: SUNITA.sex, age: SUNITA.age, patientId: SUNITA.id, studyDate: '20260318', studyUid: UID(1), description: 'Chest X-ray PA', bodyPart: 'CHEST', institution: 'Triveni Multispeciality Hospital', size: 256 }),
    { patientKey: 'hero', title: 'Chest X-ray (DICOM)', demoStep: 'imaging: stored, not read', kind: 'dicom', expect: 'identity: match; Imaging file - stored, not read; preview shown' })
  put('hero__13-xray-wrong-patient.dcm', await buildSyntheticDicom({ modality: 'DX', patientName: 'Kulkarni^Sanjay', sex: 'M', age: '063Y', patientId: 'SYN-OTHER', studyDate: '20260318', studyUid: UID(2), description: 'Chest X-ray PA', bodyPart: 'CHEST', size: 192 }),
    { patientKey: 'hero', title: 'Chest X-ray with another patient name (DICOM)', demoStep: 'imaging: wrong patient is held', kind: 'dicom', expect: 'identity: mismatch; held for checking' })
  put('hero__14-mammogram.dcm', await buildSyntheticDicom({ modality: 'MG', patientName: SUNITA.name, sex: SUNITA.sex, age: SUNITA.age, studyDate: '20260105', studyUid: UID(3), description: 'Mammogram', bodyPart: 'BREAST', size: 256, rle: true }),
    { patientKey: 'hero', title: 'Mammogram (DICOM, RLE-compressed)', demoStep: 'imaging: compressed preview', kind: 'dicom', expect: 'identity: match; preview from RLE' })

  const ctSeries: Record<string, Uint8Array> = {}
  for (let i = 1; i <= 12; i++) ctSeries[`CT/IM${String(i).padStart(4, '0')}`] = await buildSyntheticDicom({ modality: 'CT', patientName: KHAN.name, sex: KHAN.sex, age: KHAN.age, patientId: KHAN.id, studyDate: '20260412', studyUid: UID(10), description: 'CT chest', bodyPart: 'CHEST', instance: i, size: 128, slice: i / 12 })
  put('returning__08-ct-chest-series.zip', zipSync({ DICOMDIR: await buildSyntheticDicom({ modality: 'CT', patientName: KHAN.name, studyUid: UID(10), size: 8 }), ...ctSeries }, { level: 6 }),
    { patientKey: 'returning', title: 'CT chest, 12 slices in a ZIP (CD export with DICOMDIR)', demoStep: 'imaging: a series becomes one study', kind: 'zip', expect: 'one CT study of 12 images; middle slice preview; slider' })

  const petct: Record<string, Uint8Array> = {}
  for (let i = 1; i <= 8; i++) petct[`DICOM/PT000000/ST000000/SE000001/CT${i}`] = await buildSyntheticDicom({ modality: 'CT', patientName: KHAN.name, sex: KHAN.sex, age: KHAN.age, studyDate: '20260428', studyUid: UID(20), description: 'PET-CT whole body', bodyPart: 'WHOLEBODY', instance: i, size: 128, slice: i / 8 })
  for (let i = 1; i <= 8; i++) petct[`DICOM/PT000000/ST000000/SE000002/PT${i}`] = await buildSyntheticDicom({ modality: 'PT', patientName: KHAN.name, sex: KHAN.sex, age: KHAN.age, studyDate: '20260428', studyUid: UID(20), description: 'PET-CT whole body', bodyPart: 'WHOLEBODY', instance: 20 + i, size: 128, slice: i / 8 })
  put('returning__09-petct-study.zip', zipSync({ DICOMDIR: await buildSyntheticDicom({ modality: 'PT', patientName: KHAN.name, studyUid: UID(20), size: 8 }), ...petct }, { level: 6 }),
    { patientKey: 'returning', title: 'PET-CT study, 16 images in a ZIP', demoStep: 'imaging: PET plus CT is one PET-CT', kind: 'zip', expect: 'one PET-CT study of 16 images' })

  put('returning__10-mri-brain.dcm', await buildSyntheticDicom({ modality: 'MR', patientName: KHAN.name, sex: KHAN.sex, age: KHAN.age, studyDate: '20260220', studyUid: UID(30), description: 'MRI brain', bodyPart: 'BRAIN', size: 192, frames: 9 }),
    { patientKey: 'returning', title: 'MRI brain, 9 frames (DICOM)', demoStep: 'imaging: multi-frame slider', kind: 'dicom', expect: 'MRI; 9 frames; middle frame first' })
  put('returning__11-ultrasound-cine.dcm', await buildSyntheticDicom({ modality: 'US', patientName: KHAN.name, sex: KHAN.sex, age: KHAN.age, studyDate: '20260301', studyUid: UID(31), description: 'Ultrasound abdomen cine', bodyPart: 'ABDOMEN', size: 160, frames: 16 }),
    { patientKey: 'returning', title: 'Ultrasound cine, 16 frames (DICOM)', demoStep: 'imaging: cine', kind: 'dicom', expect: 'Ultrasound; 16 frames' })
  put('returning__12-bone-scan.dcm', await buildSyntheticDicom({ modality: 'NM', patientName: KHAN.name, sex: KHAN.sex, age: KHAN.age, studyDate: '20260315', studyUid: UID(32), description: 'Bone scan whole body', bodyPart: 'WHOLEBODY', size: 192 }),
    { patientKey: 'returning', title: 'Bone scan (DICOM)', demoStep: 'imaging: bone scan', kind: 'dicom', expect: 'Bone scan / nuclear scan' })
  put('returning__13-ecg-waveform.dcm', await buildSyntheticEcgDicom({ patientName: KHAN.name, sex: KHAN.sex, age: KHAN.age, studyUid: UID(33), studyDate: '20260510' }),
    { patientKey: 'returning', title: '12-lead ECG waveform (DICOM)', demoStep: 'ECG: stored, not read', kind: 'ecg', expect: 'ECG file - stored, not read; trace preview' })
  put('returning__14-ecg-aecg.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<AnnotatedECG xmlns="urn:hl7-org:v3">\n  <id root="2.16.840.1.113883.3.SYNTHETIC" extension="DEMO-ECG-1"/>\n  <effectiveTime><low value="20260510093000"/></effectiveTime>\n  <componentOf><timepointEvent><componentOf><subjectAssignment><subject><trialSubject><id extension="SYN-RET"/><subjectDemographicPerson><name>Mohd Abdul Rahim Khan</name><administrativeGenderCode code="M"/></subjectDemographicPerson></trialSubject></subject></subjectAssignment></componentOf></timepointEvent></componentOf>\n  <!-- SYNTHETIC SAMPLE: no waveform data, for demonstration only -->\n</AnnotatedECG>\n`),
    { patientKey: 'returning', title: 'ECG export, HL7 aECG XML', demoStep: 'ECG: stored, not read', kind: 'ecg', expect: 'ECG file - stored, not read; waits for a person to attach' })

  // ── photos and reports ──
  const film = await syntheticPicture('CR', 640, 0.5, 'film photograph')
  const filmJpg = await sharp(Buffer.from(film), { raw: { width: 640, height: 640, channels: 1 } }).rotate(-3, { background: '#202020' }).blur(0.6).modulate({ brightness: 0.95 }).extend({ top: 40, bottom: 40, left: 60, right: 60, background: '#c9c4ba' }).jpeg({ quality: 82 }).toBuffer()
  put('hero__15-xray-film-photo.jpg', filmJpg, { patientKey: 'hero', title: 'Phone photo of an X-ray film (JPEG)', demoStep: 'photo formats', kind: 'image', expect: 'Photo; no readable text; held until a person attaches it' })
  const reportSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1300"><rect width="1000" height="1300" fill="#f4f1ea"/><g font-family="sans-serif" fill="#1a1a1a"><text x="60" y="100" font-size="38" font-weight="bold">Triveni Multispeciality Hospital</text><text x="60" y="180" font-size="32">Patient Name: Sunita Deshmukh</text><text x="60" y="235" font-size="32">Age: 51 Y     Sex: F     DOB: 14/08/1974</text><text x="60" y="320" font-size="36" font-weight="bold">CHEST X-RAY REPORT</text><text x="60" y="385" font-size="32">Date of study: 18/03/2026</text><text x="60" y="450" font-size="32">Chest X-ray PA view was obtained.</text><text x="60" y="1230" font-size="22" fill="#a02020">SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY</text></g></svg>`
  const reportPhoto = await sharp(Buffer.from(reportSvg)).rotate(2, { background: '#d8d3c8' }).jpeg({ quality: 85 }).toBuffer()
  // HEIF container (AV1) so the file is a genuine HEIF photo; iPhone HEVC files are converted by the app on the server
  put('hero__16-report-photo.heic', await sharp(reportPhoto).heif({ compression: 'av1', quality: 60 }).toBuffer(), { patientKey: 'hero', title: 'Phone photo of a chest X-ray report (HEIC)', demoStep: 'photo formats', kind: 'image', expect: 'HEIC photo is converted and read like any photo' })

  // multi-page TIFF (uncompressed greyscale, two pages)
  const page = async (n: number) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100"><rect width="900" height="1100" fill="#fff"/><g font-family="sans-serif" fill="#000"><text x="50" y="80" font-size="36" font-weight="bold">Triveni Multispeciality Hospital</text><text x="50" y="150" font-size="30">Patient Name: Sunita Deshmukh</text><text x="50" y="200" font-size="30">Age: 51 Y     Sex: F     DOB: 14/08/1974</text>${n === 1 ? '<text x="50" y="290" font-size="34" font-weight="bold">CHEST X-RAY REPORT</text><text x="50" y="350" font-size="30">Date of study: 18/03/2026</text><text x="50" y="410" font-size="30">Chest X-ray PA view was obtained.</text>' : '<text x="50" y="290" font-size="34" font-weight="bold">CHEST X-RAY REPORT, PAGE 2 OF 2</text><text x="50" y="350" font-size="30">Date of study: 18/03/2026</text><text x="50" y="410" font-size="30">Report issued by the department of radiology.</text>'}<text x="50" y="1060" font-size="20" fill="#a02020">SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY</text></g></svg>`)).greyscale().raw().toBuffer()
  put('hero__17-scan-2-pages.tiff', tiff([{ w: 900, h: 1100, d: await page(1) }, { w: 900, h: 1100, d: await page(2) }]), { patientKey: 'hero', title: 'Scanned note, 2-page TIFF', demoStep: 'photo formats', kind: 'image', expect: 'both pages read' })

  put('hero__18-chest-xray-report.docx', docx(['Triveni Multispeciality Hospital', 'Patient Name: Sunita Deshmukh   Age: 51 Y   Sex: F', 'CHEST X-RAY REPORT', 'Date of study: 18/03/2026', 'Chest X-ray PA view was obtained.', 'SYNTHETIC DOCUMENT - FOR DEMONSTRATION ONLY']),
    { patientKey: 'hero', title: 'Chest X-ray report (Word)', demoStep: 'typed report from a Word file', kind: 'docx', expect: 'read like a typed report, with quotes' })
  put('returning__15-petct-report.pdf', await textPdf(['City Care Hospital, Nagpur', 'Patient Name: Mohd. Abdul Rahim Khan     Age: 64 Y     Sex: M', 'PET-CT WHOLE BODY REPORT', 'Date of study: 28/04/2026', 'Whole body PET-CT was performed.', 'Report issued by the department of radiology.']),
    { patientKey: 'returning', title: 'PET-CT report (typed PDF)', demoStep: 'closes the PET-CT checklist item once a person confirms it', kind: 'pdf', expect: 'imaging report; closes RAD-IMG-PT-01 when attached and confirmed' })

  // ── video ──
  const ff = process.env.FFMPEG_PATH
  if (ff) {
    const dir = mkdtempSync(join(tmpdir(), 'clip-'))
    for (let i = 0; i < 48; i++) writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.png`), await sharp(Buffer.from(await syntheticPicture('US', 256, i / 47, 'ultrasound clip')), { raw: { width: 256, height: 256, channels: 1 } }).png().toBuffer())
    execFileSync(ff, ['-y', '-loglevel', 'error', '-framerate', '12', '-i', join(dir, 'f%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(dir, 'clip.mp4')])
    put('returning__16-ultrasound-clip.mp4', readFileSync(join(dir, 'clip.mp4')), { patientKey: 'returning', title: 'Short ultrasound clip (MP4)', demoStep: 'video: stored and played, not read', kind: 'video', expect: 'Video file - stored, not read; plays inline' })
    rmSync(dir, { recursive: true, force: true })
  } else console.log('FFMPEG_PATH not set: MP4 clip skipped')
  writeFileSync(join(OUT, 'imaging-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

/** Minimal baseline TIFF: uncompressed 8-bit greyscale pages. */
function tiff(pages: { w: number; h: number; d: Uint8Array }[]): Buffer {
  const parts: Buffer[] = [Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])]
  let offset = 8
  const ifds: { buf: Buffer; dataOff: number }[] = []
  pages.forEach((p, idx) => {
    const entries = 8, ifdLen = 2 + entries * 12 + 4, dataOff = offset + ifdLen
    const next = idx + 1 < pages.length ? dataOff + p.d.length : 0
    const b = Buffer.alloc(ifdLen)
    b.writeUInt16LE(entries, 0)
    const e = (i: number, tag: number, type: number, val: number) => { const o = 2 + i * 12; b.writeUInt16LE(tag, o); b.writeUInt16LE(type, o + 2); b.writeUInt32LE(1, o + 4); b.writeUInt32LE(val, o + 8) }
    e(0, 256, 4, p.w); e(1, 257, 4, p.h); e(2, 258, 3, 8); e(3, 259, 3, 1); e(4, 262, 3, 1); e(5, 273, 4, dataOff); e(6, 278, 4, p.h); e(7, 279, 4, p.d.length)
    b.writeUInt32LE(next, 2 + entries * 12)
    ifds.push({ buf: b, dataOff })
    parts.push(b, Buffer.from(p.d))
    offset = dataOff + p.d.length
  })
  return Buffer.concat(parts)
}

/** Minimal Word document: one paragraph per line. */
function docx(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  })
}

void main()
