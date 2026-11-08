/**
 * PRD §10.2: restore from an encrypted, off-database backup (scripts/backup.ts, GET /api/cron/backup) into a FRESH Neon
 * branch, prove the restored data, delete the branch. Never writes to main.
 *
 *   npx tsx --env-file=.env.local scripts/restore-from-backup.ts --blob <pathname|latest> [--keep-branch] [--build-dir DIR]
 *
 * 1. Download the backup from the private Blob store into a temp file (still encrypted).
 * 2. Verify the file: GCM tag (key by id: BACKUP_KEY or BACKUP_KEY_PREVIOUS), every table's row count and SHA-256 against
 *    the manifest inside it.
 * 3. `neonctl branches create --parent <backup time if it is still inside the history window, else main>`: a database with
 *    the schema, roles and grants the data belongs to.
 * 4. Load, owner role (RLS-forced tables and the append-only guards need it), ONE transaction: user triggers disabled,
 *    TRUNCATE every table, insert every table parents first, triggers enabled again, commit. The file authenticates
 *    (GCM tag) before the commit, or nothing is kept.
 * 5. Verify on the branch: per table, row count and the SHA-256 of a fresh export equal the manifest (every value came
 *    back byte for byte); audit chains recompute to the manifest heads; snapshot hashes + Ed25519 signatures; stored
 *    files and names decrypt with APP_MASTER_KEY and match their SHA-256; migrations on the branch equal the backup's,
 *    and the repo's drizzle/ files are compared with them (scripts/check-migrations.mts).
 * 5b. App smoke (V06-E2E-02, the same as the point-in-time drill: scripts/restore-smoke.ts): a production build of a copy of
 *    the repo runs `next start` against the restored branch only; Playwright signs in as the Ganga clinician, opens a sealed
 *    patient's ledger and the public /verify page, and the login must land as a session row on the branch.
 * 6. Delete the branch (always, `finally`; `--keep-branch` keeps it for a real cut-over, RUNBOOK §1 C), delete the temp file,
 *    write docs/releases/v1.0/BACKUP-RESTORE.md.
 *
 * Needs neonctl (authenticated), .env.local with DATABASE_URL_UNPOOLED, DATABASE_URL_APP, APP_MASTER_KEY, SIGNING_KEY_ED25519,
 * BACKUP_KEY, BLOB_READ_WRITE_TOKEN, and Chromium for Playwright.
 */
