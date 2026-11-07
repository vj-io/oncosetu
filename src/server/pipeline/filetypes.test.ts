import { zipSync, strToU8 } from 'fflate'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { modalityWord, readDicomMeta, renderDicomFrame, studyLabel, tooBigToDraw } from './dicom'
import { buildSyntheticDicom } from './dicom-synthetic'
import { CATEGORY_LABEL, isStoredOnly, sniffFile, storedNote } from './filetypes'

const px = { create: { width: 8, height: 8, channels: 3 as const, background: '#888' } }
const box = (brand: string) => { const b = Buffer.alloc(32); b.writeUInt32BE(32, 0); b.write('ftyp', 4); b.write(brand, 8); return b }

describe('sniffFile: by content, never by extension', () => {
  it('recognises photos: JPEG, PNG, WebP, TIFF (multi-page too), HEIC', async () => {
    expect(sniffFile(await sharp(px).jpeg().toBuffer())).toMatchObject({ kind: 'jpeg', category: 'photo' })
    expect(sniffFile(await sharp(px).png().toBuffer())?.kind).toBe('png')
    expect(sniffFile(await sharp(px).webp().toBuffer())?.kind).toBe('webp')
    const tiff = await sharp(px).tiff().toBuffer()
    expect(sniffFile(tiff)).toMatchObject({ kind: 'tiff', mime: 'image/tiff', category: 'photo' })
    expect(sniffFile(box('heic'))).toMatchObject({ kind: 'heic', category: 'photo' })
  })
  it('recognises a PDF, even with junk before the header', () => {
    expect(sniffFile(Buffer.from('xx\n%PDF-1.7\n...'))).toMatchObject({ kind: 'pdf', category: 'report' })
  })
  it('recognises DICOM by the DICM marker, whatever the file is called', async () => {
    const d = await buildSyntheticDicom({ modality: 'CT', patientName: 'Khan^Mohd', studyUid: '1.2.3', size: 32 })
    for (const name of ['scan.dcm', 'scan.jpg', 'IM0001', '']) expect(sniffFile(d, name)).toMatchObject({ kind: 'dicom', category: 'scan' })
  })
  it('recognises NIfTI (.nii by its magic, .nii.gz by gzip plus the name)', () => {
    const nii = Buffer.alloc(400); nii.write('n+1', 344); nii[347] = 0
    expect(sniffFile(nii)).toMatchObject({ kind: 'nifti', category: 'scan' })
    expect(sniffFile(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0]), 'brain.nii.gz')?.kind).toBe('nifti')
    expect(sniffFile(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0]), 'x.gz')).toBeNull()
  })
  it('recognises MP4 and MOV video', () => {
    expect(sniffFile(box('isom'))).toMatchObject({ kind: 'video', mime: 'video/mp4', category: 'video' })
    expect(sniffFile(box('qt  '))).toMatchObject({ kind: 'video', mime: 'video/quicktime' })
    expect(sniffFile(box('zzzz'))).toBeNull()
  })
  it('tells a DOCX from any other ZIP', () => {
    const docx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>') })
    const zip = zipSync({ 'a.txt': strToU8('hello') })
    expect(sniffFile(docx)).toMatchObject({ kind: 'docx', category: 'report' })
    expect(sniffFile(zip)).toMatchObject({ kind: 'zip' })
  })
  it('recognises ECG files: HL7 aECG and vendor XML, SCP-ECG; plain text; and refuses unknown XML', () => {
    expect(sniffFile(Buffer.from('<?xml version="1.0"?><AnnotatedECG xmlns="urn:hl7-org:v3"><id/></AnnotatedECG>'))).toMatchObject({ kind: 'ecg_xml', category: 'ecg' })
    expect(sniffFile(Buffer.from('<?xml version="1.0"?><RestingECG><PatientDemographics/></RestingECG>'))?.kind).toBe('ecg_xml')
    const scp = Buffer.alloc(64); scp.writeUInt32LE(64, 2)
    expect(sniffFile(scp, 'tracing.scp')).toMatchObject({ kind: 'ecg_scp', category: 'ecg' })
    expect(sniffFile(scp, 'tracing.bin')).toBeNull()
    expect(sniffFile(Buffer.from('Chest X-ray report. No acute findings.'))).toMatchObject({ kind: 'text', category: 'report' })
    expect(sniffFile(Buffer.from('<html><body>hi</body></html>'))).toBeNull()
  })
  it('refuses binary junk and executables', () => {
    expect(sniffFile(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]))).toBeNull()
  })
  it('labels: stored-not-read for imaging, ECG and video; text kinds are read', () => {
    expect(['dicom', 'nifti', 'video', 'ecg_xml', 'ecg_scp'].every((k) => isStoredOnly(k as 'dicom'))).toBe(true)
    expect(['pdf', 'docx', 'text', 'jpeg', 'tiff'].some((k) => isStoredOnly(k as 'pdf'))).toBe(false)
    expect(storedNote('scan', 'dicom')).toBe('Imaging file — stored, not read')
    expect(storedNote('ecg', 'ecg_xml')).toBe('ECG file — stored, not read')
    expect(storedNote('video', 'video')).toBe('Video file — stored, not read')
    expect(Object.values(CATEGORY_LABEL)).toEqual(['Report', 'Scan', 'ECG', 'Video', 'Photo'])
  })
})

