/**
 * V06-E2E-02 / PRD §10.2: backup and restore drill. Restores the database to a point in time into a FRESH Neon branch (its own
 * compute), proves the restored data is intact, runs the app against it, and deletes the branch (always, in a `finally`).
 *
 *   npx tsx --env-file=.env.local scripts/restore-drill.ts [--build-dir DIR]
 *
 * a. Reference from main: row count per table, audit-chain head per organisation, every snapshot's SHA-256 and signature verdict.
 *    The restore point is a timestamp taken between two identical reads, so the reference is exact for it.
 * b. `neonctl branches create --parent <restore point>`: point-in-time restore into a new branch, then wait for its compute.
 * c. On the branch: migrations applied, RLS forced, counts and audit heads equal the reference, audit chains recomputed,
 *    snapshots re-hashed and signature-checked with the app's key, stored files and PII decrypt with APP_MASTER_KEY.
 * d. Smoke: `next start` from a production build (a copy of this repo, so the dev server is left alone) on the branch, then
 *    Playwright: sign in as the Ganga clinician, open a patient's ledger, open the public /verify page of a snapshot.
 * e. Delete the branch.  f. Write docs/releases/v1.0/RESTORE-DRILL.md.
 *
 * Needs `neonctl` (authenticated), `.env.local` and Chromium for Playwright. Never writes to main. Run it while nothing writes to
 * main (no test run, no users): the reference needs ~10 s of quiet and the drill retries a few times before giving up.
 */
