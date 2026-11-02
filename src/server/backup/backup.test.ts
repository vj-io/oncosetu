import { createHash, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { backupPathname, expiredBackups, verifyBackup, type Manifest } from './backup'
import { backupKey, decrypt, encrypt } from './envelope'

const key = backupKey(randomBytes(32).toString('base64'))
const other = backupKey(randomBytes(32).toString('base64'))
const collect = async (it: AsyncIterable<Buffer>) => { const out: Buffer[] = []; for await (const b of it) out.push(b); return Buffer.concat(out) }
const chunks = (b: Buffer, size = 7) => Readable.from(Array.from({ length: Math.ceil(b.length / size) }, (_, i) => b.subarray(i * size, (i + 1) * size)))
const seal = (plain: Buffer, k = key) => collect(encrypt(Readable.from([plain]), k))

describe('backup envelope (AES-256-GCM, streamed)', () => {
  const plain = randomBytes(100_000)

  it('round-trips, whatever the chunking, and carries the key id in the clear', async () => {
    const sealed = await seal(plain)
    expect(sealed.subarray(0, 5)).toEqual(Buffer.from('OSBK\x01'))
    expect(sealed.subarray(6, 6 + sealed[5]).toString()).toBe(key.id)
    expect(sealed.length).toBe(plain.length + 6 + key.id.length + 12 + 16)
    expect(await collect(decrypt(chunks(sealed, 7), [key]))).toEqual(plain)
    expect(await collect(decrypt(chunks(sealed, 65_536), [other, key]))).toEqual(plain) // previous key in the list
  })

  it('fails on any changed byte: data, tag, IV or header', async () => {
    const sealed = await seal(plain)
    for (const at of [sealed.length - 1, sealed.length - 20, 6 + key.id.length + 3, 4]) {
      const bad = Buffer.from(sealed)
      bad[at] ^= 1
      await expect(collect(decrypt(chunks(bad, 4096), [key]))).rejects.toThrow()
    }
  })

  it('fails with the wrong key, naming the key the backup needs', async () => {
    const sealed = await seal(plain)
    await expect(collect(decrypt(chunks(sealed), [other]))).rejects.toThrow(key.id)
  })

  it('fails when truncated', async () => {
    const sealed = await seal(plain)
    await expect(collect(decrypt(chunks(sealed.subarray(0, sealed.length - 1)), [key]))).rejects.toThrow()
    await expect(collect(decrypt(chunks(sealed.subarray(0, 10)), [key]))).rejects.toThrow('truncated')
  })

  it('rejects a key that is not 32 bytes', () => {
    expect(() => backupKey(randomBytes(16).toString('base64'))).toThrow('32 bytes')
  })
})

describe('backup file: gzip + manifest verification', () => {
  const rows = ['{"id":1,"b":"AAE="}', '{"id":2,"b":null}']
  const sha = createHash('sha256').update(rows.map((r) => r + '\n').join('')).digest('hex')
  const manifest = (over: Partial<Manifest['tables'][number]> = {}): Manifest => ({
    format: 'oncosetu-backup', version: 1, createdAt: '2026-11-02T00:00:00.000Z', database: { host: 'h', name: 'n', serverVersion: '17' },
    migrations: [], tables: [{ name: 't', rows: 2, sha256: sha, ...over }], auditHeads: {}, plainBytes: 0, exportMs: 0,
  })
  const file = (m: Manifest, body = rows) =>
    seal(gzipSync(`#table {"name":"t","columns":[{"name":"id","type":"integer"},{"name":"b","type":"bytea"}]}\n${body.map((r) => r + '\n').join('')}#manifest ${JSON.stringify(m)}\n`))

  it('accepts a file whose tables match its manifest', async () => {
    const r = await verifyBackup(Readable.from([await file(manifest())]), [key])
    expect(r.problems).toEqual([])
    expect(r.manifest.tables[0].rows).toBe(2)
  })

  it('reports a row count or hash that differs from the manifest', async () => {
    expect((await verifyBackup(Readable.from([await file(manifest({ rows: 3 }))]), [key])).problems).toHaveLength(1)
    expect((await verifyBackup(Readable.from([await file(manifest(), [rows[0], '{"id":2,"b":"AA=="}'])]), [key])).problems[0]).toMatch(/^t: 2 rows/)
  })

  it('fails without a manifest (a truncated plaintext)', async () => {
    const f = await seal(gzipSync(`#table {"name":"t","columns":[]}\n${rows[0]}\n`))
    await expect(verifyBackup(Readable.from([f]), [key])).rejects.toThrow('no manifest')
  })
})

describe('retention selection', () => {
  const now = new Date('2026-11-02T03:00:00Z')
  const daily = (n: number) => Array.from({ length: n }, (_, i) => {
    const at = new Date(now.getTime() - i * 86_400_000)
    return { pathname: backupPathname(at), uploadedAt: at }
  })

  it('names files by UTC date and time', () => {
    expect(backupPathname(new Date('2026-11-02T02:45:07.123Z'))).toBe('backups/2026/11/02/oncosetu-20261102T024507Z.bak')
  })

  it('deletes backups older than the window, oldest first', () => {
    const all = daily(40) // ages 0..39 days
    const gone = expiredBackups(all, now, 35)
    expect(gone.map((b) => b.pathname)).toEqual(all.slice(36).map((b) => b.pathname)) // 36..39 days old; exactly 35 days stays
  })

  it('always keeps the 7 newest, however old', () => {
    const old = daily(60).slice(50) // 10 backups, 50..59 days old (the job stopped for a while)
    const gone = expiredBackups([...old].reverse(), now, 35)
    expect(gone).toHaveLength(3)
    expect(gone.map((b) => b.pathname)).toEqual(old.slice(7).map((b) => b.pathname))
    expect(expiredBackups(old.slice(0, 7), now, 35)).toEqual([])
  })

  it('never selects objects that are not backups', () => {
    const stray = [{ pathname: 'backups/notes.txt', uploadedAt: new Date(0) }, { pathname: 'other/x.bak', uploadedAt: new Date(0) }]
    expect(expiredBackups([...daily(10), ...stray], now, 1)).toHaveLength(3)
    expect(expiredBackups([...daily(10), ...stray], now, 1).every((b) => b.pathname.startsWith('backups/20'))).toBe(true)
  })
})
