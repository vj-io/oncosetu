// V05-E2E-06 (PRD §13, FR-CON-02, E-ID-09): a caregiver acts for the patient and every action carries the caregiver's
// id; once staff revoke the caregiver, the live session ends and the next request is refused.
import { ALL_PURPOSES, demoDoc, portalLogin, registerPatient } from './helpers/api'
import { auditOf, caregiversOf, documentsOf, liveCaregiverSessions } from './helpers/db'
import { test, expect } from './helpers/fixtures'

test('V05-E2E-06 a caregiver uploads for the patient (attributed in the record and the audit); revoked by staff, the next request is refused', async ({ staff, browser }) => {
  const records = await staff('records')
  // AI reading off: the uploaded page is only stored and read by the rule library, so the test needs no LLM call.
  const p = await registerPatient(records, { base: 'hero', primaryContact: 'patient', withCaregiver: true, purposes: { ...ALL_PURPOSES, ai: false } })
  const [cg] = await caregiversOf(p.id)
  const caregiver = await portalLogin(p.caregiverPhone!)

  // The caregiver uploads through the portal's own form.
  const ctx = await caregiver.browserContext(browser)
  const page = await ctx.newPage()
  await page.goto('/p/upload?lang=en')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose files' }).click()
  const file = demoDoc('hero__04-prescription-printed.pdf')
  await (await chooser).setFiles({ name: file.name, mimeType: 'application/pdf', buffer: file.buffer })
  await expect(page.getByText('Received. The clinic team will check it.')).toBeVisible()

  // The document and its audit row name the caregiver, not the patient.
  const docs = (await documentsOf(p.id)).filter((d) => d.intakeRoute === 'patient_link')
  expect(docs).toHaveLength(1)
  expect(docs[0]).toMatchObject({ uploadedByKind: 'caregiver', uploadedById: cg.id })
  expect(await auditOf(docs[0].id, 'document.upload')).toEqual([expect.objectContaining({ actorRole: 'caregiver', actorId: cg.id })])
  expect(await liveCaregiverSessions(cg.id)).not.toHaveLength(0)

  // Staff revoke the caregiver: the row is switched off and the caregiver's sessions end at once.
  const revoked = await records.post(`/api/patients/${p.id}/caregivers/${cg.id}/revoke`)
  expect(revoked.status).toBe(200)
  expect((await caregiversOf(p.id))[0]).toMatchObject({ active: false, revokedAt: expect.any(Date) })
  expect(await liveCaregiverSessions(cg.id)).toEqual([])
  expect((await auditOf(cg.id, 'caregiver.revoked'))[0]?.details).toMatchObject({ patientId: p.id, endedSessions: expect.any(Number) })

  // The caregiver's next request is refused, and the portal sends the same browser back to sign-in.
  const again = await caregiver.upload('/api/p/documents', { ...file, mimeType: 'application/pdf' })
  expect(again.status).toBe(401)
  await page.goto('/p/upload?lang=en')
  await expect(page).toHaveURL(/\/p\/login/)
  expect((await documentsOf(p.id)).filter((d) => d.intakeRoute === 'patient_link')).toHaveLength(1)
  await ctx.close()
  await caregiver.dispose()
})
