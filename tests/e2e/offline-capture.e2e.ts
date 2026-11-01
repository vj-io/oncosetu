/**
 * Offline capture end-to-end (V05-E2E-01..05, E-OFF-01..05). Needs the demo database and a PRODUCTION server:
 *   npx next build && npx next start -p 3100
 *   BASE_URL=http://localhost:3100 npx tsx --env-file=.env.local tests/e2e/offline-capture.e2e.ts
 * It cannot run on `next dev`: after an offline reload the dev client waits for the server's React debug channel,
 * so the cached page never hydrates (the dev-only channel does not exist in a production build).
 * Env: BASE_URL (default http://localhost:3000), PW_CHANNEL (default "chromium"), E2E_SHOT_DIR (optional screenshots).
 *
 * Creates a temporary patient + consent + encounter in the demo org through adminDb and removes everything it
 * created afterwards. If POST /api/patients/[id]/documents does not exist yet, uploads are answered by a stub
 * and the test verifies the requests the app sends (headers and multipart fields) instead of server rows.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect as baseExpect, type BrowserContext, type Page, type Request } from '@playwright/test'
import sharp from 'sharp'
import { sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { adminDb, closeDb } from '../../src/db'
import { consents, devices, encounters, patients } from '../../src/db/schema'
import { encryptField, hmac } from '../../src/server/crypto'
import { ORG_NARMADA_ID } from '../../src/server/demo'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SHOTS = process.env.E2E_SHOT_DIR
const MOCK_UPLOAD = !existsSync(join(process.cwd(), 'src/app/api/patients/[id]/documents/route.ts'))
const PIN = '482913'
const NAME = `E2E Capture ${Math.random().toString(36).slice(2, 7)}`
const DOC = join(process.cwd(), 'public/demo-docs/hero__03-ct-thorax-abdomen.jpg')
let TMP = ''
const log = (s: string) => console.log(`  ✓ ${s}`)
const expect = baseExpect.configure({ timeout: 30_000 })

// ── fixtures ─────────────────────────────────────────────────────────────────
async function createPatient() {
  const [p] = await adminDb.insert(patients).values({
    orgId: ORG_NARMADA_ID, oncosetuTokenHash: hmac(`e2e-${uuidv7()}`), nameEnc: encryptField(NAME),
    dobEnc: encryptField('1975-04-12'), sex: 'female',
  }).returning({ id: patients.id })
  await adminDb.insert(consents).values({
    orgId: ORG_NARMADA_ID, patientId: p.id, action: 'grant', purposes: { store: true, ai: false, share: false, abdm: false, metrics: false },
    actorType: 'staff', method: 'desk_assisted', noticeVersion: 'e2e', language: 'en',
  })
  const [e] = await adminDb.insert(encounters).values({ orgId: ORG_NARMADA_ID, patientId: p.id, type: 'onboarding' }).returning({ id: encounters.id })
  return { patientId: p.id, encounterId: e.id }
}

/** Remove everything the test created. Tables are emptied children-first by retrying on FK errors. audit_log is append-only and keeps ids only. */
async function cleanup(patientId: string) {
  const tables = (await adminDb.execute(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'patient_id' and table_name not in ('patients', 'audit_log', 'snapshots')`)) as unknown as { table_name: string }[]
  let pending = tables.map((t) => t.table_name)
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const failed: string[] = []
    for (const t of pending) {
      try { await adminDb.execute(sql`delete from ${sql.identifier(t)} where patient_id = ${patientId}`) } catch { failed.push(t) }
    }
    pending = failed
  }
  await adminDb.execute(sql`delete from patients where id = ${patientId}`)
  await adminDb.delete(devices).where(sql`${devices.label} like 'E2E %'`)
}

// ── helpers ──────────────────────────────────────────────────────────────────
type Upload = { fields: Record<string, string>; deviceId: string | null }
function parseUpload(req: Request): Upload {
  const body = req.postDataBuffer()?.toString('latin1') ?? ''
  const fields: Record<string, string> = {}
  for (const m of body.matchAll(/name="([A-Za-z]+)"(?:; filename="[^"]*")?\r\n(?:Content-Type: [^\r]*\r\n)?\r\n([^\r]*)/g)) if (m[1] !== 'file') fields[m[1]] = m[2]
  return { fields, deviceId: req.headers()['x-device-id'] ?? null }
}

async function login(ctx: BrowserContext) {
  const { accounts } = (await (await fetch(`${BASE}/api/auth/demo-accounts`)).json()) as { accounts: { email: string; totp: string }[] }
  const acc = accounts.find((a) => a.email === 'desk@narmada.demo')!
  const r = await ctx.request.post(`${BASE}/api/auth/staff/login`, { headers: { Origin: BASE }, data: { email: acc.email, password: 'Demo@2026', totp: acc.totp } })
  if (!r.ok()) throw new Error(`login failed ${r.status()}`)
}

const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }) }

/**
 * What IndexedDB holds, summarised in the page: only structure and byte statistics leave it.
 * Written as a string because tsx's keepNames helper (__name) does not exist inside the browser page.
 */
function inspectIdb(page: Page, needles: string[]): Promise<{
  captures: number; pages: number; binaries: number; plaintextHit: string[]; jpegHeader: boolean
  minEntropy: number; bigBinaries: number; keys: string[]
}> {
  return page.evaluate(`(async () => {
    const needles = ${JSON.stringify(needles)}
    const db = await new Promise((res, rej) => { const r = indexedDB.open('oncosetu-capture'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const all = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const [meta, captures, pages] = await Promise.all([all('meta'), all('captures'), all('pages')])
    db.close()
    const bins = []
    const dump = JSON.stringify([meta, captures, pages], (_k, v) => {
      if (v instanceof ArrayBuffer) { bins.push(new Uint8Array(v)); return '<bin ' + v.byteLength + '>' }
      if (v instanceof Uint8Array) { bins.push(v); return '<bin ' + v.byteLength + '>' }
      return v
    })
    const ascii = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s }
    const entropy = (b) => { const c = new Array(256).fill(0); for (const x of b) c[x]++; return -c.filter(Boolean).reduce((a, n) => a + (n / b.length) * Math.log2(n / b.length), 0) }
    const big = bins.filter((b) => b.length > 20000)
    return {
      captures: captures.length, pages: pages.length, binaries: bins.length,
      plaintextHit: needles.filter((n) => dump.includes(n) || bins.some((b) => ascii(b).includes(n))),
      jpegHeader: bins.some((b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff),
      minEntropy: big.length ? Math.min(...big.map(entropy)) : 8,
      bigBinaries: big.length,
      keys: [...new Set(captures.flatMap((c) => Object.keys(c)))],
    }
  })()`)
}

const idbDatabases = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
const deviceIdOf = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('oncosetu.capture.device') ?? 'null') as { deviceId: string } | null)?.deviceId ?? null)

async function setPin(page: Page, label: string) {
  await expect(page.getByRole('heading', { name: 'Set a device PIN' })).toBeVisible()
  await page.getByLabel('Device name').fill(label)
  await page.getByLabel('6-digit PIN', { exact: true }).fill(PIN)
  await page.getByLabel('Repeat PIN').fill(PIN)
  await page.getByRole('button', { name: 'Set PIN and start' }).click()
  await expect(page.getByRole('heading', { name: 'Who are these pages for?' })).toBeVisible()
}

async function capturePages(page: Page, extra: string) {
  await page.getByText(NAME).first().click()
  const second = join(TMP, `page2-${extra}.jpg`)
  await sharp(DOC).linear(0.96, 0).toFile(second) // a different page: different bytes, so it is not an exact duplicate
  await page.getByTestId('page-file-input').setInputFiles([DOC, second])
  await expect(page.getByRole('list', { name: 'Captured pages' }).getByRole('listitem')).toHaveCount(2)
  await page.getByRole('button', { name: /Save 2 pages to queue/ }).click()
  await expect(page.getByText('Saved on this device').first()).toBeVisible()
}

// ── the test ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Offline capture e2e against ${BASE} (${MOCK_UPLOAD ? 'upload route missing: stubbed, request-level checks' : 'real upload route'})`)
  TMP = await mkdtemp(join(tmpdir(), 'oncosetu-e2e-'))
  const { patientId, encounterId } = await createPatient()
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chromium' })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('  pageerror', e.message.slice(0, 200)))

  const uploads: Upload[] = []
  let mode: 'pass' | 'drop-first-after-server' | 'stub-410' | 'abort' = 'pass'
  let dropped = false
  await page.route('**/api/patients/*/documents', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    uploads.push(parseUpload(route.request()))
    if (mode === 'stub-410') return route.fulfill({ status: 410, json: { error: { code: 'device_revoked', message: 'revoked' } } })
    if (mode === 'abort') return route.abort('connectionreset')
    if (MOCK_UPLOAD) {
      if (mode === 'drop-first-after-server' && !dropped) { dropped = true; return route.abort('connectionreset') }
      return route.fulfill({ status: 200, json: { documentId: uuidv7(), status: 'queued' } })
    }
    if (mode === 'drop-first-after-server' && !dropped) { // the server processes it, the client never hears back (E-DOC-18)
      dropped = true
      await route.fetch()
      return route.abort('connectionreset')
    }
    return route.continue()
  })

  try {
    await login(ctx)

    console.log('A. install, offline capture, reload, unlock, exactly-once sync (V05-E2E-01, 03, E-OFF-01/02, E-DOC-18)')
    await page.goto(`${BASE}/capture`)
    await setPin(page, 'E2E tablet')
    await expect(page.getByText(NAME).first()).toBeVisible()
    const deviceId = await expect.poll(() => deviceIdOf(page)).not.toBeNull().then(() => deviceIdOf(page))
    log(`PIN set, device registered (${deviceId})`)
    expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest')
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated')
    // the shell is cached after the first visit; API responses never are
    await expect.poll(() => page.evaluate(async () => {
      const c = await caches.open('oncosetu-shell-v1')
      const keys = (await c.keys()).map((r) => new URL(r.url).pathname)
      return { page: keys.includes('/capture'), statics: keys.filter((k) => k.startsWith('/_next/static/')).length > 3, api: keys.some((k) => k.startsWith('/api/')) }
    })).toEqual({ page: true, statics: true, api: false })
    log('manifest linked, service worker active, /capture + static assets cached, no /api cached')
    await shot(page, '01-ready-online')

    await ctx.setOffline(true)
    await expect(page.getByText('Offline · saving on this device')).toBeVisible()
    await capturePages(page, 'a')
    await expect(page.getByRole('list', { name: 'Queued captures' }).locator('li[data-state="pending"]')).toHaveCount(1)
    log('offline: 2 pages captured and queued as Pending')
    await shot(page, '02-offline-queued')

    await page.reload() // served by the service worker from cache
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible()
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await expect(page.getByText('Locked · unlock to view')).toBeVisible()
    await expect(page.getByText('1 capture waiting on this device')).toBeVisible()
    log('offline reload: shell served from cache, queue intact but locked (E-OFF-01)')
    await shot(page, '03-locked-after-reload')

    const idb = await inspectIdb(page, [NAME, patientId, encounterId, 'JFIF', 'Exif'])
    expect(idb.captures).toBe(1)
    expect(idb.pages).toBe(2)
    expect(idb.plaintextHit).toEqual([])
    expect(idb.jpegHeader).toBe(false)
    expect(idb.bigBinaries).toBeGreaterThanOrEqual(2)
    expect(idb.minEntropy).toBeGreaterThan(7.9)
    expect(idb.keys.sort()).toEqual(['attempts', 'capturedAt', 'id', 'lastError', 'nextAttemptAt', 'offline', 'pageCount', 'patient', 'state'])
    log(`IndexedDB without PIN: ${idb.binaries} binaries, no patient text, no JPEG markers, min entropy ${idb.minEntropy.toFixed(3)} bits/byte (V05-E2E-03)`)

    await page.getByLabel('PIN', { exact: true }).fill('000000')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByText('Wrong PIN.')).toBeVisible()
    await page.getByLabel('PIN', { exact: true }).fill(PIN)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByRole('heading', { name: 'Who are these pages for?' })).toBeVisible()
    await expect(page.getByText(NAME).first()).toBeVisible() // patient list decrypted from the cache while offline
    await expect(page.getByRole('list', { name: 'Queued captures' }).getByText(new RegExp(NAME))).toBeVisible()
    log('wrong PIN rejected; right PIN unlocks queue and the encrypted offline patient list')

    mode = 'drop-first-after-server'
    await ctx.setOffline(false)
    const failedItem = page.getByRole('list', { name: 'Queued captures' }).locator('li[data-state="failed"]')
    await expect(failedItem).toHaveCount(1) // first upload: server got it, response lost
    await failedItem.getByRole('button', { name: 'Retry now' }).click()
    await expect(page.getByText('Nothing waiting')).toBeVisible()
    await expect.poll(async () => (await inspectIdb(page, [])).pages).toBe(0)
    expect((await inspectIdb(page, [])).captures).toBe(0)
    log('interrupted upload retried; queue and ciphertext wiped after confirmed sync')

    const ids = uploads.map((u) => u.fields.clientFileId)
    expect(new Set(ids).size).toBe(2) // 3 requests, 2 distinct clientFileIds: the retry reused the key
    expect(uploads.length).toBe(3)
    for (const u of uploads) {
      expect(u.deviceId).toBe(deviceId)
      expect(u.fields.intakeRoute).toBe('offline_sync')
      expect(u.fields.encounterId).toBe(encounterId)
      expect(Number.isNaN(Date.parse(u.fields.clientCapturedAt))).toBe(false)
    }
    log('requests carry x-device-id, clientFileId (stable across the retry), intakeRoute=offline_sync, encounterId, clientCapturedAt')
    if (!MOCK_UPLOAD) {
      const rows = (await adminDb.execute(sql`select count(*)::int as n, count(distinct client_file_id)::int as d from documents where patient_id = ${patientId}`)) as unknown as { n: number; d: number }[]
      expect(rows[0]).toEqual({ n: 2, d: 2 })
      log('server: exactly 2 documents for 3 upload attempts (idempotent on clientFileId)')
    }

    console.log('C. admin revokes the device while it holds a queue -> wiped on next contact (V05-E2E-05, E-OFF-05)')
    uploads.length = 0
    mode = 'abort' // the queue must still hold the item when the revoke lands
    await ctx.setOffline(true)
    await capturePages(page, 'c')
    await adminDb.update(devices).set({ revokedAt: new Date() }).where(sql`${devices.id} = ${deviceId}`)
    await ctx.setOffline(false)
    await expect(page.getByText('This device was switched off by an administrator')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Set a device PIN' })).toBeVisible()
    expect(await idbDatabases(page)).toEqual([])
    expect(await deviceIdOf(page)).toBeNull()
    expect(uploads.length).toBe(0) // nothing was uploaded after the revoke
    log('revoked: queue, key and device id wiped; no upload attempted')
    if (!MOCK_UPLOAD) {
      const r = await ctx.request.post(`${BASE}/api/patients/${patientId}/documents`, {
        headers: { Origin: BASE, 'x-device-id': deviceId! },
        multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: await sharp(DOC).resize({ width: 900 }).jpeg().toBuffer() }, clientFileId: `e2e-revoked-${uuidv7()}`, intakeRoute: 'offline_sync', encounterId },
      })
      if (r.status() === 410) log('upload route refuses a revoked device: 410 device_revoked')
      else console.log(`  ! upload route answered ${r.status()} for a revoked device: it does not call assertDeviceActive yet`)
    }
    await shot(page, '04-revoked')

    console.log('D. upload answered 410 device_revoked -> wipe (FR-OFF-06)')
    await setPin(page, 'E2E tablet 2')
    await expect.poll(() => deviceIdOf(page)).not.toBeNull()
    await expect(page.getByText(NAME).first()).toBeVisible()
    await ctx.setOffline(true)
    await capturePages(page, 'd')
    mode = 'stub-410'
    await ctx.setOffline(false)
    await expect(page.getByText('This device was switched off by an administrator')).toBeVisible()
    expect(await idbDatabases(page)).toEqual([])
    log('410 device_revoked on upload wiped the device')

    console.log('B. device clock +3 days: client time recorded separately, server time authoritative (V05-E2E-04, E-OFF-03)')
    await setPin(page, 'E2E tablet 3')
    await expect.poll(() => deviceIdOf(page)).not.toBeNull()
    await expect(page.getByText(NAME).first()).toBeVisible()
    uploads.length = 0
    mode = 'pass'
    const skewed = Date.now() + 3 * 86_400_000
    await page.clock.setFixedTime(new Date(skewed))
    await capturePages(page, 'b') // online: syncs at once as a desk capture
    await expect(page.getByText('Nothing waiting')).toBeVisible()
    expect(uploads.length).toBe(2)
    for (const u of uploads) {
      expect(u.fields.intakeRoute).toBe('desk')
      expect(Math.abs(Date.parse(u.fields.clientCapturedAt) - skewed)).toBeLessThan(120_000)
    }
    if (!MOCK_UPLOAD) {
      const rows = (await adminDb.execute(sql`select received_at, client_captured_at from documents where patient_id = ${patientId} and client_captured_at is not null order by received_at desc limit 1`)) as unknown as { received_at: Date; client_captured_at: Date }[]
      if (rows[0]) {
        expect(Math.abs(rows[0].received_at.getTime() - Date.now())).toBeLessThan(120_000)
        expect(rows[0].client_captured_at.getTime() - rows[0].received_at.getTime()).toBeGreaterThan(2.9 * 86_400_000)
        log('server: received_at is real time, client_captured_at is +3 days')
      } else console.log('  ! server stored no client_captured_at: the Pipeline route must pass the clientCapturedAt field to ingestDocument')
    }
    log('online capture sent clientCapturedAt = device time (+3 days) with intakeRoute=desk')

    console.log('E. sign out wipes the queue and the cached page (FR-OFF-03)')
    mode = 'abort'
    await capturePages(page, 'e')
    await expect(page.getByRole('list', { name: 'Queued captures' }).locator('li[data-state="failed"]')).toHaveCount(1)
    await shot(page, '05-failed-then-signout')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect.poll(() => idbDatabases(page)).toEqual([])
    expect(await page.evaluate(async () => !!(await (await caches.open('oncosetu-shell-v1')).match('/capture')))).toBe(false)
    log('sign out: IndexedDB database deleted by the service worker, cached /capture page removed')

    // 375 px layout check
    await login(ctx)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`${BASE}/capture`)
    await expect(page.getByRole('heading', { name: 'Set a device PIN' })).toBeVisible()
    await shot(page, '06-setup-375')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    log('375 px: no horizontal scroll')
    console.log('\nALL PASSED')
  } finally {
    await browser.close()
    await rm(TMP, { recursive: true, force: true })
    await cleanup(patientId)
    await closeDb()
  }
}

main().catch((e) => { console.error('\nFAILED', e); process.exit(1) })
