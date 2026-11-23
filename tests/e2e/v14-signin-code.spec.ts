// FR-ID-02 in person, FR-ING-03: where no SMS reaches the patient, staff show a one-time sign-in code on screen ("Give
// sign-in code"). The patient signs in on their own phone with it and sends a paper. That paper is stored once: the
// clinician and the patient (from the portal) open the same original, byte for byte; another patient cannot open it, and
// a paper the caregiver sent opens for the patient only once disclosure is cleared (FR-CON-07).
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { documentFiles } from '../../src/db/schema'
import { ALL_PURPOSES, anonymous, demoDoc, freshPhone, portalLogin, registerPatient, waitDoc } from './helpers/api'
import { auditOf, documentsOf, smsTo } from './helpers/db'
import { test, expect } from './helpers/fixtures'

test('FR-ID-02 the desk gives a sign-in code; the patient signs in with it, sends a paper; doctor and patient open the same stored file', async ({ staff, ui, browser }) => {
  const desk = await staff('desk')
  // AI reading off: the paper is only stored and read by the rule library, so the test needs no LLM call.
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'patient', withCaregiver: true, purposes: { ...ALL_PURPOSES, ai: false } })
  const since = new Date(Date.now() - 1000)

  // Desk screen: six digits and the phone's last four; nothing is texted, the issue is audited.
  const deskPage = await ui('desk')
  await deskPage.goto(`/patients/${p.id}/overview`)
  await deskPage.getByRole('button', { name: 'Give sign-in code' }).click()
  const panel = deskPage.getByTestId('signin-code-panel')
  await expect(panel).toContainText(p.phone!.replace(/\D/g, '').slice(-4))
  await expect(panel).toContainText('/p/login')
  const code = (await deskPage.getByTestId('signin-code').textContent())!.trim()
  expect(code).toMatch(/^\d{6}$/)
  expect((await smsTo(p.phone!)).filter((m) => m.createdAt >= since && m.templateKey === 'auth.otp')).toEqual([])
  expect(await auditOf(p.id, 'auth.signin_code_issued')).toHaveLength(1)

  // The patient's own phone: the number, "I have a code from the front desk" (asking for an SMS would replace it), the digits.
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/p/login?lang=en')
  await page.getByTestId('use-code').click() // the page opens on phone + password; a first sign-in uses a code
  await page.getByLabel('Mobile number').fill(p.phone!)
  await page.getByTestId('have-desk-code').click()
  await expect(page.getByText('Enter the 6-digit code the clinic front desk gave you.')).toBeVisible()
  await page.getByLabel('6-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/p(\?.*)?$/)

  // ...and sends a paper through the portal's own form.
  await page.goto('/p/upload?lang=en')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose files' }).click()
  const file = demoDoc('hero__04-prescription-printed.pdf')
  await (await chooser).setFiles({ name: file.name, mimeType: 'application/pdf', buffer: file.buffer })
  await expect(page.getByText('Received. The clinic team will check it.')).toBeVisible()
  const docs = (await documentsOf(p.id)).filter((d) => d.intakeRoute === 'patient_link')
  expect(docs).toHaveLength(1)
  const doc = docs[0]
  expect(doc).toMatchObject({ uploadedByKind: 'patient', uploadedById: p.id })

  // The code worked once: a second sign-in with it is refused.
  const again = await desk.ctx.post('/api/auth/patient/otp/verify', { data: { phone: p.phone, code } })
  expect(again.status()).toBe(401)

  // The clinician finds the paper in the record (filed, or held for a person to check its name).
  const records = await staff('records')
  const settled = await waitDoc(records, doc.id)
  const doctor = await ui('clinician')
  await doctor.goto(`/patients/${p.id}/documents`)
  await expect(doctor.getByTestId('doc-counts')).toHaveText(/^(1 filed · 0 held|0 filed · 1 held)/)
  if ((await documentsOf(p.id))[0].attachState === 'pending_decision') {
    expect((await records.post(`/api/documents/${doc.id}/attach`, { decision: 'attach', reason: 'Name checked on the page by eye' })).ok).toBe(true)
  }
  expect(settled.status).not.toBe('quarantined')

  // One stored original. The doctor and the patient (from the portal's own link) both get exactly those bytes.
  const originals = await adminDb.select().from(documentFiles).where(and(eq(documentFiles.documentId, doc.id), eq(documentFiles.kind, 'original')))
  expect(originals).toHaveLength(1)
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  const byDoctor = await records.ctx.get(`/api/documents/${doc.id}/file`)
  expect(byDoctor.status()).toBe(200)
  expect(sha(await byDoctor.body())).toBe(doc.sha256)
  await page.goto('/p?lang=en')
  const open = page.getByTestId('open-paper')
  await expect(open).toHaveCount(1)
  const byPatient = await page.request.get((await open.getAttribute('href'))!)
  expect(byPatient.status()).toBe(200)
  expect(sha(await byPatient.body())).toBe(doc.sha256)

  // FR-CON-07: a paper the caregiver sent can name the diagnosis, so the patient (not yet told) cannot open it; the
  // caregiver can open their own, not the patient's. Once a clinician clears disclosure, the patient opens it too.
  const caregiver = await portalLogin(p.caregiverPhone!)
  const cgUp = await caregiver.upload('/api/p/documents', { ...demoDoc('hero__10-histopathology-later.pdf'), mimeType: 'application/pdf' })
  expect(cgUp.ok).toBe(true)
  const cgDoc = (await documentsOf(p.id)).find((d) => d.uploadedByKind === 'caregiver')!
  await waitDoc(records, cgDoc.id)
  if ((await documentsOf(p.id)).find((d) => d.id === cgDoc.id)!.attachState === 'pending_decision') {
    expect((await records.post(`/api/documents/${cgDoc.id}/attach`, { decision: 'attach', reason: 'Name checked on the page by eye' })).ok).toBe(true)
  }
  expect((await page.request.get(`/api/documents/${cgDoc.id}/file`)).status()).toBe(404)
  await page.goto('/p?lang=en')
  await expect(page.getByTestId('open-paper')).toHaveCount(1) // their own paper only
  expect((await caregiver.ctx.get(`/api/documents/${cgDoc.id}/file`)).status()).toBe(200)
  expect((await caregiver.ctx.get(`/api/documents/${doc.id}/file`)).status()).toBe(404)
  await caregiver.dispose()
  const clinician = await staff('clinician')
  expect((await clinician.post(`/api/patients/${p.id}/disclosure`, { status: 'cleared', reason: 'patient_informed' })).ok).toBe(true)
  expect((await page.request.get(`/api/documents/${cgDoc.id}/file`)).status()).toBe(200)
  await ctx.close()

  // Another patient (C) opens only their own file: A's paper is not found for them, and not listed.
  const c = await registerPatient(desk, { base: 'hero', primaryContact: 'patient', purposes: { ...ALL_PURPOSES, ai: false } })
  const other = await portalLogin(c.phone!)
  expect((await other.ctx.get(`/api/documents/${doc.id}/file`)).status()).toBe(404)
  const otherPage = await (await other.browserContext(browser)).newPage()
  await otherPage.goto('/p?lang=en')
  await expect(otherPage.getByTestId('open-paper')).toHaveCount(0)
  await otherPage.context().close()
  await other.dispose()
})

