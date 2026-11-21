// Backups without a Blob store (the free pilot): runBackup writes the encrypted backup to the object store in this week's
// slot plus a pointer to it, and the stored bytes verify against their own manifest (GCM tag, row counts, SHA-256).
// An in-memory store stands in for the bucket (the live run against the real bucket is part of deploying). Needs .env.local.
import { existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')
const objects = new Map<string, Uint8Array>()
const memStore = {
  async put(k: string, b: Uint8Array) { objects.set(k, new Uint8Array(b)) },
  async get(k: string) { const b = objects.get(k); if (!b) throw new Error('NoSuchKey'); return b },
  async del(k: string) { objects.delete(k) },
}

afterAll(async () => {
  vi.unstubAllEnvs()
  ;(await import('../../src/server/objects')).setObjectStoreForTests(undefined)
  await (await import('../../src/db')).closeDb()
})

describe('backup to the object store', () => {
  it('writes this week\'s slot and a pointer, and the file verifies against its manifest', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const { setObjectStoreForTests } = await import('../../src/server/objects')
    const { runBackup, verifyBackup, backupSlotKey, BACKUP_LATEST_KEY } = await import('../../src/server/backup/backup')
    const { backupKeysFromEnv } = await import('../../src/server/backup/envelope')
    setObjectStoreForTests(memStore)
    const now = new Date('2026-11-22T03:00:00Z')
    const r = await runBackup(now)
    expect(r.id).toBe(backupSlotKey(now))
    expect(objects.has(r.id)).toBe(true)
    expect(JSON.parse(Buffer.from(objects.get(BACKUP_LATEST_KEY)!).toString())).toMatchObject({ key: r.id, bytes: r.bytes })
    const { manifest, problems } = await verifyBackup(Readable.from([Buffer.from(objects.get(r.id)!)]), backupKeysFromEnv())
    expect(problems).toEqual([])
    expect(manifest.tables.length).toBe(r.tables)
    expect(r.rows).toBeGreaterThan(0)
  })

  it('refuses when neither a Blob store nor an object store is configured', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const { setObjectStoreForTests } = await import('../../src/server/objects')
    const { runBackup } = await import('../../src/server/backup/backup')
    setObjectStoreForTests(null)
    await expect(runBackup()).rejects.toThrow(/no backup store/)
  })

  it('the weekly cron backs up to the object store when there is no Blob store, and answers 503 when there is neither', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const { setObjectStoreForTests } = await import('../../src/server/objects')
    const { backupSlotKey } = await import('../../src/server/backup/backup')
    const { GET } = await import('../../src/app/api/cron/backup/route')
    const call = () => GET(new NextRequest('http://localhost/api/cron/backup', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), { params: Promise.resolve({}) })
    setObjectStoreForTests(memStore)
    const ok = await call()
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { backup: { id: string } }).backup.id).toBe(backupSlotKey(new Date()))
    setObjectStoreForTests(null)
    expect((await call()).status).toBe(503)
  })
})