import { execFile, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { get } from '@vercel/blob'
import { and, asc, eq, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { auditLog } from '../src/db/schema'
import { GENESIS_HASH, verifyChainRows, type AuditRow } from '../src/server/audit'
import { listBackups, readBackup, verifyBackup, type Manifest } from '../src/server/backup/backup'
import { backupKeysFromEnv } from '../src/server/backup/envelope'
import { exportRows, listTables, rowLoader, type Table } from '../src/server/backup/jsonl'
import { decryptBytes, decryptField, sha256Hex, verifyEd25519 } from '../src/server/crypto'
import { runRestoreSmoke } from './restore-smoke'

const PROJECT = process.env.NEON_PROJECT_ID ?? 'mute-salad-65632065'
const REPORT = 'docs/releases/v1.0/BACKUP-RESTORE.md'
const exec = promisify(execFile)
const log = (m: string) => console.log(`[restore ${new Date().toISOString().slice(11, 19)}] ${m}`)
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, '$1***@')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`
const id = (n: string) => `"${n.replace(/"/g, '""')}"`

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = [], notes: string[] = [], timings: Record<string, number> = {}
function check(name: string, ok: boolean, detail: string) { checks.push({ name, ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  try { return await fn() } finally { timings[name] = Math.round(performance.now() - t0) }
}
const neonJson = async (...args: string[]) => JSON.parse((await exec('neonctl', [...args, '--project-id', PROJECT, '-o', 'json'], { maxBuffer: 16 << 20 })).stdout)
const connect = (url: string) => postgres(url, { max: 1, prepare: false, connect_timeout: 30, onnotice: () => {} })

// ── load (step 4) ────────────────────────────────────────────────────────────
async function load(sql: Sql, file: string, keys: ReturnType<typeof backupKeysFromEnv>) {
  return sql.begin(async (tx) => {
    const onBranch = new Map((await listTables(tx)).map((t) => [t.name, t]))
    const guarded = (await tx`select distinct c.relname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not g.tgisinternal`).map((r) => r.t as string)
    for (const t of guarded) await tx.unsafe(`alter table ${id(t)} disable trigger user`) // only inside this transaction
    await tx.unsafe(`truncate ${[...onBranch.keys()].map(id).join(', ')}`)
    const [{ n }] = await tx.unsafe(`select ${[...onBranch.keys()].map((t) => `(select count(*) from ${id(t)})`).join(' + ')} as n`)
    if (Number(n) !== 0) throw new Error(`TRUNCATE left ${n} rows`)

    const loaded: Record<string, number> = {}, partial = new Set<string>()
    let cur: { name: string; loader: ReturnType<typeof rowLoader> } | undefined
    for await (const it of readBackup(createReadStream(file), keys)) {
      if (it.kind === 'table') {
        if (cur) loaded[cur.name] = await cur.loader.end()
        const t = onBranch.get(it.name)
        if (!t) throw new Error(`table ${it.name} is in the backup but not on the branch`)
        const bad = it.columns.filter((c) => !t.columns.some((b) => b.name === c.name && b.type === c.type))
        if (bad.length) throw new Error(`${it.name}: columns ${bad.map((c) => `${c.name} ${c.type}`).join(', ')} do not exist on the branch with that type`)
        if (t.columns.length !== it.columns.length || t.columns.some((c, i) => c.name !== it.columns[i].name)) partial.add(it.name)
        cur = { name: it.name, loader: rowLoader(tx, 'public', { ...t, columns: it.columns }) }
      } else if (it.kind === 'row') {
        if (!cur) throw new Error('row before any table')
        await cur.loader.add(it.line.toString('utf8'))
      }
    }
    if (cur) loaded[cur.name] = await cur.loader.end()
    for (const t of guarded) await tx.unsafe(`alter table ${id(t)} enable trigger user`)
    return { loaded, guarded, partial, extra: [...onBranch.keys()].filter((t) => !(t in loaded)) }
  })
}

// ── verification on the branch (step 5) ──────────────────────────────────────
async function verifyTables(sql: Sql, m: Manifest, partial: Set<string>) {
  const tables = new Map((await listTables(sql)).map((t) => [t.name, t] as [string, Table]))
  const wrong: string[] = []
  let rows = 0
  await sql.begin('isolation level repeatable read read only', async (tx) => {
    await tx`set local timezone = 'UTC'`
    await tx`set local extra_float_digits = 1`
    for (const want of m.tables) {
      const t = tables.get(want.name)!
      const h = createHash('sha256')
      let n = 0
      for await (const line of exportRows(tx, 'public', t)) { h.update(line + '\n'); n++ }
      rows += n
      const sha = h.digest('hex')
      if (n !== want.rows) wrong.push(`${want.name}: ${n} rows, backup ${want.rows}`)
      else if (!partial.has(want.name) && sha !== want.sha256) wrong.push(`${want.name}: export hash ${sha.slice(0, 12)} ≠ ${want.sha256.slice(0, 12)}`)
    }
  })
  check('row count and re-export SHA-256 of every table equal the backup manifest', !wrong.length,
    wrong.length ? wrong.join('; ') : `${m.tables.length} tables, ${rows} rows; every table re-exports to the same bytes${partial.size ? ` (hash not comparable for ${[...partial].join(', ')}: extra columns on the branch)` : ''}`)
}

async function verifyAudit(sql: Sql, m: Manifest) {
  const orm = drizzle(sql)
  const out: string[] = []
  let ok = Object.keys(m.auditHeads).length > 0
  for (const [org, head] of Object.entries(m.auditHeads)) {
    let prev = { seq: 0, hash: GENESIS_HASH }, n = 0, broken: number | null = null
    for (;;) {
      const page = await orm.select().from(auditLog).where(and(eq(auditLog.orgId, org), gt(auditLog.seq, prev.seq))).orderBy(asc(auditLog.seq)).limit(1000)
      if (!page.length) break
      const r = verifyChainRows(page as AuditRow[], prev)
      if (!r.ok) { broken = r.brokenAt; break }
      prev = r.last
      n += page.length
    }
    const good = broken === null && n === head.rows && prev.seq === head.seq && prev.hash === head.hash
    ok &&= good
    out.push(`${org.slice(-4)}: ${n} rows to seq ${prev.seq}${good ? '' : broken !== null ? `, BROKEN at ${broken}` : `, manifest head seq ${head.seq}`}`)
  }
  check('audit chains recompute from genesis and end at the manifest head, per organisation', ok, out.join('; '))
}

async function verifySnapshotsAndFiles(sql: Sql) {
  const snaps = await sql`select canonical_json, sha256, signature, key_id from snapshots`
  const bad = snaps.filter((s) => sha256Hex(s.canonical_json as string) !== s.sha256 || !s.signature || !s.key_id
    || !verifyEd25519(Buffer.from(s.canonical_json as string, 'utf8'), s.signature as string, s.key_id as string)).length
  check('every snapshot hash recomputes and its Ed25519 signature verifies with the app key', snaps.length > 0 && bad === 0, `${snaps.length} snapshots, ${bad} invalid`)

  let names = 0, tombstones = 0
  for (const r of await sql`select name_enc from patients`) { if (!r.name_enc) { tombstones++; continue } decryptField(r.name_enc as string); names++ }
  let files = 0, bytes = 0, last = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const page = await sql`select id, bytes_enc, dek_wrapped, sha256 from document_files where id > ${last} order by id limit 40`
    if (!page.length) break
    for (const f of page) {
      const plain = decryptBytes(Buffer.from(f.bytes_enc as Buffer), f.dek_wrapped as string)
      if (sha256Hex(plain) !== f.sha256) throw new Error(`stored file ${f.id} does not match its recorded SHA-256`)
      files++; bytes += plain.length
    }
    last = page[page.length - 1].id as string
  }
  check('stored files and patient names decrypt with APP_MASTER_KEY; each file matches its SHA-256', names > 0 && files > 0,
    `${names} names (${tombstones} erased tombstones), ${files} files (${mb(bytes)})`)
}

async function verifyMigrations(sql: Sql, m: Manifest) {
  const rows = await sql`select hash, created_at::text as c from drizzle.__drizzle_migrations order by created_at`
  const same = rows.length === m.migrations.length && rows.every((r, i) => r.hash === m.migrations[i].hash && r.c === m.migrations[i].createdAt)
  check('migrations on the branch equal the backup\'s (hash + journal time, in order)', same, `${rows.length} on the branch, ${m.migrations.length} in the backup`)
  // scripts/check-migrations.mts, against the branch: the repo's drizzle/ files vs what is applied.
  const journal = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; when: number }[] }).entries
  const res = journal.map((e) => {
    const r = rows.find((x) => x.c === String(e.when))
    return { tag: e.tag, s: !r ? 'not-applied' : r.hash === sha256Hex(readFileSync(`drizzle/${e.tag}.sql`, 'utf8')) ? 'match' : 'DIFF' }
  })
  const by = (s: string) => res.filter((r) => r.s === s).map((r) => r.tag)
  notes.push(`Repo drizzle/ files against the branch (scripts/check-migrations.mts): ${by('match').length} match` +
    (by('DIFF').length ? `; DIFF ${by('DIFF').join(', ')} (file edited after it was applied; the backup carries the applied hash, so the restore is unaffected)` : '') +
    (by('not-applied').length ? `; in the repo but not in this backup: ${by('not-applied').join(', ')} (newer than the backup)` : '') + '.')
}

