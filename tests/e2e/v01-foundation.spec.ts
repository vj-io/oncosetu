// V01-E2E-01..09 (PRD §13, v0.1 Foundation). Everything runs in the Ganga org with synthetic patients.
import { CONSENT_NOTICE_VERSION } from '../../src/i18n/consent'
import { createHash } from 'node:crypto'
import { ALL_PURPOSES, Api, anonymous, demoDoc, demoPatient, freshPhone, portalLogin, registerPatient, uploadAndWait, uploadDemo, uploadFile, waitDoc, waitForSms } from './helpers/api'
import { closeEncounters, consentsOf, documentsOf, smsAbout, smsTo } from './helpers/db'
import { EMAIL, PASSWORD } from './helpers/env'
import { createShare, parseCsv, seal, unparseableJavascriptPdf, withActiveContent } from './helpers/flows'
import { test, expect } from './helpers/fixtures'
import { diagnosisHits } from './helpers/text'
import { totpFor, wrongTotpFor } from './helpers/totp'

const ONCO = /onco/i

test('V01-E2E-01 staff logs in with TOTP; a wrong TOTP is rejected', async ({ page, anon }) => {
  const email = EMAIL.desk
  // Wrong code: refused with the same generic message as a wrong password, no session cookie.
  const bad = await (await anon()).post('/api/auth/staff/login', { data: { email, password: PASSWORD, totp: wrongTotpFor(email) } })
  expect(bad.status()).toBe(401)
  expect((await bad.json()).error.code).toBe('invalid_credentials')
  expect(bad.headers()['set-cookie'] ?? '').not.toContain('os_sid')

  // The real form: wrong code shows the alert and stays on /login; the right code signs in to the desk.
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByLabel('Authenticator code').fill(wrongTotpFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('p[role="alert"]')).toContainText('incorrect')
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel('Authenticator code').fill(totpFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/desk/)
  await expect(page.getByRole('heading', { name: 'Front desk' })).toBeVisible()
  const me = await (await page.request.get('/api/auth/me')).json()
  expect(me.session).toMatchObject({ kind: 'staff', role: 'desk', email })
})

test('V01-E2E-02 register a synthetic patient with consent per purpose; QR card carries no PHI', async ({ staff, ui }) => {
  const desk = await staff('desk')
  // "Keep and organise" is required: a registration without it is refused.
  await expect(registerPatient(desk, { base: 'returning', purposes: { store: false, ai: true, share: true, abdm: false, metrics: false } })).rejects.toThrow(/store_required/)

  const purposes = { store: true, ai: false, share: true, abdm: false, metrics: false }
  const p = await registerPatient(desk, { base: 'returning', purposes })
  const [consent] = await consentsOf(p.id)
  expect(consent).toMatchObject({ action: 'grant', method: 'desk_assisted', noticeVersion: CONSENT_NOTICE_VERSION })
  expect(consent.purposes).toEqual({ ...purposes, team: false }) // the tumour-board purpose (7 Nov) is stored as off when not asked

  // The card code is opaque: 128 random bits, no patient data in it.
  expect(p.token).toMatch(/^[A-Z2-7]{26}$/)
  const d = demoPatient('returning')
  const phi = [...d.fullName.toLowerCase().split(/\s+/), d.dob, d.dob.replace(/-/g, ''), p.phone!.replace(/\D/g, '').slice(-10)]
  for (const bit of phi) expect(p.token.toLowerCase()).not.toContain(bit)

  // The printable card (QR + grouped code) shows the same opaque code and nothing identifying.
  const page = await ui('desk')
  await page.goto(`/patients/${p.id}/card`)
  await page.getByRole('button', { name: 'Issue a replacement card' }).click() // the card is shown once: this tab never saw the plain code
  const card = page.getByRole('article', { name: 'Records card' })
  await expect(card.getByRole('img', { name: /QR code/ })).toBeVisible()
  const shown = (await card.locator('p.font-mono').first().innerText()).replace(/[-\s]/g, '')
  expect(shown).toMatch(/^[A-Z2-7]{26}$/)
  const cardText = (await card.innerText()).toLowerCase()
  for (const bit of [...d.fullName.toLowerCase().split(/\s+/), d.dob, p.phone!.replace(/\D/g, '').slice(-10)]) expect(cardText).not.toContain(bit)
  // The replaced card stops working; the new one identifies.
  const old = await desk.post('/api/desk/lookup', { mode: 'token', value: p.token })
  expect(old.body.status).toBe('revoked')
  const fresh = await desk.post('/api/desk/lookup', { mode: 'token', value: shown })
  expect(fresh.body.status).toBe('ok')
  expect(fresh.body.results).toHaveLength(1)
})