import { execFile, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual, promisify } from 'node:util'
import { and, asc, eq, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { RLS_TABLES, auditLog } from '../src/db/schema'
import { verifyChainRows, GENESIS_HASH, type AuditRow } from '../src/server/audit'
import { decryptBytes, decryptField, publicKeys, sha256Hex, verifyEd25519 } from '../src/server/crypto'
import { ORG_GANGA_ID } from '../src/server/demo'
import { runRestoreSmoke } from './restore-smoke'

const PROJECT = process.env.NEON_PROJECT_ID ?? 'icy-cloud-44319946'
const NEON_ORG = process.env.NEON_ORG_ID ?? 'org-shiny-star-64825025'
/** Tables that hold no patient data and have no RLS by design: login and tenancy plumbing (drizzle/0001_rls_roles.sql). */
const NO_RLS_BY_DESIGN = ['organisations', 'org_settings', 'otp_challenges', 'sessions', 'staff']
const REPORT = 'docs/releases/v1.0/RESTORE-DRILL.md'

const exec = promisify(execFile)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (m: string) => console.log(`[drill ${new Date().toISOString().slice(11, 19)}] ${m}`)
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, '$1***@')

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const timings: Record<string, number> = {}
const notes: string[] = []
function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail })
  log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`)
}
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  try { return await fn() } finally { timings[name] = Math.round(performance.now() - t0) }
}

const neonJson = async (...args: string[]) => JSON.parse((await exec('neonctl', [...args, '--project-id', PROJECT, '-o', 'json'], { maxBuffer: 16 << 20 })).stdout)
const neonText = async (...args: string[]) => (await exec('neonctl', [...args, '--project-id', PROJECT], { maxBuffer: 16 << 20 })).stdout.trim()
const connect = (url: string) => postgres(url, { max: 1, prepare: false, connect_timeout: 30, onnotice: () => {} })

// ── a. reference ─────────────────────────────────────────────────────────────
type Reference = {
  tables: Record<string, number>
  audit: Record<string, { rows: number; seq: number; hash: string }>
  snapshots: Record<string, { sha256: string; signature: string | null; keyId: string | null; hashMatches: boolean; signatureValid: boolean }>
}

/** One consistent read (repeatable read): counts, chain heads and snapshot verdicts. */
async function reference(sql: Sql): Promise<Reference> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const counts = await tx`select table_name as t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int as n
      from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`
    const heads = await tx`select distinct on (a.org_id) a.org_id, a.seq::int as seq, a.hash, (select count(*)::int from audit_log b where b.org_id = a.org_id) as rows
      from audit_log a order by a.org_id, a.seq desc`
    const snaps = await tx`select id, canonical_json, sha256, signature, key_id from snapshots order by id`
    return {
      tables: Object.fromEntries(counts.map((r) => [r.t as string, r.n as number])),
      audit: Object.fromEntries(heads.map((r) => [r.org_id as string, { rows: r.rows as number, seq: r.seq as number, hash: r.hash as string }])),
      snapshots: Object.fromEntries(snaps.map((r) => {
        const signature = (r.signature as string | null) ?? null, keyId = (r.key_id as string | null) ?? null
        const json = r.canonical_json as string
        return [r.id as string, {
          sha256: r.sha256 as string, signature, keyId, hashMatches: sha256Hex(json) === r.sha256,
          signatureValid: !!signature && !!keyId && verifyEd25519(Buffer.from(json, 'utf8'), signature, keyId),
        }]
      })),
    }
  })
}

/** The restore point must be a moment at which main provably did not change: two reads, the timestamp between them, equal. */
async function takeRestorePoint(main: Sql): Promise<{ at: Date; ref: Reference; attempts: number }> {
  for (let attempts = 1; attempts <= 6; attempts++) {
    const before = await reference(main)
    const [{ now }] = await main`select clock_timestamp() as now`
    const after = await reference(main)
    if (isDeepStrictEqual(before, after)) return { at: now as Date, ref: before, attempts }
    log(`main changed while the reference was taken (attempt ${attempts}); waiting 5 s for it to go quiet`)
    await sleep(5000)
  }
  throw new Error('main kept changing: run the drill while no tests or users are writing')
}

const diffKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !isDeepStrictEqual(a[k], b[k]))

// ── c. verification on the restored branch ───────────────────────────────────
async function verifyMigrations(sql: Sql) {
  const journal = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; when: number }[] }).entries
  const files = readdirSync('drizzle').filter((f) => f.endsWith('.sql'))
  const rows = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`
  // drizzle's migrator decides what is applied by the journal timestamp (created_at); the hash is the SQL text it ran.
  const applied = new Set(rows.map((r) => String(r.created_at)))
  const missing = journal.filter((j) => !applied.has(String(j.when))).map((j) => j.tag)
  const extra = rows.filter((r) => !journal.some((j) => String(j.when) === String(r.created_at))).length
  check('migrations: every file in drizzle/ is applied', !missing.length && !extra && files.length === journal.length,
    missing.length ? `not applied: ${missing.join(', ')}` : `${rows.length} applied, ${journal.length} in the journal, ${files.length} .sql files; last ${journal.at(-1)?.tag}`)
  const edited = journal.filter((j) => rows.some((r) => String(r.created_at) === String(j.when) && r.hash !== sha256Hex(readFileSync(`drizzle/${j.tag}.sql`, 'utf8')))).map((j) => j.tag)
  if (edited.length) notes.push(`Migration file(s) ${edited.join(', ')} differ from the text recorded when they were applied on main (edited after applying; drizzle does not re-run an applied migration). The restored database matches main, so the drill is unaffected, but a fresh database built from drizzle/ would not be identical to production.`)
}

