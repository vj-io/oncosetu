// V06-E2E-01, -04, -05 (PRD §13, v0.6 Hardening and measurement-study instrumentation).
// -02 (restore from backup into a fresh database) is scripts/restore-drill.ts (needs Neon and a production build; see docs/RUNBOOK.md);
// -03 (500-event ledger render time) is tests/e2e/v06-perf.spec.ts. Neither is in this file.
import { MEASURE_CSV_HEADER } from '../../src/server/admin/measurement-core'
import { registerPatient } from './helpers/api'
import { breakGlassOf, encountersOf, expireBreakGlass, patientRow, smsTo } from './helpers/db'
import { parseCsv } from './helpers/flows'
import { test, expect } from './helpers/fixtures'
import { diagnosisHits } from './helpers/text'

const alpha = (n: number) => Array.from({ length: n }, () => 'bcdfghjklmnpqrstvwxz'[Math.floor(Math.random() * 20)]).join('')

test('V06-E2E-01 break-glass: reason required, patient notified, access works, expiry recorded', async ({ staff, ui }) => {
  const desk = await staff('desk'), records = await staff('records'), clinician = await staff('clinician'), admin = await staff('admin')
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'patient' })
  expect((await records.post(`/api/patients/${p.id}/consent`, { action: 'withdraw' })).ok).toBe(true)
  // Without consent nobody opens the record: not records, not the clinician, not the administrator.
  for (const who of [records, clinician]) expect(await who.get(`/api/patients/${p.id}/documents`).then((r) => [r.status, r.body.error.code])).toEqual([403, 'consent_required'])
  expect(await admin.get(`/api/patients/${p.id}/documents`).then((r) => r.status)).toBe(403)

  // Only clinicians (and administrators) may request it, and only with a reason.
  expect((await records.post(`/api/patients/${p.id}/break-glass`, { reason: 'Emergency review of the record' })).status).toBe(403)
  expect((await clinician.post(`/api/patients/${p.id}/break-glass`, { reason: '' })).status).toBe(400)
  expect((await clinician.post(`/api/patients/${p.id}/break-glass`, { reason: 'urgent' })).status).toBe(400) // under 10 characters
  expect(await breakGlassOf(p.id)).toEqual([])

  const page = await ui('clinician')
  await page.goto(`/break-glass/${p.id}`)
  await page.getByLabel('Reason for opening this record').fill('too short')
  await page.getByRole('button', { name: 'Open the record for 4 hours' }).click()
  await expect(page.getByText('Give a reason of at least 10 characters.').first()).toBeVisible()
  await page.getByLabel('Reason for opening this record').fill('Patient unconscious in casualty, history needed now')
  const before = Date.now()
  await page.getByRole('button', { name: 'Open the record for 4 hours' }).click()
  await expect(page).toHaveURL(new RegExp(`/patients/${p.id}/overview`))
  await expect(page.getByText('No active consent for this patient')).toHaveCount(0) // access works

  // Recorded with an expiry four hours out; the API is open for this clinician only.
  const [grant] = await breakGlassOf(p.id)
  expect(grant.reason).toBe('Patient unconscious in casualty, history needed now')
  const hours = (grant.expiresAt.getTime() - before) / 3_600_000
  expect(hours).toBeGreaterThan(3.9)
  expect(hours).toBeLessThan(4.1)
  expect((await clinician.get(`/api/patients/${p.id}/documents`)).status).toBe(200)
  expect((await records.get(`/api/patients/${p.id}/documents`)).status).toBe(403)

  // The patient is told, in neutral words, on their own phone.
  const note = (await smsTo(p.phone!)).find((m) => m.templateKey === 'break_glass.notice')
  expect(note).toBeTruthy()
  expect(diagnosisHits(note!.body)).toEqual([])
  expect(note!.body).not.toMatch(/onco/i)
  // The administrator sees it in the access review, and the audit trail has the grant (ids and enums only).
  const apage = await ui('admin')
  await apage.goto('/admin/break-glass')
  const row = apage.getByRole('row').filter({ hasText: p.accession })
  await expect(row.first()).toContainText('Active')
  await expect(row.first()).toContainText('Patient unconscious in casualty')
  const audit = parseCsv(((await admin.get('/api/admin/audit.csv')).body as string)).find((r) => r.action === 'break_glass.granted' && r.target_id === p.id)
  expect(JSON.parse(audit!.details)).toMatchObject({ breakGlassId: grant.id, hours: 4, patientNotified: true })
  expect(audit!.details).not.toContain('unconscious')

  // Expiry is enforced on the next request, with nothing else changed.
  await expireBreakGlass(p.id)
  expect(await clinician.get(`/api/patients/${p.id}/documents`).then((r) => [r.status, r.body.error.code])).toEqual([403, 'consent_required'])
})

