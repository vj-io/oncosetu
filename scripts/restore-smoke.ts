/**
 * V06-E2E-02 "restore … → E2E smoke passes": the app smoke shared by both restore paths, scripts/restore-drill.ts
 * (point-in-time) and scripts/restore-from-backup.ts (encrypted backup). A production build of a COPY of this repo (so a
 * running dev server is left alone) is started against the restored database only; Playwright signs in as the Ganga
 * clinician, opens a sealed patient's ledger and the public /verify page of the snapshot, and the login must have written
 * a session row on that database.
 *
 * Standalone, against the database of the env it is given (a way to test the smoke itself without restoring anything):
 *   npx tsx --env-file=<env file> scripts/restore-smoke.ts [--build-dir DIR]
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium, request } from '@playwright/test'
import postgres, { type Sql } from 'postgres'
import { verifyCopy } from '../src/i18n/ledger'
import { ORG_GANGA_ID } from '../src/server/demo'
import { EMAIL, PASSWORD } from '../tests/e2e/helpers/env'
import { totpFor } from '../tests/e2e/helpers/totp'

export type Check = (name: string, ok: boolean, detail: string) => void
/** The restored database: pooled (DATABASE_URL), direct owner (DATABASE_URL_UNPOOLED), app role (DATABASE_URL_APP). */
export type DbUrls = { pooled: string; direct: string; app: string }

const exec = promisify(execFile)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const sourceHash = () => {
  const h = createHash('sha256')
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else h.update(p).update(readFileSync(p)) } }
  walk('src'); walk('drizzle')
  for (const f of ['package-lock.json', 'next.config.ts', 'tsconfig.json']) h.update(readFileSync(f))
  return h.digest('hex')
}

/** A production build of a COPY of this repo (a build in the live tree would disturb a running dev server). Reused while the source is unchanged. */
async function prepareBuild(dir: string): Promise<{ built: boolean }> {
  const stamp = join(dir, '.drill-source-hash'), hash = sourceHash()
  if (existsSync(join(dir, '.next/BUILD_ID')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash) return { built: false }
  mkdirSync(dir, { recursive: true })
  await exec('rsync', ['-a', '--delete', '--exclude', 'node_modules', '--exclude', '.next', '--exclude', '.git', '--exclude', '.vercel', '--exclude', 'test-results',
    '--exclude', 'playwright-report', '--exclude', 'tsconfig.tsbuildinfo', '--exclude', '.env.local', '--exclude', '.drill-source-hash', './', `${dir}/`])
  if (!existsSync(join(dir, 'node_modules'))) await exec('cp', ['-cR', 'node_modules', join(dir, 'node_modules')]).catch(() => exec('cp', ['-R', 'node_modules', join(dir, 'node_modules')]))
  // The copy gets no database URL at all: it can only reach the restored database, whose URLs the server is started with.
  if (existsSync('.env.local')) writeFileSync(join(dir, '.env.local'), readFileSync('.env.local', 'utf8').split('\n').filter((l) => !l.startsWith('DATABASE_URL')).join('\n'))
  rmSync(join(dir, '.next'), { recursive: true, force: true })
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('DATABASE_URL')) delete env[k]
  await exec(process.execPath, [join(dir, 'node_modules/next/dist/bin/next'), 'build'], { cwd: dir, env, maxBuffer: 64 << 20 })
  writeFileSync(stamp, hash)
  return { built: true }
}

const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => res(port)) }); s.on('error', rej) })

