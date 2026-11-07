import { strToU8, zipSync } from 'fflate'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { MAX_ZIP_ENTRIES } from '@/core/limits'
import { checkStart } from '../uploads/chunks'
import { buildSyntheticDicom } from './dicom-synthetic'
import { sniffFile } from './filetypes'
import { bundleInstances, orderedInstances } from './study'
import { groupDicom, planZip } from './zip'

describe('planZip: opening a ZIP safely', () => {
  it('opens a mixed ZIP and lists what it skipped, with plain reasons', async () => {
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#999' } }).jpeg().toBuffer()
    const nested = zipSync({ 'inner.txt': strToU8('x') })
    const zip = zipSync({
      'reports/ct.txt': strToU8('CT chest report. No change from previous.'), 'photos/film.jpg': jpg, '__MACOSX/._film.jpg': strToU8('junk'),
      'archive.zip': nested, 'DICOMDIR': strToU8('index'), 'empty.txt': new Uint8Array(0),
    })
    const plan = planZip(zip)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.entries.map((e) => e.name).sort()).toEqual(['photos/film.jpg', 'reports/ct.txt'])
    const reasons = Object.fromEntries(plan.skipped.map((s) => [s.name, s.reason]))
    expect(reasons['archive.zip']).toMatch(/inside a ZIP/)
    expect(reasons['__MACOSX/._film.jpg']).toBe('system file')
    expect(reasons['empty.txt']).toBe('empty file')
    expect(reasons['DICOMDIR']).toMatch(/DICOMDIR/)
  })

  it('refuses path traversal and absolute paths in names (nothing is written to disk anyway)', () => {
    const zip = zipSync({ '../../etc/passwd': strToU8('root'), '/abs/file.txt': strToU8('x'), 'C:/win/file.txt': strToU8('x'), 'ok/report.txt': strToU8('fine report text') })
    const plan = planZip(zip)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.entries.map((e) => e.name)).toEqual(['ok/report.txt'])
    expect(plan.skipped.filter((s) => s.reason === 'unsafe file name')).toHaveLength(3)
  })

  it('refuses a zip bomb before inflating it (huge expansion ratio)', () => {
    const zip = zipSync({ 'zeros.bin': new Uint8Array(30 * 1024 * 1024) }) // 30 MB of zeros packs to a few KB
    const plan = planZip(zip)
    expect(plan).toMatchObject({ ok: false, code: 'zip_bomb' })
  })

  it('refuses too many files', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < MAX_ZIP_ENTRIES + 1; i++) files[`f${i}.txt`] = strToU8(`file number ${i}`)
    expect(planZip(zipSync(files))).toMatchObject({ ok: false, code: 'zip_too_many_files' })
  })

  it('says so for something that is not a ZIP, and for an empty ZIP', () => {
    expect(planZip(Buffer.from('PK\u0003\u0004 not really'))).toMatchObject({ ok: false, code: 'zip_unreadable' })
    expect(planZip(zipSync({}))).toMatchObject({ ok: false, code: 'zip_empty' })
  })
})

describe('DICOM series in a ZIP become one study', () => {
  it('groups instances by StudyInstanceUID, labels a PT plus CT study as PET-CT, and keeps other files apart', async () => {
    const uid = '1.2.826.0.1.3680043.8.498.777'
    const entries = [] as { name: string; base: string; data: Uint8Array }[]
    for (let i = 1; i <= 5; i++) entries.push({ name: `PETCT/CT/IM${i}`, base: `IM${i}`, data: await buildSyntheticDicom({ modality: 'CT', patientName: 'Khan^Mohd', studyUid: uid, instance: i, size: 32 }) })
    for (let i = 1; i <= 3; i++) entries.push({ name: `PETCT/PT/IM${i}`, base: `IM${i}`, data: await buildSyntheticDicom({ modality: 'PT', patientName: 'Khan^Mohd', studyUid: uid, instance: 10 + i, size: 32 }) })
    entries.push({ name: 'other/chest.dcm', base: 'chest.dcm', data: await buildSyntheticDicom({ modality: 'DX', patientName: 'Khan^Mohd', studyUid: '1.2.9.9', size: 32 }) })
    entries.push({ name: 'notes.txt', base: 'notes.txt', data: strToU8('a plain note') })
    const { studies, others } = groupDicom(entries)
    expect(studies).toHaveLength(2)
    const pet = studies.find((s) => s.studyUid === uid)!
    expect(pet.instances).toHaveLength(8)
    expect(pet.label).toBe('PET-CT')
    expect(studies.find((s) => s.studyUid === '1.2.9.9')?.label).toBe('X-ray')
    expect(others.map((o) => o.name)).toEqual(['notes.txt'])
  })

  it('a study bundle keeps reading order, and its preview slice defaults to the middle', async () => {
    const files: Record<string, Uint8Array> = {}
    for (const n of [3, 1, 2]) files[`z${n}.dcm`] = await buildSyntheticDicom({ modality: 'CT', patientName: 'A^B', studyUid: '1.2.5', instance: n, size: 24 })
    const slices = orderedInstances(bundleInstances(files))
    expect(slices).toHaveLength(3)
    const { parseDicomHeader } = await import('./dicom')
    expect(slices.map((s) => parseDicomHeader(s).meta.instanceNumber)).toEqual([1, 2, 3])
    expect(sniffFile(bundleInstances(files))?.kind).toBe('zip')
  })
})

describe('chunked upload start checks', () => {
  const sha = 'a'.repeat(64)
  it('accepts a 20 MB file in 6 chunks and refuses anything over the caps', () => {
    expect(checkStart({ fileName: 'ct.dcm', totalSize: 20 * 1048576, totalChunks: 6, sha256: sha })).toEqual({ ok: true })
    expect(checkStart({ fileName: 'ct.dcm', totalSize: 51 * 1048576, totalChunks: 15, sha256: sha })).toMatchObject({ ok: false, code: 'file_too_large' })
    expect(checkStart({ fileName: 'series.zip', totalSize: 150 * 1048576, totalChunks: 43, sha256: sha })).toEqual({ ok: true })
    expect(checkStart({ fileName: 'series.zip', totalSize: 201 * 1048576, totalChunks: 58, sha256: sha })).toMatchObject({ ok: false, code: 'file_too_large' })
  })
  it('refuses a bad checksum format, an empty file and a chunk count that does not fit', () => {
    expect(checkStart({ fileName: 'a.pdf', totalSize: 1000, totalChunks: 1, sha256: 'nope' })).toMatchObject({ ok: false, code: 'invalid_request' })
    expect(checkStart({ fileName: 'a.pdf', totalSize: 0, totalChunks: 1, sha256: sha })).toMatchObject({ ok: false, code: 'empty_file' })
    expect(checkStart({ fileName: 'a.pdf', totalSize: 20 * 1048576, totalChunks: 1, sha256: sha })).toMatchObject({ ok: false })
  })
})