test('V06-E2E-04 a clinician completes the consultation form in under a minute; the export holds no PHI', async ({ staff, ui }) => {
  const desk = await staff('desk'), clinician = await staff('clinician'), admin = await staff('admin')
  const p = await registerPatient(desk, { base: 'returning' })
  const [enc] = await encountersOf(p.id)

  // Only clinicians submit the form.
  const body = { encounterId: null, consultationDate: new Date().toISOString().slice(0, 10), phase: 'baseline', firstVisit: true, missingRecordPresent: false, missingRecordCount: 0, missingTypes: [], impact: 'none', repeatTestOrdered: false, repeatTestReason: null, prepMinutes: null }
  expect((await desk.post('/api/measure/forms', body)).status).toBe(403)

  // The form in the browser: a handful of taps, timed.
  const page = await ui('clinician')
  await page.goto('/measure')
  await expect(page.getByRole('button', { name: 'Record consultation' })).toBeEnabled()
  const started = Date.now()
  await page.getByLabel('Was at least one referenced document missing from the file?').selectOption('yes')
  await page.getByLabel('How many documents').fill('2')
  await page.getByLabel('Histopathology report').check()
  await page.getByLabel('Imaging report', { exact: true }).check()
  await page.getByLabel('Impact of missing records on this consultation').selectOption('delayed_decision')
  await page.getByLabel('Preparation time (minutes)').fill('25')
  await page.getByRole('button', { name: 'Record consultation' }).click()
  await expect(page.getByText('Consultation recorded').first()).toBeVisible()
  expect(Date.now() - started).toBeLessThan(60_000)

  // A second form linked to this encounter by id, with a repeat test.
  const linked = await clinician.post('/api/measure/forms', { ...body, encounterId: enc.id, firstVisit: true, missingRecordPresent: true, missingRecordCount: 1, missingTypes: ['pathology_report'], impact: 'repeat_test_ordered', repeatTestOrdered: true, repeatTestReason: 'unavailable', prepMinutes: 40 })
  expect(linked.ok).toBe(true)
  expect((await clinician.post('/api/measure/forms', { ...body, repeatTestOrdered: true })).status).toBe(400) // a repeat test needs its reason

  const csv = await admin.get('/api/measure/export.csv')
  expect(csv.status).toBe(200)
  const text = csv.body as string
  expect(text.split(/\r?\n/)[0]).toBe(MEASURE_CSV_HEADER.join(','))
  const rows = parseCsv(text)
  expect(rows.length).toBeGreaterThanOrEqual(2)
  // Anonymised: no uuid of any kind (encounter, clinician), no patient identifiers, no exact dates, clinicians as C1..Cn.
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)
  expect(text).not.toContain(enc.id)
  for (const bit of ['rahim', 'khan', '1962', p.phone!.replace(/\D/g, '').slice(-10), p.accession.slice(3)]) expect(text.toLowerCase()).not.toContain(bit.toLowerCase())
  for (const r of rows) {
    expect(r.clinician_code).toMatch(/^C\d+$/)
    expect(new Date(`${r.consultation_week_start}T00:00:00Z`).getUTCDay()).toBe(1) // a Monday, never the exact day
  }
  // The same restraint for who may read it: clinicians and records staff cannot export.
  expect((await clinician.get('/api/measure/export.csv')).status).toBe(403)
})

test('V06-E2E-05 the same person registered twice is detected; a merge needs a second, different approver', async ({ staff }) => {
  const desk = await staff('desk'), records = await staff('records'), admin = await staff('admin')
  const name = `Qa${alpha(6)} Probe${alpha(5)}`
  const phone = '+91 9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0')
  const first = await registerPatient(desk, { base: 'returning', fullName: name, aliases: false, phone, withCaregiver: false, continueDespiteDuplicates: false })

  // Same name, DOB and phone (typed differently): the second registration is stopped with the existing record's initials only.
  const again = await registerPatient(desk, { base: 'returning', fullName: name.toUpperCase(), aliases: false, phone: phone.replace(/\s/g, ''), withCaregiver: false, continueDespiteDuplicates: false }).catch((e: Error) => e)
  expect(again).toBeInstanceOf(Error)
  expect((again as Error).message).toContain('possible_duplicate')
  const check = await desk.post('/api/desk/duplicate-check', { fullName: name, dob: '1962-01-02', phone })
  expect(check.body.candidates).toHaveLength(1)
  expect(check.body.candidates[0]).toMatchObject({ id: first.id, accession: first.accession, strong: true, reasons: expect.arrayContaining(['identity', 'name_phone']) }) // same name + DOB, same name + phone
  expect(JSON.stringify(check.body)).not.toContain(name.split(' ')[0])

  // The operator carries on knowingly: both records exist, and a merge is requested.
  const second = await registerPatient(desk, { base: 'returning', fullName: name, aliases: false, phone, withCaregiver: false, continueDespiteDuplicates: true })
  expect(second.id).not.toBe(first.id)
  const req = await records.post('/api/admin/duplicates', { survivorId: first.id, duplicateId: second.id, reason: 'Registered twice at two desks' })
  expect(req.ok).toBe(true)
  const mergeId: string = req.body.id
  // The requester cannot approve their own request, and nothing moved.
  const self = await records.post(`/api/admin/duplicates/${mergeId}`, { action: 'approve' })
  expect([self.status, self.body.error.code]).toEqual([403, 'same_person'])
  expect((await patientRow(second.id)).status).toBe('active')
  // A different approver completes it; the duplicate is closed and its card stops working.
  const done = await admin.post(`/api/admin/duplicates/${mergeId}`, { action: 'approve' })
  expect(done.ok).toBe(true)
  expect((await patientRow(second.id)).status).toBe('merged')
  expect((await patientRow(first.id)).status).toBe('active')
  expect((await records.post(`/api/admin/duplicates/${mergeId}`, { action: 'approve' })).status).toBe(409) // executed once
  const lookup = await desk.post('/api/desk/lookup', { mode: 'token', value: second.token })
  expect(lookup.body.status).toBe('revoked')
})
