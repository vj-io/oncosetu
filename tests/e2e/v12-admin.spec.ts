// Admin, identity and request gaps closed on 8 Nov 2026, end to end against a running server in the Ganga org:
// FR-ADM-01 staff management · FR-ADM-02 audit filters · FR-ADM-04 retention floor and the erasure cron · FR-ID-09 staff
// session limits · FR-REQ-04 the requests cron · FR-REQ-06 institution type and its export · FR-ID-07 ABHA status.
// The erasure-cron test runs in the serial `clock` project: the cron executes every due request in every org.
import { randomInt, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { erasureRequests, orgSettings, patients, recordRequests, sessions, staff as staffTable } from '../../src/db/schema'
import { sha256Hex } from '../../src/server/crypto'
import { ORG_NARMADA_ID } from '../../src/server/demo'
import { abhaHmac } from '../../src/server/registration/duplicates'
import { totp } from '../../src/server/totp'
import { anonymous, Api, portalLogin, registerPatient } from './helpers/api'
import { auditOf, patientRow, smsTo, staffId } from './helpers/db'
import { BASE, EMAIL, NARMADA_RECORDS, ORG } from './helpers/env'
import { test, expect } from './helpers/fixtures'
import { parseCsv } from './helpers/flows'
import { diagnosisHits } from './helpers/text'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set`)
  return v
}
const istDay = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10)
const DAY = 86_400_000
const cron = async (path: string) => {
  const c = await anonymous()
  try {
    const denied = (await c.get(path)).status()
    const r = await c.get(path, { headers: { authorization: `Bearer ${env('CRON_SECRET')}` } })
    return { denied, status: r.status(), body: await r.json() }
  } finally { await c.dispose() }
}

test('FR-ADM-01 staff accounts: create, sign in, change role, reset the authenticator, deactivate and reactivate', async ({ staff }) => {
  const admin = await staff('admin'), records = await staff('records')
  const email = `itest-${randomUUID().slice(0, 8)}@ganga.test`, password = `Pw-${randomUUID()}`
  const body = { name: 'Test Desk Person', email, role: 'desk', password }
  expect((await records.post('/api/admin/staff', body)).status).toBe(403) // org_admin only
  const made = await admin.post('/api/admin/staff', body)
  expect(made.status).toBe(200)
  const id: string = made.body.id
  const secret1: string = made.body.enrollment.secret
  expect(secret1).toMatch(/^[A-Z2-7]{16,}$/)
  expect(made.body.enrollment.qrDataUrl).toMatch(/^data:image\/png;base64,/)
  expect((await admin.post('/api/admin/staff', { ...body, email: email.toUpperCase() })).body.error.code).toBe('email_taken')
  const [row] = await adminDb.select().from(staffTable).where(eq(staffTable.id, id))
  expect(row).toMatchObject({ orgId: ORG, role: 'desk', active: true, totpEnabled: true })
  expect(row.totpSecretEnc).not.toContain(secret1) // only the encrypted secret is kept
  expect(row.passwordHash).not.toContain(password)

  const contexts: Awaited<ReturnType<typeof anonymous>>[] = []
  // aheadMs: a later step's code (the window accepts +1 step); code: send exactly this code again
  const signIn = async (secret: string, aheadMs = 0, code = totp(secret, Date.now() + aheadMs)) => {
    const c = await anonymous()
    contexts.push(c)
    const status = (await c.post('/api/auth/staff/login', { data: { email, password, totp: code } })).status()
    return { c, status, me: async () => { const r = await c.get('/api/auth/me'); return { status: r.status(), role: r.ok() ? (await r.json()).session.role : null } } }
  }
  try {
    const first = await signIn(secret1)
    expect(first.status).toBe(200)
    expect(await first.me()).toEqual({ status: 200, role: 'desk' })

    // A role change takes effect on the session's next request.
    expect((await admin.post(`/api/admin/staff/${id}`, { action: 'set_role', role: 'records' })).ok).toBe(true)
    expect(await first.me()).toEqual({ status: 200, role: 'records' })

    // A new authenticator: the old secret stops working and live sessions end.
    const reset = await admin.post(`/api/admin/staff/${id}`, { action: 'reset_totp' })
    const secret2: string = reset.body.enrollment.secret
    expect(secret2).not.toBe(secret1)
    expect((await first.me()).status).toBe(401)
    expect((await signIn(secret1)).status).toBe(401)
    const code2 = totp(secret2, Date.now())
    const second = await signIn(secret2, 0, code2)
    expect(second.status).toBe(200)
    // ASVS 2.8.4: the same code a second time is refused (a real authenticator, not a seeded public secret)
    expect((await signIn(secret2, 0, code2)).status).toBe(401)

    // Deactivated: signed out at once and cannot sign in; reactivated: can again.
    expect((await admin.post(`/api/admin/staff/${id}`, { action: 'deactivate' })).ok).toBe(true)
    expect((await second.me()).status).toBe(401)
    expect((await signIn(secret2)).status).toBe(401)
    expect((await admin.post(`/api/admin/staff/${id}`, { action: 'reactivate' })).ok).toBe(true)
    expect((await signIn(secret2, 30_000)).status).toBe(200) // the next step's code

    // Guards: not oneself, and another organisation's account looks like a missing one.
    expect((await admin.post(`/api/admin/staff/${await staffId(EMAIL.admin)}`, { action: 'deactivate' })).body.error.code).toBe('self_deactivate')
    expect((await admin.post(`/api/admin/staff/${await staffId(NARMADA_RECORDS)}`, { action: 'deactivate' })).status).toBe(404)
    expect((await records.post(`/api/admin/staff/${id}`, { action: 'deactivate' })).status).toBe(403)

    // Every change is in the audit trail, as ids and codes.
    for (const a of ['staff.create', 'staff.role_change', 'staff.totp_reset', 'staff.deactivate', 'staff.reactivate']) expect(await auditOf(id, a)).toHaveLength(1)
    expect((await auditOf(id, 'staff.role_change'))[0].details).toEqual({ from: 'desk', to: 'records' })
    expect(JSON.stringify(await auditOf(id, 'staff.create'))).not.toContain(email)
  } finally {
    await admin.post(`/api/admin/staff/${id}`, { action: 'deactivate' })
    await Promise.all(contexts.map((c) => c.dispose()))
  }
})

test('ASVS 3.3.3 / 3.3.4 a staff member sees where they are signed in and ends the other sign-ins', async ({ staff, browser }) => {
  const admin = await staff('admin')
  const email = `itest-${randomUUID().slice(0, 8)}@ganga.test`, password = `Pw-${randomUUID()}`
  const made = await admin.post('/api/admin/staff', { name: 'Test Sessions Person', email, role: 'desk', password })
  expect(made.status).toBe(200)
  const secret: string = made.body.enrollment.secret
  const signIn = async (aheadMs: number) => { // a real authenticator: each sign-in needs a code from a later step
    const c = await anonymous()
    expect((await c.post('/api/auth/staff/login', { data: { email, password, totp: totp(secret, Date.now() + aheadMs) } })).status()).toBe(200)
    return c
  }
  const here = await signIn(0), lost = await signIn(30_000) // "lost": a phone left signed in
  try {
    const list = await (await here.get('/api/auth/sessions')).json()
    expect(list.sessions).toHaveLength(2)
    expect(list.sessions.filter((x: { current: boolean }) => x.current)).toHaveLength(1)
    expect((await (await lost.get('/api/auth/sessions')).json()).sessions).toHaveLength(2)

    const page = await (await browser.newContext({ storageState: await here.storageState(), baseURL: BASE })).newPage()
    await page.goto('/account/sessions')
    await expect(page.getByRole('heading', { name: 'Where you are signed in' })).toBeVisible()
    await expect(page.getByText('This browser')).toHaveCount(1)
    await page.getByRole('button', { name: 'Sign out everywhere else' }).click()
    await expect(page.getByText('Signed out everywhere else')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out everywhere else' })).toBeDisabled()
    await page.context().close()

    expect((await lost.get('/api/auth/me')).status()).toBe(401) // the other sign-in ended
    expect((await here.get('/api/auth/me')).status()).toBe(200) // this one stays
    expect(await auditOf(made.body.id, 'auth.sessions_revoked')).toHaveLength(1)
  } finally {
    await here.dispose(); await lost.dispose()
    await admin.post(`/api/admin/staff/${made.body.id}`, { action: 'deactivate' })
  }
})

test('FR-ADM-02 audit filters (actor, action, type, from, to) narrow both the CSV export and the viewer', async ({ staff, ui }) => {
  const admin = await staff('admin'), records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const recordsId = await staffId(EMAIL.records), deskId = await staffId(EMAIL.desk)
  const today = istDay(Date.now()), tomorrow = istDay(Date.now() + DAY), yesterday = istDay(Date.now() - DAY)
  const csv = async (q: Record<string, string>) => {
    const r = await admin.get(`/api/admin/audit.csv?${new URLSearchParams(q)}`)
    expect(r.status).toBe(200)
    return parseCsv(r.body as string)
  }
  const mine = (rows: Record<string, string>[]) => rows.filter((r) => r.target_id === p.id && r.action === 'patient.registered')

  const all = { actor: recordsId, action: 'patient.registered', type: 'patient', from: today, to: today }
  const rows = await csv(all)
  expect(mine(rows)).toHaveLength(1)
  for (const r of rows) expect([r.actor_id, r.action, r.target_type]).toEqual([recordsId, 'patient.registered', 'patient'])
  expect(mine(await csv({ ...all, actor: deskId }))).toHaveLength(0)
  expect(mine(await csv({ ...all, action: 'consent.recorded' }))).toHaveLength(0)
  expect(mine(await csv({ ...all, type: 'document' }))).toHaveLength(0)
  expect(await csv({ ...all, from: tomorrow, to: tomorrow })).toEqual([])
  expect(mine(await csv({ ...all, from: yesterday, to: yesterday }))).toHaveLength(0)
  expect(mine(await csv({ action: 'patient.registered', from: today }))).toHaveLength(1) // filters combine; the rest are optional
  expect(mine(await csv({ ...all, actor: 'not-an-id', from: 'not-a-date' }))).toHaveLength(1) // malformed values are ignored, never interpolated

  // The viewer applies the same filters from the query string.
  const page = await ui('admin')
  await page.goto(`/admin/audit?${new URLSearchParams(all)}`)
  await expect(page.getByRole('status').filter({ hasText: /entries · page 1 of/ })).toBeVisible()
  const entries = page.getByRole('table', { name: 'Audit entries, newest first' }).locator('tbody tr')
  await expect(entries.filter({ has: page.locator(`[title="${p.id}"]`) })).toHaveCount(1)
  for (const action of await entries.locator('td:nth-child(4)').allTextContents()) expect(action).toBe('Patient registered')
  await page.goto(`/admin/audit?${new URLSearchParams({ ...all, from: tomorrow, to: tomorrow })}`)
  await expect(page.getByText('No audit entries match')).toBeVisible()
  // The export link carries the same filters.
  await page.goto(`/admin/audit?${new URLSearchParams(all)}`)
  const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href')
  expect(Object.fromEntries(new URL(href!, 'http://x').searchParams)).toEqual(all)
})

test('FR-ADM-04 retention shorter than 3 years is refused; the per-org AI limit is saved and audited', async ({ staff }) => {
  const admin = await staff('admin'), records = await staff('records')
  const [before] = await adminDb.select().from(orgSettings).where(eq(orgSettings.orgId, ORG))
  try {
    expect(await admin.post('/api/admin/settings', { retentionDays: 1094 }).then((r) => [r.status, r.body.error.code])).toEqual([400, 'retention_too_short'])
    expect(await admin.post('/api/admin/settings', { retentionDays: 30 }).then((r) => r.status)).toBe(400)
    expect((await records.post('/api/admin/settings', { retentionDays: 4000 })).status).toBe(403)
    expect((await admin.post('/api/admin/settings', { retentionDays: 1095 })).ok).toBe(true)
    expect((await adminDb.select().from(orgSettings).where(eq(orgSettings.orgId, ORG)))[0].retentionDays).toBe(1095)

    const budget = { calls: before.llmDailyCalls + 7, tokens: before.llmDailyTokens + 7 }
    expect((await admin.post('/api/admin/settings', { llmBudget: { calls: -1, tokens: 5 } })).status).toBe(400)
    expect((await admin.post('/api/admin/settings', { llmBudget: budget })).ok).toBe(true)
    expect((await adminDb.select().from(orgSettings).where(eq(orgSettings.orgId, ORG)))[0]).toMatchObject({ llmDailyCalls: budget.calls, llmDailyTokens: budget.tokens })
    const audit = (await auditOf(ORG, 'settings.llm_budget')).map((r) => r.details as { to: number[] })
    expect(audit.some((d) => d.to[0] === budget.calls && d.to[1] === budget.tokens)).toBe(true)
  } finally {
    await adminDb.update(orgSettings).set({ retentionDays: before.retentionDays, llmDailyCalls: before.llmDailyCalls, llmDailyTokens: before.llmDailyTokens })
      .where(eq(orgSettings.orgId, ORG))
  }
})

test('FR-ID-09 a staff session lasts 12 hours at most and ends after 30 minutes idle (real time)', async () => {
  const api = await Api.login('records')
  try {
    const token = (await api.ctx.storageState()).cookies.find((c) => c.name === 'os_sid')!.value
    const where = eq(sessions.tokenHash, sha256Hex(token))
    const [s] = await adminDb.select().from(sessions).where(where)
    expect(s.idleTimeoutS).toBe(30 * 60)
    expect(Math.abs(+s.expiresAt - +s.createdAt - 12 * 3_600_000)).toBeLessThan(60_000)
    const me = async () => (await api.get('/api/auth/me')).status
    expect(await me()).toBe(200)

    await adminDb.update(sessions).set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) }).where(where) // 31 min idle
    expect(await me()).toBe(401)
    await adminDb.update(sessions).set({ lastSeenAt: new Date(Date.now() - 29 * 60_000) }).where(where) // 29 min: still fine
    expect(await me()).toBe(200)

    // Active all along, but the 12 hours are up.
    await adminDb.update(sessions).set({ createdAt: new Date(Date.now() - 12 * 3_600_000 - 60_000), expiresAt: new Date(Date.now() - 60_000), lastSeenAt: new Date() }).where(where)
    expect(await me()).toBe(401)
  } finally {
    await api.dispose()
  }
})

test('FR-REQ-04/06 the daily requests cron sends the day-7 reminder unread; the kind of place feeds metrics and the export', async ({ staff, ui }) => {
  const records = await staff('records'), admin = await staff('admin')
  const p = await registerPatient(records, { base: 'hero', primaryContact: 'patient' })

  // The request builder asks for the kind of place (not printed on the letter).
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/requests`)
  await page.getByRole('button', { name: 'New request' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Hospital or clinic').fill('Sahyadri Specialty Hospital')
  await dialog.getByLabel('Kind of place').selectOption({ label: 'Private hospital' })
  await dialog.getByRole('button', { name: 'Create letter' }).click()
  await expect(dialog.getByRole('link', { name: 'Letter · English' })).toBeVisible()
  const [req] = await adminDb.select().from(recordRequests).where(eq(recordRequests.patientId, p.id))
  expect(req).toMatchObject({ institution: 'Sahyadri Specialty Hospital', institutionType: 'private', state: 'drafted' })
  expect((await records.post('/api/requests', { patientId: p.id, institution: 'X Hospital', institutionType: 'palace', lang: 'en' })).status).toBe(400)

  // Given to the hospital 8 days ago; nobody opens a request list afterwards.
  expect((await records.post(`/api/requests/${req.id}/sent`, { sentOn: istDay(Date.now() - 8 * DAY) })).body.state).toBe('sent')
  const run = await cron('/api/cron/requests')
  expect([run.denied, run.status]).toEqual([401, 200])
  expect(run.body.patients[ORG]).toBeGreaterThanOrEqual(1)
  const reminders = async () => (await smsTo(p.phone!)).filter((m) => m.templateKey === 'request.reminder7')
  const [sms] = await reminders()
  expect(sms).toBeTruthy()
  expect(diagnosisHits(sms.body)).toEqual([])
  expect((await adminDb.select().from(recordRequests).where(eq(recordRequests.id, req.id)))[0].state).toBe('reminder_due')
  await cron('/api/cron/requests') // tomorrow's run: nothing twice
  expect(await reminders()).toHaveLength(1)

  // The export: ids, kind of place, state and dates only. Staff without the role get 403.
  expect((await records.get('/api/measure/requests.csv')).status).toBe(403)
  const exported = await admin.get('/api/measure/requests.csv')
  expect(exported.status).toBe(200)
  expect(exported.body as string).not.toContain('Sahyadri')
  expect(exported.body as string).not.toContain(p.id)
  expect(parseCsv(exported.body as string).find((r) => r.request_id === req.id)).toEqual({
    request_id: req.id, institution_type: 'private', state: 'reminder_due', created_on: istDay(Date.now()), sent_on: istDay(Date.now() - 8 * DAY),
    fulfilled_on: '', days_to_fulfilment: '',
  })
  const metrics = await ui('admin')
  await metrics.goto('/admin/metrics')
  await expect(metrics.getByRole('table', { name: 'By institution type' }).getByRole('row', { name: /Private hospital/ })).toBeVisible()
  await expect(metrics.getByRole('heading', { name: 'From arrival to the clinician opening the record' })).toBeVisible()
})