async function smoke(base: string, sql: Sql, check: Check) {
  const [snap] = await sql`select s.id, s.patient_id, s.seq from snapshots s
    where s.org_id = ${ORG_GANGA_ID} and exists (select 1 from events e where e.patient_id = s.patient_id)
      and (select c.action from consents c where c.patient_id = s.patient_id order by c.recorded_at desc limit 1) <> 'withdraw'
    order by s.sealed_at desc limit 1`
  if (!snap) throw new Error('no sealed Ganga snapshot with events and active consent on the restored database')
  const [{ n: sessionsBefore }] = await sql`select count(*)::int as n from sessions`
  const api = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } })
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chromium' })
  try {
    const email = EMAIL.clinician
    const login = await api.post('/api/auth/staff/login', { data: { email, password: PASSWORD, totp: totpFor(email) } })
    if (!login.ok()) throw new Error(`staff login failed: ${login.status()}`)
    const page = await (await browser.newContext({ storageState: await api.storageState(), baseURL: base })).newPage()
    let t0 = performance.now()
    const ledger = await page.goto(`/patients/${snap.patient_id}/ledger`, { waitUntil: 'load' })
    const ledgerMs = Math.round(performance.now() - t0)
    const cards = await page.locator('article').count()
    const sealed = await page.getByText('Verify seal').count()
    check('smoke: signed in as the Ganga clinician and opened a patient ledger', ledger?.status() === 200 && (await page.title()).startsWith('Change ledger') && cards > 0 && sealed > 0,
      `HTTP ${ledger?.status()}, ${cards} items, seal plaque with "Verify seal" shown, ${ledgerMs} ms`)

    const anon = await (await browser.newContext({ baseURL: base })).newPage()
    t0 = performance.now()
    const verify = await anon.goto(`/verify/${snap.id}`, { waitUntil: 'load' })
    const verifyMs = Math.round(performance.now() - t0)
    const intact = await anon.getByText(verifyCopy.intactTitle.en).count()
    check('smoke: the public /verify page of snapshot S' + snap.seq + ' reports it intact (no session)', verify?.status() === 200 && intact > 0, `HTTP ${verify?.status()}, "${verifyCopy.intactTitle.en}" shown, ${verifyMs} ms`)
  } finally {
    await browser.close()
    await api.dispose()
  }
  // The login above wrote a session row; it must be on this database (and the server was given no other database).
  const [{ n }] = await sql`select count(*)::int as n from sessions`
  check('smoke: the app wrote to the restored database (sessions grew)', n > sessionsBefore, `sessions ${sessionsBefore} → ${n}`)
}

/**
 * Builds (or reuses) the copy, starts `next start` on the restored database only, runs the smoke, stops the server.
 * `onServer` hands the child process to the caller's signal cleanup. Returns whether a build ran and how long it took.
 */
export async function runRestoreSmoke(o: { buildDir: string; urls: DbUrls; sql: Sql; check: Check; log: (m: string) => void; onServer?: (p: ChildProcess) => void }): Promise<{ built: boolean; buildMs: number }> {
  const t0 = performance.now()
  const { built } = await prepareBuild(o.buildDir)
  const buildMs = Math.round(performance.now() - t0)
  if (built) o.log(`built the repo copy in ${o.buildDir}`)
  const port = await freePort(), base = `http://localhost:${port}`
  const server = spawn(process.execPath, [join(o.buildDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], {
    cwd: o.buildDir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: o.urls.pooled, DATABASE_URL_UNPOOLED: o.urls.direct, DATABASE_URL_APP: o.urls.app },
  })
  o.onServer?.(server)
  let serverLog = ''
  for (const s of [server.stdout!, server.stderr!]) s.on('data', (d: Buffer) => { serverLog = (serverLog + d.toString()).slice(-3000) })
  try {
    const end = Date.now() + 60_000
    while (!(await fetch(`${base}/login`).then((r) => r.ok, () => false))) {
      if (Date.now() > end || server.exitCode !== null) throw new Error(`next start did not come up:\n${serverLog}`)
      await sleep(500)
    }
    o.log(`next start on ${base} against ${new URL(o.urls.pooled).host.split('.')[0]}`)
    await smoke(base, o.sql, o.check)
  } catch (e) {
    if (serverLog && e instanceof Error && !e.message.includes(serverLog)) e.message += `\nserver log tail:\n${serverLog}`
    throw e
  } finally {
    if (server.exitCode === null) { server.kill('SIGTERM'); await new Promise((r) => { server.once('exit', r); setTimeout(r, 10_000) }); server.kill('SIGKILL') }
  }
  return { built, buildMs }
}

// Standalone: the smoke against the env's own database.
if (process.argv[1]?.endsWith('restore-smoke.ts')) {
  const urls = { pooled: process.env.DATABASE_URL!, direct: process.env.DATABASE_URL_UNPOOLED!, app: process.env.DATABASE_URL_APP! }
  if (!urls.pooled || !urls.direct || !urls.app) throw new Error('DATABASE_URL, DATABASE_URL_UNPOOLED and DATABASE_URL_APP must be set (run with --env-file)')
  const at = process.argv.indexOf('--build-dir')
  const buildDir = at > 0 ? process.argv[at + 1] : join(tmpdir(), 'oncosetu-restore-drill-build')
  const sql = postgres(urls.direct, { max: 1, prepare: false, onnotice: () => {} })
  let failed = 0
  const check: Check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
  runRestoreSmoke({ buildDir, urls, sql, check, log: (m) => console.log(m) })
    .catch((e) => { failed++; console.error(e instanceof Error ? e.message : e) })
    .finally(async () => { await sql.end({ timeout: 5 }); process.exit(failed ? 1 : 0) })
}