describe('DICOM header and preview', () => {
  it('reads modality, date, body part, institution and the patient fields as written', async () => {
    const d = await buildSyntheticDicom({ modality: 'DX', patientName: 'Deshmukh^Sunita', sex: 'F', age: '051Y', studyDate: '20260315', bodyPart: 'CHEST', institution: 'Test Hospital', studyUid: '1.2.9', size: 64 })
    const m = readDicomMeta(d)!
    expect(m).toMatchObject({ modality: 'DX', modalityLabel: 'X-ray', studyDate: '2026-03-15', bodyPart: 'CHEST', institution: 'Test Hospital', patientName: 'Sunita Deshmukh', patientSex: 'F', patientAge: '51 Y', studyUid: '1.2.9', synthetic: true })
  })
  it('names modalities in plain words, and a PT plus CT study is a PET-CT', () => {
    expect(modalityWord('MR')).toBe('MRI'); expect(modalityWord('MG')).toBe('Mammogram'); expect(modalityWord('NM')).toMatch(/Bone scan/)
    expect(modalityWord('OT', '1.2.840.10008.5.1.4.1.1.481.5')).toBe('Radiotherapy plan')
    expect(modalityWord(null, '1.2.840.10008.5.1.4.1.1.481.3')).toBe('Radiotherapy structure set')
    expect(studyLabel(['PT', 'CT'])).toBe('PET-CT'); expect(studyLabel(['CT'])).toBe('CT scan')
  })
  it('draws a PNG preview of an uncompressed file, and the middle frame of a multi-frame file by default', async () => {
    const d = await buildSyntheticDicom({ modality: 'CT', patientName: 'Khan^Mohd', studyUid: '1.2.5', size: 64, frames: 5 })
    const p = await renderDicomFrame(d)
    expect(p).toMatchObject({ ok: true, frames: 5, frame: 2 })
    if (p.ok) expect((await sharp(p.png).metadata())).toMatchObject({ format: 'png', width: 64, height: 64 })
    expect(await renderDicomFrame(d, 0)).toMatchObject({ ok: true, frame: 0 })
    expect(await renderDicomFrame(d, 99)).toMatchObject({ ok: true, frame: 4 })
  })
  it('refuses to draw a header that claims a huge picture instead of allocating for it (decompression bomb)', async () => {
    expect(tooBigToDraw(4096, 4096, 1)).toBe(false)
    expect(tooBigToDraw(4096, 4096, 3)).toBe(true)
    expect(tooBigToDraw(40000, 40000, 1)).toBe(true) // would be 3.2 GB for 16-bit RLE output, 6.4 GB as floats
    const d = await buildSyntheticDicom({ modality: 'PT', patientName: 'A^B', studyUid: '1.2.7', size: 48, rle: true })
    for (const tag of [[0x28, 0x00, 0x10, 0x00], [0x28, 0x00, 0x11, 0x00]]) { // Rows, Columns (US)
      const at = d.indexOf(Buffer.from([...tag, 0x55, 0x53, 0x02, 0x00]))
      d.writeUInt16LE(40000, at + 8)
    }
    expect(await renderDicomFrame(d)).toMatchObject({ ok: false, reason: 'compression' })
  })
  it('decodes RLE-compressed files to the same picture as the uncompressed one', async () => {
    const raw = await renderDicomFrame(await buildSyntheticDicom({ modality: 'PT', patientName: 'A^B', studyUid: '1.2.6', size: 48 }))
    const rle = await renderDicomFrame(await buildSyntheticDicom({ modality: 'PT', patientName: 'A^B', studyUid: '1.2.6', size: 48, rle: true }))
    expect(raw.ok && rle.ok).toBe(true)
    if (raw.ok && rle.ok) expect(rle.png.equals(raw.png)).toBe(true)
  })
  it('says so plainly when the compression is not supported, and never throws on garbage', async () => {
    const d = await buildSyntheticDicom({ modality: 'CT', patientName: 'A^B', studyUid: '1.2.7', size: 32, transferSyntax: '1.2.840.10008.1.2.4.90' }) // JPEG 2000
    const r = await renderDicomFrame(d)
    expect(r).toMatchObject({ ok: false, reason: 'compression', note: 'Preview not available for this compression — file stored' })
    expect(await renderDicomFrame(Buffer.from('not dicom at all'.repeat(20)))).toMatchObject({ ok: false })
  })
})
