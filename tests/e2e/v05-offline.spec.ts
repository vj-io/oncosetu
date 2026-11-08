// Offline desk capture (V05-E2E-01..05, FR-OFF-01..06, FR-ING-01) against a PRODUCTION server, like the rest of the suite.
// It cannot pass on `next dev`: after an offline reload the dev client waits for the server's React debug channel, so the
// page served from the service worker's cache never hydrates (that channel does not exist in a production build).
// Tests that close and reopen the browser, or need a camera and microphone, launch their own persistent Chromium with
// Chrome's fake media devices; the others use the suite's browser.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Page, type Request } from '@playwright/test'
import { and, eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { v7 as uuidv7 } from 'uuid'
import { adminDb } from '../../src/db'
import { devices, documents, encounters, uploadSessions, voiceClips } from '../../src/db/schema'
import { Api, registerPatient } from './helpers/api'
import { closeEncounters, documentsOf } from './helpers/db'
import { BASE } from './helpers/env'
import { expect, test } from './helpers/fixtures'

const PIN = '482913'
const DOC = join(process.cwd(), 'public/demo-docs/hero__03-ct-thorax-abdomen.jpg')
const STORE_ONLY = { store: true, ai: false, share: false, abdm: false, metrics: false } // no model calls for these uploads
const tag = () => Math.random().toString(36).slice(2, 7)
const madeDevices: string[] = []
let FILES = '' // photos made for the tests (browser profiles live in their own folders)

test.beforeAll(async () => { FILES = await mkdtemp(join(tmpdir(), 'oncosetu-photos-')) })
test.afterAll(async () => {
  await rm(FILES, { recursive: true, force: true })
  if (madeDevices.length) await adminDb.delete(devices).where(inArray(devices.id, madeDevices))
})

// ── browsers ─────────────────────────────────────────────────────────────────
const launched = new Set<BrowserContext>()
test.afterEach(async () => { // a failed test must not leave its browser running
  for (const c of launched) await c.close().catch(() => {})
  launched.clear()
})

/** A Chromium that keeps its profile (IndexedDB, service worker, cookies) in `dir` across close and reopen. */
async function launch(dir: string, o: { offline?: boolean } = {}) {
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: process.env.PW_CHANNEL ?? 'chromium', baseURL: BASE, viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow',
    offline: o.offline, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  launched.add(ctx)
  return ctx
}
const signIn = async (ctx: BrowserContext, api: Api) => ctx.addCookies((await api.ctx.storageState()).cookies)
const firstPage = (ctx: BrowserContext) => ctx.pages()[0] ?? ctx.newPage()

/**
 * Every POST to the patient's API from this context (uploads, chunks, notes, visits), with the chunk number. A route, not a
 * request listener: only a route sees a multipart body. Register it after any route it should see past (fallback order).
 */
async function track(ctx: BrowserContext, patientId: string) {
  const seen: { method: string; path: string; idx?: number; req: Request }[] = []
  await ctx.route(`**/api/patients/${patientId}/**`, async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() === 'POST') {
      const idx = /\/uploads\/[^/]+$/.test(path) ? Number(/name="idx"\r\n\r\n(\d+)/.exec(req.postDataBuffer()?.toString('latin1') ?? '')?.[1]) : undefined
      seen.push({ method: req.method(), path: path.slice(`/api/patients/${patientId}`.length), idx, req })
    }
    await route.fallback()
  })
  return {
    seen,
    starts: () => seen.filter((s) => s.path === '/uploads'),
    chunks: () => seen.filter((s) => s.idx !== undefined).map((s) => s.idx!),
    finishes: () => seen.filter((s) => s.path.endsWith('/finish')).length,
    notes: () => seen.filter((s) => s.path === '/audio-notes').length,
  }
}

