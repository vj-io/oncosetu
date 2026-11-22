import { randomBytes } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { encryptBytes } from './crypto'
import { FILE_UNAVAILABLE, resetOriginalCacheForTests, storedBytes } from './files'
import { ObjectStoreError, s3Store, setObjectStoreForTests, type ObjectStore } from './objects'

beforeAll(() => { process.env.APP_MASTER_KEY ??= randomBytes(32).toString('base64') })
afterEach(() => { setObjectStoreForTests(undefined); resetOriginalCacheForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('a stored original that object storage will not hand back', () => {
  it('the S3 client reports the status and the storage code (B2 answers a passed daily download cap with 403 AccessDenied)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error><Code>AccessDenied</Code><Message>download cap exceeded</Message></Error>', { status: 403 })))
    const store = s3Store({ endpoint: 'https://s3.example.test', region: 'us-west-004', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' })
    const err = await store.get('docs/x').catch((e) => e)
    expect(err).toBeInstanceOf(ObjectStoreError)
    expect(err).toMatchObject({ method: 'GET', status: 403, storageCode: 'AccessDenied' })
  })

  it('becomes a plain 503 "file could not be read just now", logged with the status and code only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setObjectStoreForTests({ put: async () => {}, del: async () => {}, get: async () => { throw new ObjectStoreError('GET', 403, 'AccessDenied') } })
    const err = await storedBytes({ objectKey: 'docs/x', bytesEnc: new Uint8Array(), dekWrapped: 'v1.x' }).catch((e) => e)
    expect(err).toMatchObject({ name: 'HttpError', status: 503, code: 'file_unavailable', message: FILE_UNAVAILABLE })
    const line = String((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
    expect(JSON.parse(line)).toMatchObject({ msg: 'stored file could not be read', status: 403, storageCode: 'AccessDenied' })
    expect(line).not.toContain('docs/x') // the object key is not logged
  })
})

describe('stored originals are downloaded once per server instance (B2 caps downloads per day)', () => {
  // A store that counts downloads; every object is a real encrypted file, so storedBytes decrypts it as in production.
  const countingStore = () => {
    const objects = new Map<string, Uint8Array>(), gets: string[] = []
    const store: ObjectStore = { put: async (k, b) => { objects.set(k, b) }, del: async (k) => { objects.delete(k) }, get: async (k) => { gets.push(k); return objects.get(k)! } }
    const add = (key: string, plain: string) => { const { bytes, dekWrapped } = encryptBytes(Buffer.from(plain)); objects.set(key, bytes); return { objectKey: key, bytesEnc: new Uint8Array(), dekWrapped } }
    return { store, gets, add }
  }

  it('scrolling back to a slice reads it from memory, and each read still decrypts to the same file', async () => {
    const { store, gets, add } = countingStore()
    setObjectStoreForTests(store)
    const slice = add('o/org/slice-1', 'slice one')
    for (let i = 0; i < 5; i++) expect((await storedBytes(slice)).toString()).toBe('slice one')
    expect(gets).toEqual(['o/org/slice-1'])
  })

  it('readers asking for the same file at once share one download', async () => {
    const { store, gets, add } = countingStore()
    setObjectStoreForTests(store)
    const f = add('o/org/frame', 'frame')
    const out = await Promise.all([storedBytes(f), storedBytes(f), storedBytes(f)])
    expect(out.map(String)).toEqual(['frame', 'frame', 'frame'])
    expect(gets).toHaveLength(1)
  })

  it('stays within its size: the least recently used file leaves first, and a file too big to keep is not kept', async () => {
    const { store, gets, add } = countingStore()
    setObjectStoreForTests(store)
    const a = add('o/org/a', 'a'.repeat(100)), b = add('o/org/b', 'b'.repeat(100)), c = add('o/org/c', 'c'.repeat(100))
    const sealed = (await store.get('o/org/a')).byteLength
    gets.length = 0
    resetOriginalCacheForTests({ total: sealed * 2, entry: sealed * 2 }) // room for two
    await storedBytes(a); await storedBytes(b); await storedBytes(a) // a is now the most recently used
    await storedBytes(c) // over the limit: b, the least recently used, leaves
    await storedBytes(a); await storedBytes(b)
    expect(gets).toEqual(['o/org/a', 'o/org/b', 'o/org/c', 'o/org/b'])
    gets.length = 0
    resetOriginalCacheForTests({ entry: sealed - 1 }) // each file is now too big to keep
    await storedBytes(a); await storedBytes(a)
    expect(gets).toEqual(['o/org/a', 'o/org/a'])
  })

  it('a download that does not decrypt (a changed object) is not kept: the next read asks the store again', async () => {
    const { store, gets, add } = countingStore()
    setObjectStoreForTests(store)
    const f = add('o/org/changed', 'original')
    const b = await store.get('o/org/changed'); b[b.length - 1] ^= 1; gets.length = 0
    await expect(storedBytes(f)).rejects.toThrow()
    await expect(storedBytes(f)).rejects.toThrow()
    expect(gets).toEqual(['o/org/changed', 'o/org/changed'])
  })

  it('a refused download is not kept: the next read asks the store again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let refuse = true
    const { store, gets, add } = countingStore()
    const get = store.get
    store.get = async (k) => { if (refuse) { gets.push(k); throw new ObjectStoreError('GET', 403, 'AccessDenied') } return get(k) }
    setObjectStoreForTests(store)
    const f = add('o/org/x', 'x')
    await expect(storedBytes(f)).rejects.toMatchObject({ status: 503 })
    refuse = false
    expect((await storedBytes(f)).toString()).toBe('x')
    expect(gets).toEqual(['o/org/x', 'o/org/x'])
  })
})