// ── report ───────────────────────────────────────────────────────────────────
type Info = { startedAt: Date; blob?: { pathname: string; size: number; uploadedAt: string }; m?: Manifest; branch?: string; parent?: string; window?: number; loaded?: number }
function writeReport(i: Info) {
  const ok = checks.length > 0 && checks.every((c) => c.ok)
  const s = (k: string) => (timings[k] === undefined ? 'n/a' : `${(timings[k] / 1000).toFixed(1)} s`)
  const rows = i.m ? i.m.tables.reduce((a, t) => a + t.rows, 0) : 0
  const md = `# Restore from an encrypted backup (PRD §10.2)

**Result: ${ok ? 'PASS' : 'FAIL'}** · ${i.startedAt.toISOString().slice(0, 10)} · \`npx tsx --env-file=.env.local scripts/restore-from-backup.ts --blob ${i.blob?.pathname ?? '<pathname|latest>'}\`

A daily logical backup (encrypted, in a private Vercel Blob store, off the database) restored into a fresh Neon branch, checked, and the branch deleted. This file is rewritten by every run. The point-in-time drill is \`RESTORE-DRILL.md\`.

## Backup

| | |
|---|---|
| Backup id | \`${i.blob?.pathname ?? 'not reached'}\` |
| Stored | ${i.blob ? `private Blob store \`oncosetu-backups\` (bom1), uploaded ${i.blob.uploadedAt}, ${mb(i.blob.size)} encrypted` : 'n/a'} |
| Snapshot time | ${i.m?.createdAt ?? 'n/a'} (one REPEATABLE READ transaction over every table) |
| Content | ${i.m ? `${i.m.tables.length} tables, ${rows} rows, ${mb(i.m.plainBytes)} JSONL before gzip; ${Object.keys(i.m.auditHeads).length} audit chains; ${i.m.migrations.length} migrations` : 'n/a'} |
| Export time when taken | ${i.m ? `${(i.m.exportMs / 1000).toFixed(1)} s (export streamed into gzip, encryption and upload)` : 'n/a'} |
| Envelope | AES-256-GCM, key \`BACKUP_KEY\` (id in the file header); PII columns and files inside are still APP_MASTER_KEY ciphertext |

## Restore target

| | |
|---|---|
| Neon project | \`${PROJECT}\` |
| Branch | \`${i.branch ?? 'not created'}\`, parent \`${i.parent ?? 'n/a'}\` (history window ${i.window ? `${i.window / 3600} h` : 'unknown'}) |
| Branch afterwards | ${checks.find((c) => c.name.startsWith('restore branch deleted'))?.ok ? 'deleted' : 'NOT deleted (kept, or the delete failed): check `neonctl branches list`'} |

## Timings

| Step | Time |
|---|---|
| Download from Blob | ${s('download')} |
| Verify file (decrypt, gunzip, hash every table) | ${s('verifyFile')} |
| Branch create + compute ready | ${s('branch')} |
| Load (TRUNCATE + insert ${i.loaded ?? '?'} rows, one transaction) | ${s('load')} |
| Verification on the branch | ${s('verification')} |
| App smoke: production build of the repo copy | ${s('build')} |
| App smoke: server start + sign-in + ledger + /verify | ${timings.smoke === undefined ? 'n/a' : `${((timings.smoke - (timings.build ?? 0)) / 1000).toFixed(1)} s`} |
| Branch delete | ${s('branchDelete')} |
| **Total** | ${s('total')} |

Timings are from a laptop to Vercel Blob (Mumbai) and Neon (Singapore); download, load and the re-export are bandwidth- and round-trip-bound.

## Checks

| | Check | Detail |
|---|---|---|
${checks.map((c) => `| ${c.ok ? 'PASS' : '**FAIL**'} | ${c.name} | ${c.detail.replace(/\|/g, '/').replace(/\n/g, ' ')} |`).join('\n')}
${notes.length ? `\n## Notes\n\n${notes.map((n) => `- ${n}`).join('\n')}\n` : ''}
## Limits