// ── capture app steps ────────────────────────────────────────────────────────
const deviceIdOf = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('oncosetu.capture.device') ?? 'null') as { deviceId: string } | null)?.deviceId ?? null)
const idbDatabases = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
const queued = (page: Page, state?: string) => page.getByRole('list', { name: 'Queued captures' }).locator(state ? `li[data-state="${state}"]` : 'li')

async function setPin(page: Page, label: string): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Set a device PIN' })).toBeVisible()
  await page.getByLabel('Device name').fill(label)
  await page.getByLabel('6-digit PIN', { exact: true }).fill(PIN)
  await page.getByLabel('Repeat PIN').fill(PIN)
  await page.getByRole('button', { name: 'Set PIN and start' }).click()
  await expect(page.getByRole('heading', { name: 'Who are these pages for?' })).toBeVisible()
  await expect.poll(() => deviceIdOf(page)).not.toBeNull()
  await expect(page.getByLabel('Search patients')).toBeVisible() // the patient list is downloaded (and saved for offline use)
  const id = (await deviceIdOf(page))!
  madeDevices.push(id)
  return id
}

async function unlock(page: Page) {
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible()
  await page.getByLabel('PIN', { exact: true }).fill(PIN)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('heading', { name: 'Who are these pages for?' })).toBeVisible()
}

const pick = async (page: Page, name: string, group = 'Patient for this capture') => {
  await page.getByLabel('Search patients').fill(name)
  await page.getByRole('radiogroup', { name: group }).getByText(name).click()
}

let shot = 0
/** `n` photos of a real page, each different from every other (an exact duplicate is not stored twice); 1100 px wide keeps uploads short. */
async function photos(n: number, name = tag()): Promise<string[]> {
  return Promise.all(Array.from({ length: n }, async (_, i) => {
    const f = join(FILES, `${name}-${i + 1}.jpg`)
    await sharp(DOC).resize({ width: 1100 }).linear(1 - (shot++ % 20) * 0.01, 0).jpeg({ quality: 85 }).toFile(f)
    return f
  }))
}

async function addPhotos(page: Page, files: string[]) {
  await page.getByTestId('page-file-input').setInputFiles(files)
  await expect(page.getByRole('list', { name: 'Captured pages' }).getByRole('listitem')).toHaveCount(files.length)
}

async function save(page: Page, label: RegExp) {
  await page.getByRole('button', { name: label }).click()
  await expect(page.getByText('No pages yet')).toBeVisible() // stored and cleared (a toast from an earlier save could still show)
}

