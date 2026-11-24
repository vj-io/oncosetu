// Encrypted files (originals, page images, upload chunks) in S3-compatible object storage (Backblaze B2 or Cloudflare R2:
// 10 GB free each) when S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are set; otherwise
// every file stays in Postgres. Only ciphertext is sent:
// files are encrypted with a per-file key before upload, and that key lives only in the document_files row.
// A minimal AWS Signature Version 4 client (PUT, GET, DELETE of one object), so no SDK is added.
import { createHash, createHmac } from 'node:crypto'

/** A refusal from the store, with its HTTP status and S3 error code (AccessDenied, NoSuchKey, …). */
export class ObjectStoreError extends Error {
  constructor(public method: string, public status: number, public storageCode: string) {
    super(`object storage ${method} failed: HTTP ${status} ${storageCode}`.trim())
    this.name = 'ObjectStoreError'
  }
}

export type ObjectStore = {
  put(key: string, body: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array>
  del(key: string): Promise<void>
}

const sha256Hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest()
// RFC 3986 unreserved characters stay; everything else is percent-encoded (path segments keep their "/").
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export type SignInput = {
  method: string; url: URL; headers: Record<string, string>; payloadHash: string
  accessKeyId: string; secretAccessKey: string; region: string; service: string; amzDate: string
}

/** The Authorization header for one request (AWS SigV4). `headers` must include host, x-amz-date and x-amz-content-sha256. */
export function signV4(i: SignInput): string {
  const names = Object.keys(i.headers).map((h) => h.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]))
  const query = [...i.url.searchParams].sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')
  const path = i.url.pathname.split('/').map((s) => enc(decodeURIComponent(s))).join('/')
  const canonical = [i.method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), i.payloadHash].join('\n')
  const day = i.amzDate.slice(0, 8)
  const scope = `${day}/${i.region}/${i.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256Hex(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), i.service), 'aws4_request')
  return `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256', key).update(toSign).digest('hex')}`
}

/** Path-style S3 API: B2 https://s3.<region>.backblazeb2.com (region e.g. us-west-004), R2 https://<account>.r2.cloudflarestorage.com (region auto). */
export function s3Store(env: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }): ObjectStore {
  const base = `${env.endpoint.replace(/\/+$/, '')}/${env.bucket}/`
  const call = async (method: string, key: string, body?: Uint8Array): Promise<Response> => {
    const url = new URL(base + key.split('/').map(enc).join('/'))
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const payloadHash = sha256Hex(body ?? '')
    const headers: Record<string, string> = { host: url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash }
    const authorization = signV4({ method, url, headers, payloadHash, accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey, region: env.region, service: 's3', amzDate })
    const res = await fetch(url, { method, headers: { ...headers, authorization }, body: body ? new Uint8Array(body) : undefined })
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      const text = (await res.text()).slice(0, 300)
      throw new ObjectStoreError(method, res.status, text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '')
    }
    return res
  }
  return {
    async put(key, body) { await call('PUT', key, body) },
    async get(key) { return new Uint8Array(await (await call('GET', key)).arrayBuffer()) },
    async del(key) { await call('DELETE', key) },
  }
}

let override: ObjectStore | null | undefined
/** Tests only: use this store (or none) instead of the S3_* environment. */
export function setObjectStoreForTests(s: ObjectStore | null | undefined) { override = s }

/** The configured object store, or null when files stay in Postgres. */
export function objectStore(): ObjectStore | null {
  if (override !== undefined) return override
  const { S3_ENDPOINT: endpoint, S3_REGION: region, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = process.env
  return endpoint && region && bucket && accessKeyId && secretAccessKey ? s3Store({ endpoint, region, bucket, accessKeyId, secretAccessKey }) : null
}
