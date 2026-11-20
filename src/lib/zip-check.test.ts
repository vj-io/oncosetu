import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { MAX_ZIP_ENTRIES } from '@/core/limits'
import { checkZipBeforeUpload, readZipDirectory } from './zip-check'

const blobOf = (files: Record<string, Uint8Array>) => new Blob([zipSync(files) as BlobPart])

describe('checking a ZIP in the browser before it uploads', () => {
  it('reads the entry count and unpacked size from the directory alone', async () => {
    const s = await readZipDirectory(blobOf({ 'a/1.dcm': new Uint8Array(1000), 'a/2.dcm': new Uint8Array(500), '__MACOSX/x': strToU8('j') }))
    expect(s).toEqual({ entries: 2, unpackedBytes: 1500, nestedArchives: 0, others: 2 })
  })
  it('refuses too many files, with the numbers', async () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < MAX_ZIP_ENTRIES + 5; i++) files[`s/${i}.dcm`] = strToU8(`slice ${i}`)
    const r = await checkZipBeforeUpload(blobOf(files), 'cd.zip')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/3,005 files.*at most 3,000/)
  })
  it('accepts a real-sized study (2,500 slices) and refuses a ZIP of only archives', async () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 2500; i++) files[`s/${i}.dcm`] = strToU8(`slice ${i}`)
    expect((await checkZipBeforeUpload(blobOf(files), 'cd.zip')).ok).toBe(true)
    const nested = await checkZipBeforeUpload(blobOf({ 'one.zip': strToU8('PK'), 'two.7z': strToU8('7z') }), 'cd.zip')
    expect(nested.ok).toBe(false)
    expect(!nested.ok && nested.reason).toMatch(/ZIP inside a ZIP/)
  })
  it('lets a non-ZIP or an unreadable one through for the server to decide', async () => {
    expect((await checkZipBeforeUpload(new Blob(['x']), 'a.pdf')).ok).toBe(true)
    expect((await checkZipBeforeUpload(new Blob(['not a zip at all']), 'a.zip')).ok).toBe(true)
  })
})