async function verifyRls(sql: Sql, appUrl: string) {
  const rows = await sql`select c.relname as t, c.relrowsecurity as r, c.relforcerowsecurity as f, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as pol
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`
  const by = new Map(rows.map((r) => [r.t as string, r]))
  const weak = (RLS_TABLES as readonly string[]).filter((t) => { const r = by.get(t); return !r || !r.r || !r.f || (r.pol as number) < 1 })
  const unlisted = rows.map((r) => r.t as string).filter((t) => !(RLS_TABLES as readonly string[]).includes(t) && !NO_RLS_BY_DESIGN.includes(t))
  check('RLS enabled, forced and with a policy on every patient table', !weak.length && !unlisted.length,
    weak.length || unlisted.length ? `missing: ${[...weak, ...unlisted.map((t) => `${t} (not covered)`)].join(', ')}` : `${RLS_TABLES.length} tables; the other ${NO_RLS_BY_DESIGN.length} (${NO_RLS_BY_DESIGN.join(', ')}) hold no patient data`)

  const [role] = await sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'oncosetu_app'`
  const [trg] = await sql`select count(*)::int as n from pg_trigger where tgname in ('audit_log_append_only', 'audit_log_no_truncate', 'snapshots_append_only', 'snapshots_no_truncate')`
  check('app role is not a superuser and does not bypass RLS; append-only triggers exist', !!role && !role.rolsuper && !role.rolbypassrls && trg.n === 4,
    `oncosetu_app super=${role?.rolsuper} bypassrls=${role?.rolbypassrls}; ${trg.n}/4 append-only triggers`)

  // The same thing, exercised: connect as the app role and look at patients with and without an organisation set.
  const [{ n: gangaPatients }] = await sql`select count(*)::int as n from patients where org_id = ${ORG_GANGA_ID}`
  const app = connect(appUrl)
  try {
    const [{ n: unset }] = await app`select count(*)::int as n from patients`
    const [{ n: scoped }] = await app.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ORG_GANGA_ID}, true)`
      return tx`select count(*)::int as n from patients`
    })
    const denied = await app`delete from audit_log`.then(() => 'allowed', (e: { code?: string }) => e.code ?? 'error')
    check('app role on the restored database: RLS filters rows, audit_log cannot be deleted from',
      unset === 0 && scoped === gangaPatients && denied === '42501',
      `no organisation set: ${unset} patients; Ganga set: ${scoped} of ${gangaPatients}; DELETE on audit_log: ${denied === '42501' ? 'permission denied' : denied}`)
  } finally { await app.end({ timeout: 5 }) }
}

async function verifyAudit(sql: Sql, ref: Reference) {
  const orm = drizzle(sql)
  const orgs = Object.keys(ref.audit)
  const summary: string[] = []
  let allOk = true
  for (const org of orgs) {
    let prev = { seq: 0, hash: GENESIS_HASH }, checked = 0, broken: number | null = null
    for (;;) {
      const page = await orm.select().from(auditLog).where(and(eq(auditLog.orgId, org), gt(auditLog.seq, prev.seq))).orderBy(asc(auditLog.seq)).limit(1000)
      if (!page.length) break
      const res = verifyChainRows(page as AuditRow[], prev)
      if (!res.ok) { broken = res.brokenAt; break }
      prev = res.last
      checked += page.length
    }
    const head = ref.audit[org]
    const ok = broken === null && checked === head.rows && prev.seq === head.seq && prev.hash === head.hash
    allOk &&= ok
    summary.push(`${org.slice(-1) === '1' ? 'Narmada' : org.slice(-1) === '2' ? 'Ganga' : org}: ${checked} rows, head seq ${prev.seq}${ok ? '' : broken !== null ? `, BROKEN at ${broken}` : ', head differs from the reference'}`)
  }
  check('audit chains recompute and end at the reference head, per organisation', allOk && orgs.length > 0, summary.join('; '))
}

async function verifyKeysAndData(sql: Sql, ref: Reference) {
  const snaps = await sql`select id, canonical_json, sha256, signature, key_id from snapshots order by id`
  const got: Reference['snapshots'] = {}
  for (const r of snaps) {
    const signature = (r.signature as string | null) ?? null, keyId = (r.key_id as string | null) ?? null
    got[r.id as string] = { sha256: r.sha256 as string, signature, keyId, hashMatches: sha256Hex(r.canonical_json as string) === r.sha256,
      signatureValid: !!signature && !!keyId && verifyEd25519(Buffer.from(r.canonical_json as string, 'utf8'), signature, keyId) }
  }
  const bad = Object.entries(got).filter(([, v]) => !v.hashMatches || !v.signatureValid).length
  const [pub] = publicKeys()
  check('every snapshot hash recomputes and its Ed25519 signature verifies with the app public key, as on main',
    snaps.length > 0 && bad === 0 && isDeepStrictEqual(got, ref.snapshots),
    `${snaps.length} snapshots, ${bad} invalid; key ${pub.keyId} (public key ${createHash('sha256').update(pub.publicKeyRaw).digest('hex').slice(0, 16)}…)`)

  // The restore is only useful if the data can be read with the keys the app holds.
  let names = 0, erased = 0
  for (const r of await sql`select name_enc from patients`) { if (!r.name_enc) { erased++; continue } decryptField(r.name_enc as string); names++ } // '' = erasure tombstone
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
  check('stored files and patient names decrypt with APP_MASTER_KEY; each file matches its recorded SHA-256', names > 0 && files > 0, `${names} names (${erased} erased tombstones skipped), ${files} files (${(bytes / 1048576).toFixed(1)} MB)`)
}

