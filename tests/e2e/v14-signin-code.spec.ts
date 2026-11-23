// FR-ID-02 in person, FR-ING-03: where no SMS reaches the patient, staff show a one-time sign-in code on screen ("Give
// sign-in code"). The patient signs in on their own phone with it and sends a paper. That paper is stored once: the
// clinician and the patient (from the portal) open the same original, byte for byte; another patient cannot open it.
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { documentFiles } from '../../src/db/schema'
import { ALL_PURPOSES, demoDoc, portalLogin, registerPatient, waitDoc } from './helpers/api'
import { auditOf, documentsOf, smsTo } from './helpers/db'
import { test, expect } from './helpers/fixtures'

test('FR-ID-02 the desk gives a sign-in code; the patient signs in with it, sends a paper; doctor and patient open the same stored file', async ({ staff, ui, browser }) => {
  const desk = await staff('desk')
  // AI reading off: the paper is only stored and read by the rule library, so the test needs no LLM call.
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'patient', purposes: { ...ALL_PURPOSES, ai: false } })
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
  await page.getByLabel('Mobile number').fill(p.phone!)
  await page.getByTestId('have-desk-code').click()
  await expect(page.getByText('Enter the 6-digit code the clinic front desk gave you.')).toBeVisible()
  await page.getByLabel('6-digit code').fill(code)
  await page.getByRole('button', { name: 'Sign in' }).click()
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
