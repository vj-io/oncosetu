import { afterEach, describe, expect, it, vi } from 'vitest'
import { FILE_UNAVAILABLE, storedBytes } from './files'
import { ObjectStoreError, s3Store, setObjectStoreForTests } from './objects'

afterEach(() => { setObjectStoreForTests(undefined); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