test('V01-E2E-03 a scan shows initials and "verification required"; an OTP opens the record', async ({ staff, ui }) => {
  const desk = await staff('desk')
  const p = await registerPatient(desk, { base: 'returning' })
  const d = demoPatient('returning')
  await closeEncounters(p.id) // a later visit: the registration encounter is over

  // Scan (typed card code): initials and an accession code only, never name, DOB or phone.
  const scan = await desk.post('/api/desk/lookup', { mode: 'token', value: p.token })
  expect(scan.body.results).toEqual([{ id: p.id, initials: 'MAR', accession: p.accession }])
  const raw = JSON.stringify(scan.body).toLowerCase()
  for (const bit of ['rahim', 'khan', d.dob, p.phone!.replace(/\D/g, '').slice(-10)]) expect(raw).not.toContain(bit)

  // Without verification the record cannot be opened by id: API and page both refuse.
  const byUrl = await desk.get(`/api/patients/${p.id}/documents`)
  expect([byUrl.status, byUrl.body.error.code]).toEqual([403, 'verification_required'])
  const page = await ui('desk')
  await page.goto(`/patients/${p.id}/overview`)
  await expect(page.getByText('Verify the patient first')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Rahim')

  // Desk screen: look up by phone, see only initials + "Verification required", send the code, open with the SMS code.
  await page.goto('/desk')
  await page.getByRole('tab', { name: 'Phone' }).click()
  await page.getByLabel('Phone', { exact: true }).fill(p.phone!)
  await page.getByRole('button', { name: 'Look up' }).click()
  await expect(page.getByText('Verification required').first()).toBeVisible()
  await expect(page.getByRole('list', { name: 'Matches' })).toContainText('MAR')
  await expect(page.locator('main')).not.toContainText('Rahim')
  const since = Date.now() - 1000
  await page.getByRole('button', { name: 'Send code' }).click()
  const sms = await waitForSms(p.phone!, since, (m) => m.templateKey === 'desk.otp')
  await page.getByLabel('Code from the SMS').fill(sms.body.match(/\b(\d{6})\b/)![1])
  await page.getByRole('button', { name: 'Verify and open' }).click()
  await expect(page).toHaveURL(new RegExp(`/patients/${p.id}/overview`))
  await expect(page.getByText('Verify the patient first')).toHaveCount(0)
  expect((await desk.get(`/api/patients/${p.id}/documents`)).status).toBe(200)
})

test('V01-E2E-04 upload 3 PDFs + 2 images, retrieve them; a duplicate is linked, not duplicated', async ({ staff }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const files = ['hero__01-discharge-summary.pdf', 'hero__02-chemo-daycare-cycle4.pdf', 'hero__04-prescription-printed.pdf', 'hero__03-ct-thorax-abdomen.jpg', 'hero__06-cbc-hindi.jpg']
  const ups = await Promise.all(files.map((f) => uploadDemo(records, p.id, f)))
  expect(new Set(ups.map((u) => u.documentId)).size).toBe(5)
  for (const u of ups) await waitDoc(records, u.documentId)

  const list = await records.get(`/api/patients/${p.id}/documents`)
  expect(list.body.rows).toHaveLength(5)
  expect(list.body.progress.documents).toBe(5)
  // Retrieval returns the stored original, byte for byte.
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  for (const [i, f] of files.entries()) {
    const got = await records.ctx.get(`/api/documents/${ups[i].documentId}/file`)
    expect(got.status()).toBe(200)
    expect(sha(await got.body())).toBe(sha(demoDoc(f).buffer))
  }
  // The same bytes again: linked to the first document, nothing new stored or processed.
  const again = await uploadDemo(records, p.id, files[0])
  expect(again.duplicateOf).toBe(ups[0].documentId)
  expect(again.documentId).toBe(ups[0].documentId)
  expect((await documentsOf(p.id)).length).toBe(5)
  expect((await records.get(`/api/patients/${p.id}/documents`)).body.rows).toHaveLength(5)
})

test('V01-E2E-05 a PDF with JavaScript or an embedded file is stripped and the clean copy kept; one that cannot be cleaned is quarantined', async ({ staff }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'returning', purposes: { ...ALL_PURPOSES, ai: false } }) // rules only: no LLM call
  // FR-ING-08: the active content is removed; the clean copy is what is stored, processed and served.
  const hostile = await withActiveContent(demoDoc('returning__01-discharge-summary.pdf').buffer)
  const clean = await uploadFile(records, p.id, { name: 'discharge.pdf', buffer: hostile })
  expect(clean.status).toBe('queued')
  const done = await waitDoc(records, clean.documentId)
  expect(done.status).not.toBe('quarantined')
  expect(done.events).toBeGreaterThan(0)
  const [kept] = await documentsOf(p.id)
  expect((kept.flags as { sanitised?: { removed: string[] } }).sanitised?.removed).toEqual(expect.arrayContaining(['pdf_JavaScript', 'pdf_EmbeddedFile', 'pdf_OpenAction']))
  const served = await (await records.ctx.get(`/api/documents/${clean.documentId}/file`)).body()
  expect(served.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  for (const s of ['/JavaScript', '/JS', '/OpenAction', '/EmbeddedFile', 'payload.exe']) expect(served.toString('latin1'), s).not.toContain(s)
  const again = await uploadFile(records, p.id, { name: 'discharge-again.pdf', buffer: hostile })
  expect(again.duplicateOf).toBe(clean.documentId) // sanitising is deterministic, so a re-upload still dedupes

  const bad = unparseableJavascriptPdf()
  const up = await uploadFile(records, p.id, { name: 'invoice.pdf', buffer: bad })
  expect(up.status).toBe('quarantined')
  const doc = (await documentsOf(p.id)).find((d) => d.id === up.documentId)!
  expect(doc.status).toBe('quarantined')
  expect((doc.flags as { quarantine?: { reasons: string[] } }).quarantine?.reasons).toEqual(expect.arrayContaining(['pdf_JavaScript']))
  // Kept encrypted, but not openable and not processed.
  const file = await records.get(`/api/documents/${up.documentId}/file`)
  expect([file.status, file.body.error.code]).toEqual([403, 'quarantined'])
  const st = await records.get(`/api/documents/${up.documentId}/status`)
  expect(st.body).toMatchObject({ status: 'quarantined', events: 0 })
  const reprocess = await records.post(`/api/documents/${up.documentId}/reprocess`)
  expect([reprocess.status, reprocess.body.error.message]).toEqual([409, expect.stringContaining('quarantined')])
  // The EICAR test file is refused outright.
  const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')
  const refused = await records.upload(`/api/patients/${p.id}/documents`, { name: 'eicar.com', buffer: eicar })
  expect(refused.status).toBe(422)
})