test('a patient registered without a mobile number gets one added at the desk (in person); then the sign-in code works', async ({ staff, ui }) => {
  const desk = await staff('desk')
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'patient', withCaregiver: false, phone: null, purposes: { ...ALL_PURPOSES, ai: false } })
  const noPhone = await desk.post(`/api/patients/${p.id}/signin-code`)
  expect(noPhone.status).toBe(409)
  expect(noPhone.body.error.message).toContain('Consent & access')

  // Consent & access → Caregivers and contact: the number is saved only once the in-person box is ticked.
  const page = await ui('desk')
  await page.goto(`/patients/${p.id}/overview`)
  await expect(page.getByTestId('portal-signin')).toHaveText('No mobile number: add one')
  await page.goto(`/patients/${p.id}/consent`)
  const box = page.getByTestId('patient-phone')
  await expect(box).toContainText('No mobile number on file')
  const phone = freshPhone()
  await box.getByLabel('Mobile number').fill(phone)
  await expect(box.getByRole('button', { name: 'Add number' })).toBeDisabled()
  await box.getByLabel('The patient is here in person and told me this number is theirs.').check()
  await box.getByRole('button', { name: 'Add number' }).click()
  await expect(box).toContainText('Mobile number saved.')
  await expect(box).toContainText(phone.replace(/\D/g, '').slice(-4))
  expect((await auditOf(p.id, 'patient.phone_changed'))[0]?.details).toMatchObject({ hadPhone: false, oldNotified: false, method: 'witnessed' })

  // Now the desk code goes to that number, and signs the patient in.
  const issued = await desk.post(`/api/patients/${p.id}/signin-code`)
  expect(issued.ok).toBe(true)
  const anon = await anonymous()
  expect((await anon.post('/api/auth/patient/otp/verify', { data: { phone, code: issued.body.code } })).status()).toBe(200)
  await anon.dispose()

  // A number already on another record is refused; changing the number tells the old one.
  const other = await registerPatient(desk, { base: 'hero', primaryContact: 'patient', withCaregiver: false, purposes: { ...ALL_PURPOSES, ai: false } })
  const taken = await desk.post(`/api/patients/${p.id}/phone`, { phone: other.phone, confirm: { method: 'witnessed', attest: true } })
  expect(taken.status).toBe(409)
  expect(taken.body.error.code).toBe('phone_in_use')
  const since = new Date(Date.now() - 1000)
  const changed = await desk.post(`/api/patients/${p.id}/phone`, { phone: freshPhone(), confirm: { method: 'witnessed', attest: true } })
  expect(changed.ok).toBe(true)
  expect((await smsTo(phone)).filter((m) => m.createdAt >= since).map((m) => m.templateKey)).toEqual(['patient_phone.changed'])
  // Without the in-person attestation the request is refused before anything changes.
  expect((await desk.post(`/api/patients/${p.id}/phone`, { phone: freshPhone() })).status).toBe(400)
})
