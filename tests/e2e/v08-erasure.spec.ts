// J8 end to end (PRD §6.3, §10.5): the patient withdraws consent and asks for erasure in the portal → the administrator
// sees it queued → the retention period runs out (the owner moves eligible_after, standing in for time) → the
// administrator executes it from the console → the record is a tombstone, files are gone, the portal no longer opens.
import { eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { erasureRequests } from '../../src/db/schema'
import { portalLogin, registerPatient, uploadAndWait } from './helpers/api'
import { consentsOf, patientRow } from './helpers/db'
import { createShare, seal } from './helpers/flows'
import { test, expect } from './helpers/fixtures'

test('V08-E2E-01 erasure: portal request → queued → due → executed by the administrator → tombstone', async ({ staff, ui, anon }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero', primaryContact: 'patient' })
  const up = await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  await seal(clinician, p.id)
  const share = await createShare(records, p.id, { passcode: '482915' })

  // The patient withdraws consent and asks for erasure from the portal.
  const patient = await portalLogin(p.phone!)
  expect((await patient.post('/api/p/consent', { withdraw: true })).ok).toBe(true)
  const asked = await patient.post('/api/p/erasure')
  expect(asked.status).toBe(200)
  expect(asked.body).toMatchObject({ state: 'queued', created: true })
  const requestId: string = asked.body.id

  // The administrator sees it queued, and cannot execute it before it is due.
  const admin = await ui('admin')
  await admin.goto('/admin/erasure')
  const row = () => admin.getByRole('row').filter({ hasText: p.accession })
  await expect(row()).toContainText('Queued')
  await expect(row().getByRole('button', { name: 'Execute now' })).toBeDisabled()
  expect((await (await staff('admin')).post(`/api/admin/erasure/${requestId}/execute`)).body.error.code).toBe('not_eligible')

  // The retention period runs out.
  await adminDb.update(erasureRequests).set({ eligibleAfter: new Date(Date.now() - 60_000) }).where(eq(erasureRequests.id, requestId))
  await admin.reload()
  await expect(row()).toContainText('Due')
  await row().getByRole('button', { name: 'Execute now' }).click()
  const dialog = admin.getByRole('dialog')
  await expect(dialog).toContainText('Deleted:')
  await expect(dialog).toContainText('Kept:')
  await dialog.getByRole('button', { name: 'Erase records' }).click()
  await expect(row()).toContainText('Completed')
  await expect(row()).toContainText('Rows per table')
  await expect(row()).toContainText('documents 1')

  // Staff see only the tombstone; the API answers 410, and the file and the share link are gone.
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/overview`)
  await expect(page.getByText(/Records erased on .+ at the patient's request; audit trail retained/)).toBeVisible()
  expect(await records.get(`/api/patients/${p.id}/documents`).then((r) => [r.status, r.body.error.code])).toEqual([410, 'erased'])
  expect((await records.get(`/api/documents/${up.documentId}/file`)).status).toBe(404)
  expect((await (await anon()).post(`/api/shares/${share.id}/open`, { data: { passcode: '482915' } })).status()).toBe(404)

  // The patient's session ended with the data, and the portal no longer signs them in (the usual generic answers).
  expect((await patient.get('/api/auth/me')).status).toBe(401)
  const again = await anon()
  expect((await again.post('/api/auth/patient/otp/start', { data: { phone: p.phone } })).status()).toBe(200)
  const login = await again.post('/api/auth/patient/otp/verify', { data: { phone: p.phone, code: '000000' } })
  expect([login.status(), (await login.json()).error.message]).toEqual([401, 'Invalid or expired code'])

  // What is left: the tombstone and the consent history (the legal record of the withdrawal).
  expect(await patientRow(p.id)).toMatchObject({ status: 'erased', nameEnc: '', phoneHmac: null, dobEnc: null, mrn: null })
  expect((await consentsOf(p.id)).map((c) => c.action)).toEqual(['grant', 'withdraw'])
})