test('V01-E2E-06 another organisation cannot read a Ganga patient (API and page)', async ({ staff, browser }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'returning' })
  const up = await uploadFile(records, p.id, demoDoc('returning__01-discharge-summary.pdf'))
  await waitDoc(records, up.documentId)

  const outsider = await Api.login({ email: 'records@narmada.demo', password: 'Demo@2026' }) // the other organisation's records staff
  try {
    const probes: [string, number][] = [
      [`/api/patients/${p.id}/documents`, 404],
      [`/api/patients/${p.id}/snapshots`, 404],
      [`/api/documents/${up.documentId}/status`, 404],
      [`/api/documents/${up.documentId}/file`, 404],
    ]
    for (const [path, status] of probes) expect([path, (await outsider.get(path)).status]).toEqual([path, status])
    expect((await outsider.post(`/api/documents/${up.documentId}/reprocess`)).status).toBe(404)
    expect((await outsider.post(`/api/patients/${p.id}/seal`)).status).toBe(403) // role first: records cannot seal anywhere
    // Not even findable: the lookup by this patient's phone finds nothing in the other organisation.
    expect((await outsider.get(`/api/patients?q=${encodeURIComponent(p.phone!)}`)).body.patients).toEqual([])
    // The page is "not found", not "forbidden": the outsider learns nothing, not even that the id exists.
    const ctx = await outsider.browserContext(browser)
    const res = await (await ctx.newPage()).goto(`/patients/${p.id}/overview`)
    expect(res?.status()).toBe(404)
    await ctx.close()
  } finally { await outsider.dispose() }
  // Database level: row-level security is proven by tests/integration/rls.test.ts (npm run test:integration).
})