- The restore lands on a branch that already has the schema (a copy of \`main\`, at the backup time while that is inside the history window). Restoring after losing the whole Neon project needs a new database with \`drizzle/\` migrations applied up to the backup's list first (roles and grants come from \`0001_rls_roles.sql\`); that path is not exercised here.
- Backups are daily: up to 24 h of writes can be lost once the 6 h point-in-time window has passed.
- A backup is readable only with \`BACKUP_KEY\` (envelope) **and** \`APP_MASTER_KEY\` (PII and files inside). Losing either makes it useless.
`
  mkdirSync('docs/releases/v1.0', { recursive: true })
  writeFileSync(REPORT, md)
  log(`wrote ${REPORT}`)
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date(), t0 = performance.now()
  const arg = process.argv[process.argv.indexOf('--blob') + 1]
  if (!process.argv.includes('--blob') || !arg) throw new Error('usage: restore-from-backup.ts --blob <pathname|latest>')
  for (const k of ['DATABASE_URL_UNPOOLED', 'APP_MASTER_KEY', 'SIGNING_KEY_ED25519', 'BACKUP_KEY', 'BLOB_READ_WRITE_TOKEN']) if (!process.env[k]) throw new Error(`${k} is not set (run with --env-file=.env.local)`)
  await exec('neonctl', ['--version']).catch(() => { throw new Error('neonctl is not installed or not on PATH') })
  const keys = backupKeysFromEnv()
  const owner = new URL(process.env.DATABASE_URL_UNPOOLED!)
  const role = decodeURIComponent(owner.username), database = owner.pathname.slice(1)
  const name = `backup-restore-${startedAt.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`
  const file = join(tmpdir(), `${name}.bak`)
  const info: Info = { startedAt }
  let branchStarted = false
  const keep = process.argv.includes('--keep-branch')

  const argAt = process.argv.indexOf('--build-dir')
  const buildDir = argAt > 0 ? process.argv[argAt + 1] : join(tmpdir(), 'oncosetu-restore-drill-build')
  if (!process.env.DATABASE_URL_APP) throw new Error('DATABASE_URL_APP is not set (the app smoke signs in through the app role)')
  let server: ChildProcess | undefined
  const cleanup = async () => {
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise((r) => { server!.once('exit', r); setTimeout(r, 10_000) }); server.kill('SIGKILL') }
    rmSync(file, { force: true })
    if (!branchStarted) return
    branchStarted = false
    if (keep) { notes.push(`Branch \`${name}\` was KEPT (--keep-branch): delete it with \`neonctl branches delete ${name} --project-id ${PROJECT}\` when done.`); return }
    await timed('branchDelete', async () => {
      try {
        const all = (await neonJson('branches', 'list')) as { id: string; name: string; default: boolean }[]
        const mine = all.find((b) => b.name === name)
        if (mine && (mine.default || !mine.name.startsWith('backup-restore-'))) throw new Error('refusing to delete a branch that is not this restore\'s')
        if (mine) await neonJson('branches', 'delete', mine.id)
        const left = ((await neonJson('branches', 'list')) as { name: string }[]).filter((b) => b.name === name)
        check(`restore branch deleted (${name})`, !left.length, left.length ? 'still listed' : 'no longer listed')
      } catch (e) { check(`restore branch deleted (${name})`, false, msg(e)) }
    })
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void cleanup().finally(() => process.exit(130)) })

  try {
    // 1. download
    const target = arg === 'latest' ? (await listBackups())[0] : { pathname: arg }
    if (!target) throw new Error('no backups in the store')
    await timed('download', async () => {
      const r = await get(target.pathname, { access: 'private', useCache: false })
      if (!r?.stream) throw new Error(`backup ${target.pathname} not found`)
      await pipeline(Readable.fromWeb(r.stream as WebReadableStream), createWriteStream(file, { mode: 0o600 }))
      info.blob = { pathname: r.blob.pathname, size: statSync(file).size, uploadedAt: r.blob.uploadedAt.toISOString() }
    })
    log(`downloaded ${info.blob!.pathname} (${mb(info.blob!.size)})`)

    // 2. verify the file before anything else
    const { manifest: m, problems } = await timed('verifyFile', () => verifyBackup(createReadStream(file), keys))
    info.m = m
    check('backup authenticates (AES-256-GCM tag, key id in the header) and every table matches its manifest row count and SHA-256',
      !problems.length, problems.length ? problems.join('; ') : `key ${keys[0].id}; ${m.tables.length} tables, ${m.tables.reduce((a, t) => a + t.rows, 0)} rows, snapshot ${m.createdAt}`)
    if (problems.length) throw new Error('the backup file does not match its manifest')

    // 3. branch with the backup's schema
    info.window = JSON.parse((await exec('neonctl', ['projects', 'get', PROJECT, '-o', 'json'])).stdout).history_retention_seconds as number
    const inWindow = Date.now() - Date.parse(m.createdAt) < ((info.window ?? 0) - 600) * 1000
    info.parent = inWindow ? m.createdAt : 'main'
    if (!inWindow) notes.push('The backup is older than the point-in-time window, so the branch is a copy of main now (its schema may be newer).')
    branchStarted = true
    info.branch = name
    let pooledHost = ''
    const direct = await timed('branch', async () => {
      const created: { endpoints: { hosts: { read_write_pooled_host: string } }[] } = await neonJson('branches', 'create', '--name', name, '--parent', info.parent!)
      pooledHost = created.endpoints[0].hosts.read_write_pooled_host
      const url = (await exec('neonctl', ['connection-string', name, '--role-name', role, '--database-name', database, '--project-id', PROJECT])).stdout.trim()
      if (new URL(url).host === owner.host) throw new Error('the branch resolved to the main endpoint: refusing to continue')
      for (const end = Date.now() + 180_000; ;) {
        const c = connect(url)
        try { await c`select 1`; return url } catch (e) { if (Date.now() > end) throw e; await sleep(3000) } finally { await c.end({ timeout: 2 }).catch(() => {}) }
      }
    })
    log(`branch ${name} from ${info.parent} is up`)

    // 4. load, 5. verify
    const sql = connect(direct)
    try {
      const r = await timed('load', () => load(sql, file, keys))
      info.loaded = Object.values(r.loaded).reduce((a, b) => a + b, 0)
      check('restore transaction committed: every table truncated, then loaded from the backup with its append-only guards disabled only inside the transaction',
        m.tables.every((t) => r.loaded[t.name] === t.rows),
        `${Object.keys(r.loaded).length} tables, ${info.loaded} rows; triggers disabled and re-enabled on ${r.guarded.join(', ')}${r.extra.length ? `; left empty (not in the backup): ${r.extra.join(', ')}` : ''}`)
      const [{ n }] = await sql`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D'`
      check('no trigger left disabled after the commit', n === 0, `${n} disabled`)
      await timed('verification', async () => {
        await verifyTables(sql, m, r.partial)
        await verifyAudit(sql, m)
        await verifySnapshotsAndFiles(sql)
        await verifyMigrations(sql, m)
      })
      // 5b. the app on the restored branch only (the app role exists there: the branch is a copy of main's roles)
      const pooled = new URL(direct); pooled.host = pooledHost
      const app = new URL(process.env.DATABASE_URL_APP!); app.host = pooledHost
      await timed('smoke', async () => {
        const r = await runRestoreSmoke({ buildDir, urls: { pooled: pooled.toString(), direct, app: app.toString() }, sql, check, log, onServer: (p) => { server = p } })
        timings.build = r.buildMs
      })
    } finally { await sql.end({ timeout: 5 }) }
  } catch (e) {
    check('restore ran to completion', false, msg(e))
  } finally {
    await cleanup()
    timings.total = Math.round(performance.now() - t0)
    writeReport(info)
  }
  const ok = checks.every((c) => c.ok)
  log(ok ? `PASS: ${checks.length} checks in ${(timings.total / 1000).toFixed(0)} s` : `FAIL: ${checks.filter((c) => !c.ok).map((c) => c.name).join('; ')}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(msg(e)); process.exit(1) })