// ── d. smoke: scripts/restore-smoke.ts (shared with restore-from-backup.ts) ──────

// ── f. report ────────────────────────────────────────────────────────────────
function writeReport(info: { startedAt: Date; point?: { at: Date; attempts: number }; branch?: string; parentLsn?: string; window?: number; ref?: Reference; built?: boolean }) {
  const ok = checks.length > 0 && checks.every((c) => c.ok)
  const s = (k: string) => (timings[k] === undefined ? 'n/a' : `${(timings[k] / 1000).toFixed(1)} s`)
  const rows = info.ref ? Object.entries(info.ref.tables) : []
  const md = `# Restore drill (V06-E2E-02, PRD §10.2)

**Result: ${ok ? 'PASS' : 'FAIL'}** · ${info.startedAt.toISOString().slice(0, 10)} · run with \`npx tsx --env-file=.env.local scripts/restore-drill.ts\`

Point-in-time restore of the production database into a fresh Neon branch, integrity checks on the restored copy, an app smoke run against it, then the branch is deleted. This file is rewritten by every run.

## What was restored

| | |
|---|---|
| Neon project | \`${PROJECT}\` (organisation \`${NEON_ORG}\`) |
| Source | branch \`main\` (default) |
| Restore point | \`${info.point?.at.toISOString() ?? 'not reached'}\` (taken between two identical reads of main${info.point ? `; attempt ${info.point.attempts}` : ''}) |
| Restored into | new branch \`${info.branch ?? 'not created'}\`${info.parentLsn ? `, parent LSN \`${info.parentLsn}\`` : ''}, own read-write compute |
| Point-in-time window | ${info.window ? `${info.window} s (${(info.window / 3600).toFixed(0)} h) of history` : 'unknown'} |
| Branch afterwards | ${checks.find((c) => c.name.startsWith('restore branch deleted'))?.ok ? 'deleted' : 'NOT confirmed deleted: check `neonctl branches list`'} |

## Timings

| Step | Time |
|---|---|
| Reference from main + restore point (two reads, ${info.point?.attempts ?? '?'} attempt(s)) | ${s('reference')} |
| Branch create (control plane) | ${s('branchCreate')} |
| Compute ready (first successful query) | ${s('computeReady')} |
| Verification on the branch (migrations, RLS, counts, audit chains, snapshots, decryption) | ${s('verification')} |
| Production build of the repo copy | ${info.built === false ? 'reused (source unchanged)' : s('build')} |
| Smoke: server start + sign-in + ledger + /verify | ${timings.smoke === undefined ? 'n/a' : `${((timings.smoke - (info.built === false ? 0 : timings.build ?? 0)) / 1000).toFixed(1)} s`} |
| Branch delete | ${s('branchDelete')} |
| **Total** | ${s('total')} |

Network note: timings are from a laptop to Neon Singapore (about 100 ms round trip), so the verification and smoke figures are dominated by round trips.

## Checks

| | Check | Detail |
|---|---|---|
${checks.map((c) => `| ${c.ok ? 'PASS' : '**FAIL**'} | ${c.name} | ${c.detail.replace(/\|/g, '/')} |`).join('\n')}
${notes.length ? `\n## Notes\n\n${notes.map((n) => `- ${n}`).join('\n')}\n` : ''}
## Reference taken from main at the restore point