test('FR-ID-07 one ABHA links both orgs\' records to one person; the overview shows the ABHA status and nothing about the other org', async ({ staff, ui }) => {
  const records = await staff('records')
  const digits = `00${randomInt(10 ** 11, 10 ** 12 - 1)}`.padEnd(14, '0').slice(0, 14) // synthetic, 00- prefix
  const p = await registerPatient(records, { base: 'hero', abhaNumber: digits })
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/overview`)
  const status = page.getByTestId('abha-status')
  await expect(status).toContainText('ABHA on file (unverified)')

  // The same ABHA becomes a patient of another organisation (written directly: E2E never registers in Narmada).
  const twin = randomUUID()
  await adminDb.insert(patients).values({ id: twin, orgId: ORG_NARMADA_ID, oncosetuTokenHash: `t-${twin}`, nameEnc: 'v1.x', abhaHmac: abhaHmac(digits) })
  try {
    const [mine, theirs] = await Promise.all([patientRow(p.id), patientRow(twin)])
    expect(mine.personId).not.toBeNull()
    expect(theirs.personId).toBe(mine.personId)
    await page.reload()
    await expect(status).toHaveText('ABHA on file (unverified).') // PRD §10.3: no hint of the other org without the patient's consent
    await expect(page.locator('main')).not.toContainText(/Narmada|registered at another/i)
  } finally {
    await adminDb.delete(patients).where(eq(patients.id, twin))
  }
})

test('FR-ADM-04 the daily erasure cron executes a request once it is due @clock', async ({ staff }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero', primaryContact: 'patient' })
  const patient = await portalLogin(p.phone!)
  try {
    expect((await patient.post('/api/p/consent', { withdraw: true })).ok).toBe(true)
    const asked = await patient.post('/api/p/erasure')
    expect(asked.body).toMatchObject({ state: 'queued', created: true })
    const requestId: string = asked.body.id

    const early = await cron('/api/cron/erasure') // not due yet: left alone
    expect([early.denied, early.status]).toEqual([401, 200])
    expect((await patientRow(p.id)).status).not.toBe('erased')

    await adminDb.update(erasureRequests).set({ eligibleAfter: new Date(Date.now() - 60_000) }).where(eq(erasureRequests.id, requestId))
    const run = await cron('/api/cron/erasure')
    expect(run.body.orgs[ORG].executed).toBeGreaterThanOrEqual(1)
    expect(await patientRow(p.id)).toMatchObject({ status: 'erased', nameEnc: '', phoneHmac: null })
    expect((await adminDb.select().from(erasureRequests).where(and(eq(erasureRequests.id, requestId), eq(erasureRequests.state, 'completed'))))).toHaveLength(1)
    const [done] = await auditOf(requestId, 'erasure.executed')
    expect(done.actorRole).toBe('system')
  } finally {
    await patient.dispose()
  }
})
