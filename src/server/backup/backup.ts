// Daily logical backup, stored OFF the database (Vercel Blob, private store) — PRD §10.2 "backups encrypted".
// Neon's free plan keeps 6 h of point-in-time history; these files keep BACKUP_RETENTION_DAYS (default 35).
//
// Why the owner role (DATABASE_URL_UNPOOLED): a backup must read every row of every organisation plus
// drizzle.__drizzle_migrations. The app role `oncosetu_app` sees one organisation at a time under forced RLS and has no
// grant on the drizzle schema, so it cannot make a complete backup. The owner connection here is read-only (a
// REPEATABLE READ READ ONLY transaction: one consistent snapshot of all tables), its own single connection, closed after.
// It never borrows from the app pools (POOL RULE, src/db/index.ts).
//
// File = envelope(gzip(plaintext)), envelope in ./envelope.ts. Plaintext, one item per line:
//   #table {"name","columns":[{name,type}]}   then that table's rows, one JSON object per line (./jsonl.ts)
//   … every table, parents before children …
//   #manifest {…}                              last line; Manifest below
// Per-table sha256 = SHA-256 of that table's row lines, each followed by "\n". Field-level encrypted PII and the
// encrypted files stay encrypted inside (APP_MASTER_KEY ciphertext), so reading a backup needs BOTH keys.
import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { del, list, put } from '@vercel/blob'
import postgres, { type Sql } from 'postgres'
import { decrypt, encrypt, backupKeysFromEnv, type BackupKey } from './envelope'
import { exportRows, listTables, type Column } from './jsonl'

export type Manifest = {
  format: 'oncosetu-backup'
  version: 1
  /** Moment of the snapshot (database clock): every row is as of this instant. */
  createdAt: string
  database: { host: string; name: string; serverVersion: string }
  migrations: { hash: string; createdAt: string }[]
  tables: { name: string; rows: number; sha256: string }[]
  auditHeads: Record<string, { seq: number; hash: string; rows: number }>
  plainBytes: number
  exportMs: number
}

export type BackupItem = { kind: 'table'; name: string; columns: Column[] } | { kind: 'row'; line: Buffer } | { kind: 'manifest'; manifest: Manifest }

const NL = Buffer.from('\n')

/** The plaintext stream of a complete, consistent backup of `public`. */
export async function* backupPlaintext(sql: Sql, host: string, out: { manifest?: Manifest } = {}): AsyncGenerator<Buffer> {
  const t0 = performance.now()
  const c = await sql.reserve()
  let open = false
  try {
    await c`begin isolation level repeatable read read only`
    open = true
    await c`set local timezone = 'UTC'`
    await c`set local extra_float_digits = 1`
    const [s] = await c`select clock_timestamp() as at, current_database() as db, current_setting('server_version') as v` // takes the snapshot
    const migrations = await c`select hash, created_at::text as "createdAt" from drizzle.__drizzle_migrations order by created_at`
    const heads = await c`select distinct on (a.org_id) a.org_id::text as org, a.seq::int as seq, a.hash,
      (select count(*)::int from audit_log b where b.org_id = a.org_id) as rows from audit_log a order by a.org_id, a.seq desc`
    const tables: Manifest['tables'] = []
    let plainBytes = 0
    for (const t of await listTables(c)) {
      const head = Buffer.from(`#table ${JSON.stringify({ name: t.name, columns: t.columns })}\n`)
      plainBytes += head.length
      yield head
      const h = createHash('sha256')
      let rows = 0
      for await (const line of exportRows(c, 'public', t)) {
        const b = Buffer.from(line + '\n')
        h.update(b)
        rows++
        plainBytes += b.length
        yield b
      }
      tables.push({ name: t.name, rows, sha256: h.digest('hex') })
    }
    await c`commit`
    open = false
    const manifest: Manifest = {
      format: 'oncosetu-backup', version: 1, createdAt: (s.at as Date).toISOString(),
      database: { host, name: s.db as string, serverVersion: s.v as string },
      migrations: migrations.map((m) => ({ hash: m.hash as string, createdAt: m.createdAt as string })),
      tables,
      auditHeads: Object.fromEntries(heads.map((r) => [r.org as string, { seq: r.seq as number, hash: r.hash as string, rows: r.rows as number }])),
      plainBytes, exportMs: Math.round(performance.now() - t0),
    }
    out.manifest = manifest
    yield Buffer.from(`#manifest ${JSON.stringify(manifest)}\n`)
  } finally {
    if (open) await c`rollback`.catch(() => {})
    c.release()
  }
}

async function* splitLines(src: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let parts: Buffer[] = []
  for await (const chunk of src) {
    let start = 0
    for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, start)) {
      parts.push(chunk.subarray(start, i))
      yield parts.length === 1 ? parts[0] : Buffer.concat(parts)
      parts = []
      start = i + 1
    }
    if (start < chunk.length) parts.push(chunk.subarray(start))
  }
  if (parts.length) yield Buffer.concat(parts)
}

/** Decrypts and parses a backup file. The GCM tag is checked when the stream ends: act on nothing before that. */
export async function* readBackup(file: AsyncIterable<Buffer>, keys: BackupKey[]): AsyncGenerator<BackupItem> {
  const plain = new PassThrough()
  pipeline(file, (src: AsyncIterable<Buffer>) => decrypt(src, keys), createGunzip(), plain).catch(() => {}) // the error ends `plain`
  for await (const line of splitLines(plain)) {
    if (line[0] === 0x7b) yield { kind: 'row', line } // '{'
    else if (line.subarray(0, 7).toString() === '#table ') yield { kind: 'table', ...JSON.parse(line.subarray(7).toString()) }
    else if (line.subarray(0, 10).toString() === '#manifest ') yield { kind: 'manifest', manifest: JSON.parse(line.subarray(10).toString()) }
    else throw new Error('backup contains an unexpected line')
  }
}