${rows.length ? `Rows per table: ${rows.map(([t, n]) => `${t} ${n}`).join(', ')}.` : 'Not reached.'}
${info.ref ? `\nAudit chain heads: ${Object.entries(info.ref.audit).map(([o, h]) => `${o} seq ${h.seq} (${h.rows} rows) hash ${h.hash.slice(0, 16)}…`).join('; ')}.\nSnapshots: ${Object.keys(info.ref.snapshots).length}, all hashes recomputed and signatures verified on main before the restore.\n` : ''}
## Limits of this drill

- It restores to a moment seconds old, taken from the live branch. The point-in-time mechanism is the same for any moment inside the history window, but an older restore point cannot be compared with a reference taken now.
- The window is the Neon project's history retention (see above). Nothing older than that can be restored from Neon; there is no second copy.
- The smoke run uses the demo organisation Ganga's test staff. It writes a session row (and audit rows) on the restored branch only.
`
  mkdirSync('docs/releases/v1.0', { recursive: true })
  writeFileSync(REPORT, md)
  log(`wrote ${REPORT}`)
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date(), t0 = performance.now()
  const argAt = process.argv.indexOf('--build-dir')
  const buildDir = argAt > 0 ? process.argv[argAt + 1] : join(tmpdir(), 'oncosetu-restore-drill-build')
  for (const k of ['DATABASE_URL_UNPOOLED', 'DATABASE_URL_APP', 'APP_MASTER_KEY', 'SIGNING_KEY_ED25519']) if (!process.env[k]) throw new Error(`${k} is not set (run with --env-file=.env.local)`)
  await exec('neonctl', ['--version']).catch(() => { throw new Error('neonctl is not installed or not on PATH') })

  const ownerUrl = new URL(process.env.DATABASE_URL_UNPOOLED!)
  const role = decodeURIComponent(ownerUrl.username), database = ownerUrl.pathname.slice(1)
  const main = connect(process.env.DATABASE_URL_UNPOOLED!)
  const info: Parameters<typeof writeReport>[0] = { startedAt }
  const name = `restore-drill-${startedAt.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`
  let branchStarted = false, server: ChildProcess | undefined

  const cleanup = async () => {
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise((r) => { server!.once('exit', r); setTimeout(r, 10_000) }); server.kill('SIGKILL') }
    if (!branchStarted) return
    branchStarted = false
    await timed('branchDelete', async () => {
      try {
        const all = (await neonJson('branches', 'list')) as { id: string; name: string; default: boolean }[]
        const mine = all.find((b) => b.name === name)
        if (mine && (mine.default || !mine.name.startsWith('restore-drill-'))) throw new Error('refusing to delete a branch that is not this drill\'s')
        if (mine) await neonJson('branches', 'delete', mine.id)
        const left = ((await neonJson('branches', 'list')) as { name: string }[]).filter((b) => b.name === name)
        check(`restore branch deleted (${name})`, left.length === 0, left.length ? 'still listed' : 'no longer listed')
      } catch (e) { check(`restore branch deleted (${name})`, false, msg(e)) }
    })
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void cleanup().finally(() => process.exit(130)) })

  try {
    // a. reference + restore point
    const stale = ((await neonJson('branches', 'list')) as { name: string }[]).filter((b) => b.name.startsWith('restore-drill-'))
    if (stale.length) notes.push(`Found leftover drill branches before starting (not touched): ${stale.map((b) => b.name).join(', ')}. Delete them with \`neonctl branches delete\`; the free plan allows 10 branches.`)
    info.window = JSON.parse((await exec('neonctl', ['projects', 'get', PROJECT, '-o', 'json'])).stdout).history_retention_seconds as number
    const point = await timed('reference', () => takeRestorePoint(main))
    const ref = point.ref
    info.point = point; info.ref = ref
    log(`restore point ${point.at.toISOString()}; ${Object.keys(ref.tables).length} tables, ${Object.values(ref.tables).reduce((a, b) => a + b, 0)} rows, ${Object.keys(ref.snapshots).length} snapshots`)
    const onMain = Object.entries(ref.snapshots).filter(([, v]) => !v.hashMatches || !v.signatureValid).length
    check('reference on main: every snapshot hash and signature valid before the restore', onMain === 0, `${Object.keys(ref.snapshots).length} snapshots, ${onMain} invalid`)

    // b. point-in-time restore into a fresh branch (the timestamp may be too recent for the pageserver for a moment: retry)
    branchStarted = true
    info.branch = name
    const created: { branch: { id: string; parent_lsn?: string }; endpoints: { hosts: { read_write_host: string; read_write_pooled_host: string } }[] } = await timed('branchCreate', async () => {
      for (let attempt = 1; ; attempt++) {
        try { return await neonJson('branches', 'create', '--name', name, '--parent', point.at.toISOString()) } catch (e) {
          if (attempt >= 4 || !/timestamp|lsn|future|not found/i.test(msg(e))) throw e
          log(`branch create refused (${msg(e).split('\n')[0]}); retrying in 5 s`)
          await sleep(5000)
        }
      }
    })
    info.parentLsn = created.branch.parent_lsn
    const hosts = created.endpoints[0].hosts
    const direct = await neonText('connection-string', name, '--role-name', role, '--database-name', database)
    const appUrl = new URL(process.env.DATABASE_URL_APP!); appUrl.host = hosts.read_write_pooled_host
    const pooled = new URL(direct); pooled.host = hosts.read_write_pooled_host
    if (new URL(direct).host === ownerUrl.host) throw new Error('the restored branch resolved to the main endpoint: refusing to continue')
    log(`branch ${name} created from main@${point.at.toISOString()} (parent LSN ${info.parentLsn}); waiting for its compute`)
    await timed('computeReady', async () => {
      const end = Date.now() + 180_000
      for (;;) {
        const c = connect(direct)
        try { await c`select 1`; return } catch (e) { if (Date.now() > end) throw e; await sleep(3000) } finally { await c.end({ timeout: 2 }).catch(() => {}) }
      }
    })

    // c. verification on the restored branch
    const restored = connect(direct)
    try {
      await timed('verification', async () => {
        await verifyMigrations(restored)
        await verifyRls(restored, appUrl.toString())
        const got = await reference(restored)
        const dt = diffKeys(got.tables, ref.tables), da = diffKeys(got.audit, ref.audit)
        check('row count of every table equals the reference', !dt.length, dt.length ? `differs: ${dt.map((t) => `${t} ${ref.tables[t]} → ${got.tables[t]}`).join(', ')}` : `${Object.keys(ref.tables).length} tables, ${Object.values(ref.tables).reduce((a, b) => a + b, 0)} rows`)
        check('audit chain head (seq + hash) per organisation equals the reference', !da.length, da.length ? `differs for ${da.join(', ')}` : Object.entries(got.audit).map(([o, h]) => `${o.slice(-1) === '1' ? 'Narmada' : 'Ganga'} seq ${h.seq}`).join(', '))
        await verifyAudit(restored, ref)
        await verifyKeysAndData(restored, ref)
      })

      // d. smoke: the app, from a production build, on the restored database only
      await timed('smoke', async () => {
        const r = await runRestoreSmoke({ buildDir, urls: { pooled: pooled.toString(), direct, app: appUrl.toString() }, sql: restored, check, log, onServer: (p) => { server = p } })
        info.built = r.built
        timings.build = r.buildMs
      })
    } finally { await restored.end({ timeout: 5 }) }
  } catch (e) {
    check('drill ran to completion', false, msg(e))
  } finally {
    await cleanup()
    await main.end({ timeout: 5 })
    timings.total = Math.round(performance.now() - t0)
    writeReport(info)
  }
  const ok = checks.every((c) => c.ok)
  log(ok ? `PASS: ${checks.length} checks in ${(timings.total / 1000).toFixed(0)} s` : `FAIL: ${checks.filter((c) => !c.ok).map((c) => c.name).join('; ')}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(msg(e)); process.exit(1) })