/** What IndexedDB holds, summarised in the page: only structure and byte statistics leave it (a string: no bundler helpers). */
function inspectIdb(page: Page, needles: string[]): Promise<{
  captures: number; pages: number; plaintextHit: string[]; jpegHeader: boolean; webmHeader: boolean; minEntropy: number; bigBinaries: number; keys: string[]
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
      captures: captures.length, pages: pages.length,
      plaintextHit: needles.filter((n) => dump.includes(n) || bins.some((b) => ascii(b).includes(n))),
      jpegHeader: bins.some((b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff),
      webmHeader: bins.some((b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3),
      minEntropy: big.length ? Math.min(...big.map(entropy)) : 8, bigBinaries: big.length,
      keys: [...new Set(captures.flatMap((c) => Object.keys(c)))].sort(),
    }
  })()`)
}

// ── V05-E2E-01 / 03 ──────────────────────────────────────────────────────────
test('V05-E2E-01/03 offline: 5 photos + audio note queued encrypted, browser closed and reopened, synced exactly once', async ({ staff, ui }) => {
  test.setTimeout(600_000) // every page is start + chunks + finish: a minute or more against a distant database
  const desk = await staff('desk')
  const p = await registerPatient(desk, { fullName: `E2E Capture ${tag()}`, purposes: STORE_ONLY })
  const [visit] = await adminDb.select({ id: encounters.id }).from(encounters).where(eq(encounters.patientId, p.id))
  const dir = await mkdtemp(join(tmpdir(), 'oncosetu-offline-'))
  try {
    let ctx = await launch(dir)
    await signIn(ctx, desk)
    let page = await firstPage(ctx)
    await page.goto('/capture')
    await setPin(page, `E2E tablet ${tag()}`)
    expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest')
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated')
    await expect.poll(() => page.evaluate(async () => {
      const keys = (await (await caches.open('oncosetu-shell-v1')).keys()).map((r) => new URL(r.url).pathname)
      return { page: keys.includes('/capture'), statics: keys.filter((k) => k.startsWith('/_next/static/')).length > 3, api: keys.some((k) => k.startsWith('/api/')) }
    })).toEqual({ page: true, statics: true, api: false }) // FR-OFF-01: the shell is cached, API answers never are

    await ctx.setOffline(true)
    await expect(page.getByText('Offline · saving on this device')).toBeVisible()
    await pick(page, p.name)
    await addPhotos(page, await photos(5))
    await page.getByRole('button', { name: 'Record audio note' }).click()
    await expect(page.getByRole('button', { name: /Stop recording · 0:0[2-9]/ })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Stop recording/ }).click()
    await expect(page.getByLabel('Your audio note, not saved yet')).toBeVisible()
    await save(page, /Save 5 pages and note to queue/)
    await expect(queued(page, 'pending')).toHaveCount(1)
    await expect(queued(page).getByText('5 pages + audio note')).toBeVisible()

    // Close the browser and open it again, still offline: the page comes from the service worker, the queue from IndexedDB.
    await ctx.close()
    ctx = await launch(dir, { offline: true })
    const sent = await track(ctx, p.id)
    page = await firstPage(ctx)
    await page.goto('/capture')
    await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible()
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await expect(page.getByText('1 capture waiting on this device')).toBeVisible()
    await expect(page.getByText('Locked · unlock to view')).toBeVisible()

    // V05-E2E-03: without the PIN, IndexedDB holds ciphertext only.
    const idb = await inspectIdb(page, [p.name, p.id, visit.id, 'JFIF', 'Exif', 'OpusHead'])
    expect(idb).toMatchObject({ captures: 1, pages: 6, plaintextHit: [], jpegHeader: false, webmHeader: false })
    expect(idb.bigBinaries).toBeGreaterThanOrEqual(5)
    expect(idb.minEntropy).toBeGreaterThan(7.9)
    expect(idb.keys).toEqual(['attempts', 'audio', 'capturedAt', 'id', 'lastError', 'nextAttemptAt', 'offline', 'pageCount', 'patient', 'state'])

    await page.getByLabel('PIN', { exact: true }).fill('000000')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByText('Wrong PIN.')).toBeVisible()
    await unlock(page)
    await expect(queued(page).getByText(new RegExp(p.name))).toBeVisible() // decrypted only now

    await ctx.setOffline(false)
    await expect(page.getByText('Nothing waiting')).toBeVisible({ timeout: 400_000 })
    await expect.poll(async () => (await inspectIdb(page, [])).pages).toBe(0)
    await ctx.close()

    // Synced once: one document and one finished upload session per page, one note. (Request counts can exceed this when
    // the server drops a connection mid-request and the queue retries; the server state is what must not.)
    const docs = await documentsOf(p.id)
    expect(docs).toHaveLength(5)
    expect(new Set(docs.map((d) => d.clientFileId)).size).toBe(5)
    for (const d of docs) expect(d).toMatchObject({ encounterId: visit.id, intakeRoute: 'offline_sync' })
    for (const d of docs) expect(d.clientCapturedAt).not.toBeNull()
    expect(sent.starts().length).toBeGreaterThanOrEqual(5)
    expect(sent.notes()).toBeGreaterThanOrEqual(1)
    const sessions = await adminDb.select().from(uploadSessions).where(eq(uploadSessions.patientId, p.id))
    expect(sessions.filter((s) => s.state === 'done').map((s) => s.clientFileId).sort()).toEqual(docs.map((d) => d.clientFileId).sort())
    expect(sessions.filter((s) => s.state === 'aborted')).toEqual([])
    const notes = await adminDb.select().from(voiceClips).where(eq(voiceClips.patientId, p.id))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ encounterId: visit.id, createdByKind: 'staff', asrProvider: 'none' })
    expect(notes[0].mime).toMatch(/^audio\//)

    // The note plays for Records and Clinicians (a player beside the documents); the desk can record but not listen back.
    expect((await (await staff('records')).get(`/api/patients/${p.id}/audio-notes/${notes[0].id}`)).status).toBe(200)
    expect((await desk.get(`/api/patients/${p.id}/audio-notes/${notes[0].id}`)).status).toBe(403)
    const rec = await ui('records')
    await rec.goto(`/patients/${p.id}/documents`)
    await expect(rec.getByRole('heading', { name: 'Audio notes from the desk' })).toBeVisible()
    await expect(rec.getByLabel(/Desk audio note, \d+ seconds/)).toBeVisible()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ── V05-E2E-02 ───────────────────────────────────────────────────────────────
test('V05-E2E-02 upload cut at 90 %: the reopened browser sends only the missing chunk; a lost answer is not a duplicate', async ({ staff }) => {
  test.setTimeout(600_000)
  const desk = await staff('desk')
  const p = await registerPatient(desk, { fullName: `E2E Resume ${tag()}`, purposes: STORE_ONLY })
  const dir = await mkdtemp(join(tmpdir(), 'oncosetu-offline-'))
  try {
    // A photo of pure grain: about 3 MB after the app's own JPEG step, so a dozen 256 KB chunks.
    const big = join(FILES, `grainy-${tag()}.jpg`)
    await sharp({ create: { width: 2000, height: 2700, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 80 } } }).jpeg({ quality: 97 }).toFile(big)

    let ctx = await launch(dir)
    await signIn(ctx, desk)
    let page = await firstPage(ctx)
    let total = 0, fileId = ''
    await ctx.route('**/api/patients/*/uploads', async (route) => {
      const b = route.request().postDataJSON() as { totalChunks: number; clientFileId: string }
      total = b.totalChunks
      fileId = b.clientFileId
      await route.continue()
    })
    await ctx.route('**/api/patients/*/uploads/*', async (route) => { // the last chunk never arrives
      const idx = Number(/name="idx"\r\n\r\n(\d+)/.exec(route.request().postDataBuffer()?.toString('latin1') ?? '')?.[1])
      if (route.request().method() === 'POST' && idx === total - 1) return route.abort('connectionreset')
      return route.continue()
    })
    let sent = await track(ctx, p.id) // runs before the two routes above, then falls back to them
    await page.goto('/capture')
    await setPin(page, `E2E tablet ${tag()}`)
    await pick(page, p.name)
    await addPhotos(page, [big])
    await save(page, /Save 1 page to queue/)
    await expect(queued(page, 'failed')).toHaveCount(1, { timeout: 240_000 })
    await ctx.setOffline(true)
    expect(total).toBeGreaterThanOrEqual(10)
    const accepted = [...new Set(sent.chunks().filter((i) => i < total - 1))]
    expect(accepted.sort((a, b) => a - b)).toEqual(Array.from({ length: total - 1 }, (_, i) => i))
    expect((total - 1) / total).toBeGreaterThanOrEqual(0.9) // the cut came after at least 90 % of the file
    await ctx.close()

    // Reopened: the stored session resumes. No new session, only the missing chunk, one finish.
    ctx = await launch(dir, { offline: true })
    sent = await track(ctx, p.id)
    page = await firstPage(ctx)
    await page.goto('/capture')
    await unlock(page)
    await ctx.setOffline(false)
    await expect(page.getByText('Nothing waiting')).toBeVisible({ timeout: 120_000 })
    expect(sent.starts()).toHaveLength(0)
    expect(sent.chunks()).toEqual([total - 1])
    expect(sent.finishes()).toBe(1)
    expect(await adminDb.select().from(documents).where(eq(documents.clientFileId, fileId))).toHaveLength(1)
    expect((await adminDb.select().from(uploadSessions).where(eq(uploadSessions.patientId, p.id))).map((s) => s.state)).toEqual(['done'])

    // E-DOC-18: the server finishes, the answer is lost. The retry is told "done" and sends nothing again.
    let dropped = false
    await ctx.route('**/api/patients/*/uploads/*/finish', async (route) => {
      if (dropped) return route.continue()
      dropped = true
      await route.fetch()
      return route.abort('connectionreset')
    })
    await addPhotos(page, await photos(1))
    await pick(page, p.name)
    await save(page, /Save 1 page to queue/)
    await expect(queued(page, 'failed')).toHaveCount(1, { timeout: 120_000 })
    await expect(page.getByText('Nothing waiting')).toBeVisible({ timeout: 120_000 }) // the backoff retry, at the next 15 s tick
    const second = sent.starts().map((s) => (s.req.postDataJSON() as { clientFileId: string }).clientFileId)
    expect(second).toHaveLength(2)
    expect(second[0]).toBe(second[1]) // the same file asked twice; the second answer was "done"
    expect(await adminDb.select().from(documents).where(eq(documents.clientFileId, second[0]))).toHaveLength(1)
    expect(await adminDb.select().from(uploadSessions).where(eq(uploadSessions.clientFileId, second[0]))).toHaveLength(1)
    expect(await documentsOf(p.id)).toHaveLength(2)
    await ctx.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ── V05-E2E-04, FR-OFF-02, FR-OFF-04 ─────────────────────────────────────────
test('V05-E2E-04 clock +3 days and a visit opened offline (UUIDv7): server time orders, client time is kept apart', async ({ staff, ui }) => {
  test.setTimeout(480_000)
  const desk = await staff('desk'), records = await staff('records')
  const q = await registerPatient(desk, { fullName: `E2E Visit ${tag()}`, purposes: STORE_ONLY })
  await closeEncounters(q.id) // seen before, no open visit today: Records may open one from the capture app
  const other = await registerPatient(desk, { fullName: `E2E Other ${tag()}`, purposes: STORE_ONLY })

  const page = await ui('records')
  const skewed = Date.now() + 3 * 86_400_000
  await page.clock.setFixedTime(new Date(skewed))
  await page.goto('/capture')
  await setPin(page, `E2E tablet ${tag()}`)
  await page.context().setOffline(true)
  await pick(page, q.name, 'Open a new visit for')
  await addPhotos(page, await photos(1))
  await save(page, /Save 1 page to queue/)
  await page.context().setOffline(false)
  await expect.poll(async () => (await documentsOf(q.id)).length, { timeout: 180_000 }).toBe(1)
  await expect(page.getByText('Nothing waiting')).toBeVisible({ timeout: 60_000 })

  // The visit: the device's UUIDv7, server start time, device time only in client_captured_at.
  const [visit] = await adminDb.select().from(encounters).where(and(eq(encounters.patientId, q.id), eq(encounters.offlineCreated, true)))
  expect(visit.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(Math.abs(visit.startedAt.getTime() - Date.now())).toBeLessThan(120_000)
  expect(Math.abs(visit.clientCapturedAt!.getTime() - skewed)).toBeLessThan(120_000)

  // A second capture with the clock put right, into the same visit, sent online as a desk capture.
  await page.clock.setFixedTime(new Date())
  await pick(page, q.name)
  await addPhotos(page, await photos(1))
  await save(page, /Save 1 page to queue/)
  await expect.poll(async () => (await documentsOf(q.id)).length, { timeout: 180_000 }).toBe(2)

  const docs = await adminDb.select().from(documents).where(eq(documents.patientId, q.id)).orderBy(documents.receivedAt)
  expect(docs).toHaveLength(2)
  const [a, b] = docs // a = sent first with the clock 3 days ahead, b = sent later with the right clock
  for (const d of docs) expect(d.encounterId).toBe(visit.id)
  expect([a.intakeRoute, b.intakeRoute]).toEqual(['offline_sync', 'desk'])
  expect(Math.abs(a.receivedAt.getTime() - Date.now())).toBeLessThan(180_000) // server clock, not the device's
  expect(a.clientCapturedAt!.getTime() - a.receivedAt.getTime()).toBeGreaterThan(2.9 * 86_400_000)
  expect(a.clientCapturedAt!.getTime()).toBeGreaterThan(b.clientCapturedAt!.getTime())
  expect(a.receivedAt.getTime()).toBeLessThan(b.receivedAt.getTime())
  // The record's time for each document is the server's (the list breaks ties on it); the device time is not shown.
  const listed = await records.get(`/api/patients/${q.id}/documents`)
  expect(listed.ok).toBe(true)
  const rows = listed.body.rows as { id: string; receivedAt: string; clientCapturedAt?: string }[]
  expect(Object.fromEntries(rows.map((r) => [r.id, r.receivedAt]))).toEqual({ [a.id]: a.receivedAt.toISOString(), [b.id]: b.receivedAt.toISOString() })
  expect(rows.every((r) => r.clientCapturedAt === undefined)).toBe(true)

  // Idempotent on the visit id; refused for another record; the desk cannot open visits this way.
  expect((await records.post(`/api/patients/${q.id}/encounters`, { id: visit.id })).body).toEqual({ id: visit.id, created: false })
  expect((await records.post(`/api/patients/${other.id}/encounters`, { id: visit.id })).status).toBe(409)
  expect((await records.post(`/api/patients/${q.id}/encounters`, { id: crypto.randomUUID() })).status).toBe(400) // v4: not a device id
  expect((await desk.post(`/api/patients/${q.id}/encounters`, { id: uuidv7() })).status).toBe(403)
  // FR-ID-02: an offline-opened visit verified nobody, so it opens nothing for the desk and is not on the desk's list.
  expect((await desk.get(`/api/patients/${q.id}/documents`)).body.error.code).toBe('verification_required')
  const deskList = await desk.get('/api/devices/capture-list')
  expect((deskList.body.items as { encounterId: string }[]).some((i) => i.encounterId === visit.id)).toBe(false)
  expect(deskList.body.recent).toEqual([])
  expect(((await records.get('/api/devices/capture-list')).body.items as { encounterId: string }[]).some((i) => i.encounterId === visit.id)).toBe(true)
})

// ── V05-E2E-05, FR-OFF-06 ────────────────────────────────────────────────────
test('V05-E2E-05 admin revokes the device on the devices page: uploads get 410 and the queue is wiped on next contact', async ({ staff, ui }) => {
  test.setTimeout(240_000)
  const desk = await staff('desk'), admin = await staff('admin')
  const p = await registerPatient(desk, { fullName: `E2E Revoke ${tag()}`, purposes: STORE_ONLY })
  const label = `E2E tablet ${tag()}`
  const page = await ui('desk')
  const sent = await track(page.context(), p.id)
  await page.goto('/capture')
  const deviceId = await setPin(page, label)
  await page.context().setOffline(true)
  await pick(page, p.name)
  await addPhotos(page, await photos(1))
  await save(page, /Save 1 page to queue/)
  await expect(queued(page, 'pending')).toHaveCount(1)

  // The admin page and its revoke route.
  expect((await desk.post(`/api/devices/${deviceId}/revoke`)).status).toBe(403)
  const adm = await ui('admin')
  await adm.goto('/admin/devices')
  const row = adm.getByRole('row').filter({ hasText: label })
  await expect(row.getByText('Active')).toBeVisible()
  await row.getByRole('button', { name: `Revoke ${label}` }).click()
  await adm.getByRole('button', { name: 'Revoke device' }).click()
  await expect(row.getByText('Revoked · wipe pending')).toBeVisible()
  expect((await admin.post(`/api/devices/${deviceId}/revoke`)).body).toEqual({ ok: true, alreadyRevoked: true })
  expect((await admin.post(`/api/devices/${uuidv7()}/revoke`)).status).toBe(404)

  // Every upload path refuses the revoked device.
  const jpeg = { name: 'p.jpg', mimeType: 'image/jpeg', buffer: await sharp(DOC).resize({ width: 900 }).jpeg().toBuffer() }
  const headers = { Origin: BASE, 'x-device-id': deviceId }
  const one = await desk.ctx.post(`/api/patients/${p.id}/documents`, { headers, multipart: { file: jpeg, clientFileId: `e2e-revoked-${tag()}`, intakeRoute: 'offline_sync' } })
  expect([one.status(), (await one.json()).error.code]).toEqual([410, 'device_revoked'])
  const start = await desk.ctx.post(`/api/patients/${p.id}/uploads`, { headers, data: { fileName: 'p.jpg', totalSize: 1000, totalChunks: 1, sha256: 'a'.repeat(64) } })
  expect([start.status(), (await start.json()).error.code]).toEqual([410, 'device_revoked'])
  const note = await desk.ctx.post(`/api/patients/${p.id}/audio-notes`, { headers, multipart: { file: { name: 'n.webm', mimeType: 'audio/webm', buffer: Buffer.from('x') }, clientFileId: uuidv7(), encounterId: uuidv7(), seconds: '1' } })
  expect(note.status()).toBe(410)

  // Next contact: the device wipes its key, queue and id before uploading anything.
  await page.context().setOffline(false)
  await expect(page.getByText('This device was switched off by an administrator')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Set a device PIN' })).toBeVisible()
  expect(await idbDatabases(page)).toEqual([])
  expect(await deviceIdOf(page)).toBeNull()
  expect(sent.seen).toHaveLength(0)
  await adm.reload()
  await expect(row.getByText('Revoked · wipe ordered')).toBeVisible()

  // A 410 device_revoked answer to an upload wipes the device too.
  await setPin(page, `E2E tablet ${tag()}`)
  await page.context().setOffline(true)
  await pick(page, p.name)
  await addPhotos(page, await photos(1))
  await save(page, /Save 1 page to queue/)
  await page.route('**/api/patients/*/uploads', (route) => route.fulfill({ status: 410, json: { error: { code: 'device_revoked', message: 'revoked' } } }))
  await page.context().setOffline(false)
  await expect(page.getByText('This device was switched off by an administrator')).toBeVisible()
  expect(await idbDatabases(page)).toEqual([])
})

// ── FR-OFF-05 ────────────────────────────────────────────────────────────────
test('FR-OFF-05 not installed and no persistent storage: both warnings show; installed with storage kept: neither', async ({ staff, browser }) => {
  const desk = await staff('desk')
  const open = async (installed: boolean) => {
    const ctx = await desk.browserContext(browser)
    await ctx.addInitScript((on) => {
      const mm = window.matchMedia.bind(window)
      window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? { ...mm(q), matches: on, media: q } : mm(q))
      Object.defineProperty(navigator.storage, 'persist', { value: () => { (window as unknown as { persistAsked: boolean }).persistAsked = true; return Promise.resolve(on) } })
    }, installed)
    const page = await ctx.newPage()
    await page.goto('/capture')
    await setPin(page, `E2E tablet ${tag()}`)
    await expect.poll(() => page.evaluate(() => (window as unknown as { persistAsked?: boolean }).persistAsked)).toBe(true) // navigator.storage.persist() requested
    return { ctx, page }
  }
  const bare = await open(false)
  await expect(bare.page.getByText('Install this app to protect unsynced captures')).toBeVisible()
  await expect(bare.page.getByText('This browser has not promised to keep this storage')).toBeVisible()
  await bare.ctx.close()
  const installed = await open(true)
  await expect(installed.page.getByRole('heading', { name: 'Photograph the pages' })).toBeVisible()
  await expect(installed.page.getByText('Install this app to protect unsynced captures')).toHaveCount(0)
  await expect(installed.page.getByText('This browser has not promised to keep this storage')).toHaveCount(0)
  // 375 px: no horizontal scroll
  await installed.page.setViewportSize({ width: 375, height: 812 })
  expect(await installed.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await installed.ctx.close()
})

// ── FR-ING-01 ────────────────────────────────────────────────────────────────
test('FR-ING-01 pages are cut to their edges (full photo kept), reordered, and retaken with the camera', async ({ staff }) => {
  test.setTimeout(180_000)
  const desk = await staff('desk')
  const p = await registerPatient(desk, { fullName: `E2E Pages ${tag()}`, purposes: STORE_ONLY })
  const dir = await mkdtemp(join(tmpdir(), 'oncosetu-offline-'))
  try {
    const ctx = await launch(dir)
    await signIn(ctx, desk)
    const page = await firstPage(ctx)
    await page.goto('/capture')
    await setPin(page, `E2E tablet ${tag()}`)
    await pick(page, p.name)
    // page 1 lies on a dark desk; page 2 is paper edge to edge
    const onDesk = join(FILES, `desk-${tag()}.jpg`), paper = join(FILES, `paper-${tag()}.jpg`)
    await sharp(DOC).extend({ top: 300, bottom: 300, left: 1200, right: 800, background: '#2f2a25' }).jpeg().toFile(onDesk) // landscape photo, portrait page
    await sharp(DOC).extract({ left: 160, top: 200, width: 1680, height: 2300 }).jpeg().toFile(paper)
    await addPhotos(page, [onDesk, paper])
    const items = page.getByRole('list', { name: 'Captured pages' }).getByRole('listitem')
    const src = (i: number) => items.nth(i).getByRole('img').getAttribute('src')
    const landscape = (i: number) => items.nth(i).getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth > img.naturalHeight)

    await expect(items.nth(0).getByText('Cut to the page')).toBeVisible()
    await expect(items.nth(1).getByText(/Cut to the page|Full photo/)).toHaveCount(0)
    expect(await landscape(0)).toBe(false) // the portrait page, without the desk
    await page.getByRole('button', { name: 'Use the full photo for page 1' }).click()
    await expect(items.nth(0).getByText('Full photo')).toBeVisible()
    await expect.poll(() => landscape(0)).toBe(true) // the whole landscape photo again
    await page.getByRole('button', { name: 'Use the cut page for page 1' }).click()
    await expect(items.nth(0).getByText('Cut to the page')).toBeVisible()

    // Reorder
    const [s1, s2] = [await src(0), await src(1)]
    await page.getByRole('button', { name: 'Move page 2 earlier' }).click()
    await expect.poll(async () => [await src(0), await src(1)]).toEqual([s2, s1])

    // Retake page 1 with the (fake) rear camera: same place, new picture.
    await page.getByRole('button', { name: 'Retake page 1' }).click()
    await expect(page.getByText('Retaking page 1')).toBeVisible()
    await expect.poll(() => page.getByLabel('Camera preview').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Capture page' }).click()
    await expect(items).toHaveCount(2)
    await expect.poll(() => src(0)).not.toBe(s2)
    expect(await src(1)).toBe(s1)
    await page.getByRole('button', { name: 'Delete page 2' }).click()
    await expect(items).toHaveCount(1)
    await ctx.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