test('V01-E2E-07 consent withdrawn: the next request is denied and a share link answers 410', async ({ staff, ui, anon }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero' })
  const up = await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  await seal(clinician, p.id)
  const share = await createShare(records, p.id, { passcode: '482915' })
  const viewer = await anon() // the receiving doctor: no account
  const open = () => viewer.post(`/api/shares/${share.id}/open`, { data: { passcode: '482915' } })
  expect((await open()).status()).toBe(200)

  const w = await records.post(`/api/patients/${p.id}/consent`, { action: 'withdraw' })
  expect(w.ok).toBe(true)
  // Checked on use: everything that needs the record is refused from the very next request.
  for (const path of [`/api/patients/${p.id}/documents`, `/api/patients/${p.id}/share-payload`]) {
    const r = await records.get(path)
    expect([path, r.status, r.body.error.code]).toEqual([path, 403, 'consent_required'])
  }
  expect((await records.upload(`/api/patients/${p.id}/documents`, demoDoc('hero__02-chemo-daycare-cycle4.pdf'))).status).toBe(403)
  expect((await records.get(`/api/documents/${up.documentId}/file`)).status).toBe(403)
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/ledger`)
  await expect(page.getByText('No active consent for this patient')).toBeVisible()
  // The share link is gone for its viewer: 410 with a neutral message.
  const gone = await open()
  expect(gone.status()).toBe(410)
  expect((await gone.json()).error.message).toBe('This link is no longer available')
})

test('V01-E2E-08 the patient audit tab lists the actions; audit rows hold ids only (admin CSV export)', async ({ staff, ui }) => {
  const desk = await staff('desk'), records = await staff('records'), admin = await staff('admin')
  const p = await registerPatient(desk, { base: 'returning' })
  const d = demoPatient('returning')
  await desk.post('/api/desk/lookup', { mode: 'token', value: p.token })
  const first = await uploadAndWait(records, p.id, 'returning__01-discharge-summary.pdf')
  await uploadDemo(records, p.id, 'returning__01-discharge-summary.pdf') // duplicate
  const js = await uploadFile(records, p.id, { name: 'scan.pdf', buffer: unparseableJavascriptPdf() })
  await records.get(`/api/documents/${first.documentId}/file`) // viewing a document is an action too

  const page = await ui('records')
  await page.goto(`/patients/${p.id}/audit`)
  await expect(page.getByText('Audit trail for this patient')).toBeVisible()
  await expect(page.getByText(/Chain intact/)).toBeVisible()
  const table = page.getByRole('table')
  for (const action of ['patient.registered', 'consent.recorded', 'patient.token_issued', 'desk.lookup', 'document.upload', 'document.duplicate_upload', 'document.quarantined', 'document.view']) {
    await expect(table.getByText(action, { exact: true }).first(), action).toBeVisible()
  }

  const csv = await admin.get('/api/admin/audit.csv')
  expect(csv.status).toBe(200)
  const rows = parseCsv(csv.body as string)
  const mine = rows.filter((r) => [p.id, first.documentId, js.documentId].includes(r.target_id) || r.details.includes(p.id))
  const actions = new Set(mine.map((r) => r.action))
  for (const a of ['patient.registered', 'consent.recorded', 'patient.token_issued', 'desk.lookup', 'document.upload', 'document.duplicate_upload', 'document.quarantined', 'document.view']) expect(actions, a).toContain(a)
  // Ids and enums only: no names, phone numbers, dates of birth or file names anywhere in these rows.
  const dump = JSON.stringify(mine).toLowerCase()
  for (const bit of [...d.fullName.toLowerCase().split(/\s+/), ...d.aliases.map((a) => a.toLowerCase()), d.dob, p.phone!.replace(/\D/g, '').slice(-10), 'returning__01', 'scan.pdf']) expect(dump).not.toContain(bit)
  for (const r of mine) for (const v of Object.values(JSON.parse(r.details) as Record<string, unknown>)) for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string') expect(x).not.toMatch(/[\s@]/)
})

test('V01-E2E-09 caregiver-primary, disclosure unknown: codes go to the caregiver; nothing patient-facing hints at the diagnosis', async ({ staff, browser }) => {
  const desk = await staff('desk')
  const own = freshPhone()
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'caregiver', disclosure: 'unknown', phone: own, confirm: 'otp' })
  expect(p.caregiverPhone).toBeTruthy()
  await closeEncounters(p.id)

  // Consent code (registration) and desk code both went to the caregiver's phone, none to the patient's.
  const since = Date.now() - 1000
  expect((await desk.post('/api/desk/verify/start', { patientId: p.id })).ok).toBe(true)
  const deskSms = await waitForSms(p.caregiverPhone!, since, (m) => m.templateKey === 'desk.otp')
  expect(deskSms.body).toMatch(/\b\d{6}\b/)
  const toCaregiver = await smsTo(p.caregiverPhone!)
  expect(toCaregiver.map((m) => m.templateKey)).toEqual(expect.arrayContaining(['consent.otp', 'desk.otp']))
  expect(await smsTo(own)).toEqual([])

  // The patient's own phone cannot open the portal while the caregiver is primary; the caregiver's can.
  const ctx = await anonymous()
  await ctx.post('/api/auth/patient/otp/start', { data: { phone: own } })
  await new Promise((r) => setTimeout(r, 1000))
  expect(await smsTo(own)).toEqual([])
  await ctx.dispose()
  const portal = await portalLogin(p.caregiverPhone!)
  expect((await portal.get('/api/auth/me')).body.session.kind).toBe('caregiver')

  // Every SMS and every portal screen (English and Hindi): no diagnosis words, no "Onco", brand "Setu Records".
  for (const m of await smsAbout(p.id)) {
    expect([m.templateKey, diagnosisHits(m.body)]).toEqual([m.templateKey, []])
    expect(m.body).not.toMatch(ONCO)
  }
  const bctx = await portal.browserContext(browser)
  const page = await bctx.newPage()
  for (const path of ['/p', '/p/upload', '/p/consent', '/p/requests', '/p/share', '/p/visit', '/p/access']) {
    for (const lang of ['en', 'hi']) {
      await page.goto(`${path}?lang=${lang}`)
      const text = await page.locator('body').innerText()
      expect([path, lang, diagnosisHits(text)]).toEqual([path, lang, []])
      expect([path, lang, ONCO.test(text)]).toEqual([path, lang, false])
    }
  }
  await page.goto('/p')
  await expect(page.locator('body')).toContainText('Setu Records')
  await bctx.close()
})