/** Reads a whole backup: authenticity (GCM tag), then every table's row count and SHA-256 against the manifest. */
export async function verifyBackup(file: AsyncIterable<Buffer>, keys: BackupKey[]): Promise<{ manifest: Manifest; problems: string[] }> {
  const seen = new Map<string, { rows: number; h: ReturnType<typeof createHash> }>()
  let cur: { rows: number; h: ReturnType<typeof createHash> } | undefined, manifest: Manifest | undefined
  for await (const it of readBackup(file, keys)) {
    if (manifest) throw new Error('backup has data after its manifest')
    if (it.kind === 'table') seen.set(it.name, (cur = { rows: 0, h: createHash('sha256') }))
    else if (it.kind === 'row') { if (!cur) throw new Error('backup has rows before any table'); cur.rows++; cur.h.update(it.line).update(NL) }
    else manifest = it.manifest
  }
  if (!manifest) throw new Error('backup has no manifest (truncated)')
  if (manifest.format !== 'oncosetu-backup' || manifest.version !== 1) throw new Error('unknown backup format')
  const problems: string[] = []
  const got = new Map([...seen].map(([n, v]) => [n, { rows: v.rows, sha256: v.h.digest('hex') }]))
  for (const t of manifest.tables) {
    const g = got.get(t.name)
    if (!g) problems.push(`${t.name}: in the manifest, not in the file`)
    else if (g.rows !== t.rows || g.sha256 !== t.sha256) problems.push(`${t.name}: ${g.rows} rows / ${g.sha256.slice(0, 12)} in the file, manifest says ${t.rows} / ${t.sha256.slice(0, 12)}`)
    got.delete(t.name)
  }
  for (const n of got.keys()) problems.push(`${n}: in the file, not in the manifest`)
  return { manifest, problems }
}

// ── storage + retention ──────────────────────────────────────────────────────
export const BACKUP_PREFIX = 'backups/'
const BACKUP_PATH = /^backups\/\d{4}\/\d{2}\/\d{2}\/oncosetu-\d{8}T\d{6}Z\.bak$/

/** backups/YYYY/MM/DD/oncosetu-YYYYMMDDTHHMMSSZ.bak (UTC) */
export function backupPathname(at: Date): string {
  const iso = at.toISOString()
  return `${BACKUP_PREFIX}${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/oncosetu-${iso.slice(0, 19).replace(/[-:]/g, '')}Z.bak`
}

/** Pure: the backups to delete. The `keep` newest always stay, whatever their age; of the rest, those older than `days` go.
 *  Anything in the store that is not named like a backup is never selected. */
export function expiredBackups<T extends { pathname: string; uploadedAt: Date }>(blobs: T[], now: Date, days: number, keep = 7): T[] {
  const cutoff = now.getTime() - days * 86_400_000
  return blobs.filter((b) => BACKUP_PATH.test(b.pathname))
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .slice(keep)
    .filter((b) => b.uploadedAt.getTime() < cutoff)
}

export function retentionDays(): number {
  const raw = process.env.BACKUP_RETENTION_DAYS
  const d = raw ? Number(raw) : 35
  if (!Number.isInteger(d) || d < 1) throw new Error('BACKUP_RETENTION_DAYS must be a whole number of days ≥ 1')
  return d
}

export async function listBackups() {
  const all: Awaited<ReturnType<typeof list>>['blobs'] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 })
    all.push(...page.blobs)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return all.filter((b) => BACKUP_PATH.test(b.pathname)).sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
}

export type BackupResult = {
  id: string; bytes: number; plainBytes: number; tables: number; rows: number; createdAt: string
  ms: { export: number; total: number }; deleted: string[]; kept: number
}

/** Take a backup, upload it, then (only after a successful upload) delete expired ones. Ids and sizes only in the result. */
export async function runBackup(now = new Date()): Promise<BackupResult> {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set')
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is not set')
  const days = retentionDays()
  const [key] = backupKeysFromEnv()
  const t0 = performance.now()
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 30, onnotice: () => {} })
  const out: { manifest?: Manifest } = {}
  let bytes = 0
  try {
    async function* count(src: AsyncIterable<Buffer>) { for await (const b of src) { bytes += b.length; yield b } }
    const body = new PassThrough()
    const [blob] = await Promise.all([
      put(backupPathname(now), body, { access: 'private', contentType: 'application/octet-stream', multipart: true, addRandomSuffix: false })
        .catch((e) => { body.destroy(e); throw e }),
      pipeline(backupPlaintext(sql, new URL(url).hostname, out), createGzip({ level: 6 }), (src: AsyncIterable<Buffer>) => encrypt(src, key), count, body),
    ])
    const manifest = out.manifest
    if (!manifest) throw new Error('backup stream ended without a manifest')
    const all = await listBackups()
    const expired = expiredBackups(all, now, days)
    if (expired.length) await del(expired.map((b) => b.url))
    return {
      id: blob.pathname, bytes, plainBytes: manifest.plainBytes, tables: manifest.tables.length,
      rows: manifest.tables.reduce((a, t) => a + t.rows, 0), createdAt: manifest.createdAt,
      ms: { export: manifest.exportMs, total: Math.round(performance.now() - t0) },
      deleted: expired.map((b) => b.pathname), kept: all.length - expired.length,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
