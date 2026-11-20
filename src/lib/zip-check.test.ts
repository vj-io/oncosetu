import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_UNCOMPRESSED_BYTES } from '@/core/limits'
import { en, hi, hinglish, tp } from '@/i18n/patient'
import { documentsCopy } from '@/i18n/documents'
import { checkZipBeforeUpload, PATIENT_ZIP_REASON, readZipDirectory, zipReasonVars, zipRefusal } from './zip-check'

const blobOf = (files: Record<string, Uint8Array>) => new Blob([zipSync(files) as BlobPart])
const many = (n: number) => { const f: Record<string, Uint8Array> = {}; for (let i = 0; i < n; i++) f[`s/${i}.dcm`] = strToU8(`slice ${i}`); return f }
const none = { entries: 0, unpackedBytes: 0, bomb: false, nestedArchives: 0, others: 0 }

describe('checking a ZIP in the browser before it uploads', () => {
  it('reads the entry count, unpacked size and expansion from the directory alone, counting every file the server counts', async () => {
    const s = await readZipDirectory(blobOf({ 'a/1.dcm': new Uint8Array(1000), 'a/2.dcm': new Uint8Array(500), '__MACOSX/x': strToU8('j') }))
    expect(s).toEqual({ entries: 3, unpackedBytes: 1501, bomb: false, nestedArchives: 0, others: 2 })
  })
  it('accepts a real-sized study (2,500 slices)', async () => {
    expect(await checkZipBeforeUpload(blobOf(many(2500)), 'cd.zip')).toEqual({ ok: true })
  })
  it('refuses 3,001 files with the entries reason and the numbers', async () => {
    const r = await checkZipBeforeUpload(blobOf(many(MAX_ZIP_ENTRIES + 1)), 'cd.zip')
    expect(r).toMatchObject({ ok: false, code: 'zip_too_many_files' })
    expect(!r.ok && r.message).toMatch(/3,001 files.*at most 3,000/)
  })
  it('refuses a ratio bomb', async () => {
    expect(await checkZipBeforeUpload(blobOf({ 'zeros.bin': new Uint8Array(4 * 1024 * 1024) }), 'cd.zip')).toMatchObject({ ok: false, code: 'zip_bomb' })
  })
  it('refuses a ZIP of only archives', async () => {
    const r = await checkZipBeforeUpload(blobOf({ 'one.zip': strToU8('PK'), 'two.7z': strToU8('7z') }), 'cd.zip')
    expect(r).toMatchObject({ ok: false, code: 'zip_only_archives' })
  })
  it('refuses by size, zipped and unpacked, at exactly the limits', () => {
    expect(zipRefusal(none, MAX_ZIP_BYTES)).toBeNull()
    expect(zipRefusal(none, MAX_ZIP_BYTES + 1)).toMatchObject({ code: 'zip_too_large' })
    expect(zipRefusal({ ...none, entries: 1, unpackedBytes: MAX_ZIP_UNCOMPRESSED_BYTES }, 100)).toBeNull()
    expect(zipRefusal({ ...none, entries: 1, unpackedBytes: MAX_ZIP_UNCOMPRESSED_BYTES + 1 }, 100)).toMatchObject({ code: 'zip_too_big_unpacked' })
    expect(zipRefusal({ ...none, entries: MAX_ZIP_ENTRIES }, 100)).toBeNull()
  })
  it('lets a non-ZIP or an unreadable one through for the server to decide', async () => {
    expect(await checkZipBeforeUpload(new Blob(['x']), 'a.pdf')).toEqual({ ok: true })
    expect(await checkZipBeforeUpload(new Blob(['not a zip at all']), 'a.zip')).toEqual({ ok: true })
  })
})

describe('the reason a patient sees, in English and Hindi', () => {
  it('every refusal has its own plain sentence in each language, naming the limit', () => {
    for (const [code, key] of Object.entries(PATIENT_ZIP_REASON)) {
      for (const lang of ['en', 'hi', 'hinglish'] as const) {
        const s = tp(lang, key, zipReasonVars)
        expect(s, `${code} ${lang}`).not.toMatch(/\{\w+\}/)
        if (code === 'zip_too_large') expect(s).toContain(`${MAX_ZIP_BYTES / 1048576} MB`)
        if (code === 'zip_too_many_files') expect(s).toContain('3,000')
      }
      expect(tp('hi', key, zipReasonVars)).not.toBe(tp('en', key, zipReasonVars))
    }
  })
  it('the limits written in the upload texts are the limits in force', () => {
    const zip = `${MAX_ZIP_BYTES / 1048576} MB`
    for (const t of [en, hi, hinglish]) for (const k of ['uploadFormats', 'fileTooLarge'] as const) expect(t[k]).toContain(zip)
    for (const v of Object.values(documentsCopy.tooLarge)) expect(v).toContain(zip)
  })
})
