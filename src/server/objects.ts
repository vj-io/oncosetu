// Encrypted originals in S3-compatible object storage (Cloudflare R2: 10 GB free) when R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY and R2_BUCKET are set; otherwise every file stays in Postgres (bytes_enc). Only ciphertext is sent:
// files are encrypted with a per-file key before upload, and that key lives only in the document_files row.
// A minimal AWS Signature Version 4 client (PUT, GET, DELETE of one object), so no SDK is added.
import { createHash, createHmac } from 'node:crypto'

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

export function r2Store(env: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }): ObjectStore {
  const base = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/`
  const call = async (method: string, key: string, body?: Uint8Array): Promise<Response> => {
    const url = new URL(base + key.split('/').map(enc).join('/'))
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const payloadHash = sha256Hex(body ?? '')
    const headers: Record<string, string> = { host: url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash }
    const authorization = signV4({ method, url, headers, payloadHash, accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey, region: 'auto', service: 's3', amzDate })
    const res = await fetch(url, { method, headers: { ...headers, authorization }, body: body ? new Uint8Array(body) : undefined })
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      const text = (await res.text()).slice(0, 300)
      throw new Error(`object storage ${method} failed: HTTP ${res.status} ${text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? ''}`.trim())
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
/** Tests only: use this store (or none) instead of the R2_* environment. */
export function setObjectStoreForTests(s: ObjectStore | null | undefined) { override = s }

/** The configured object store, or null when originals stay in Postgres. */
export function objectStore(): ObjectStore | null {
  if (override !== undefined) return override
  const { R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket } = process.env
  return accountId && accessKeyId && secretAccessKey && bucket ? r2Store({ accountId, accessKeyId, secretAccessKey, bucket }) : null
}
