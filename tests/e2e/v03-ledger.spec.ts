// V03-E2E-01..07 (PRD §13, v0.3 Timeline, Change Ledger, structured capture, onboarding). Tests marked @clock move the org clock and run alone.
import type { Snapshot } from '../../src/core/ledger'
import { STAFF_ONLY_EVENT_TYPES } from '../../src/core/types'
import { verifySnapshotFile } from '../../src/server/ledger/export'
import { buildReadback, type Answers } from '../../src/server/portal/visit-model'
import { Api, demoDoc, portalLogin, registerPatient, until, uploadAndWait, uploadDemo, waitDoc } from './helpers/api'
import { documentsOf, eventsOf, snapshotsOf, statementsOf } from './helpers/db'
import { createShare, parseCsv, seal, withClock } from './helpers/flows'
import { test, expect } from './helpers/fixtures'
import { diagnosisHits } from './helpers/text'
import type { Page } from '@playwright/test'

const sectionOf = (page: Page, title: string) => page.locator('section', { has: page.getByRole('heading', { name: title, exact: true }) })
const count = async (page: Page, title: string) => Number((await sectionOf(page, title).locator('header span').nth(1).innerText()).trim())

// Answers by tap: yes / no / not sure per question, a place and a month typed or picked.
const NO: Answers = {
  other_hospital: { yn: 'no' }, new_medicines: { yn: 'no' }, new_tests: { yn: 'no' }, admissions: { yn: 'no' }, anything_else: { yn: 'no' },
}

test('V03-E2E-01 HERO first visit: caregiver-primary, disclosure unknown, backlog to sealed S0 and a share link', async ({ staff, ui, browser }) => {
  test.setTimeout(600_000)
  const desk = await staff('desk'), records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'caregiver', disclosure: 'unknown' })
  expect(p.disclosure).toBe('unknown')

  // The backlog: nine files in one go (3 are photographs read by OCR).
  const backlog = ['hero__01-discharge-summary.pdf', 'hero__02-chemo-daycare-cycle4.pdf', 'hero__03-ct-thorax-abdomen.jpg', 'hero__04-prescription-printed.pdf',
    'hero__05-prescription-handwritten.jpg', 'hero__06-cbc-hindi.jpg', 'hero__07-wrong-patient-histopathology.pdf', 'hero__08-lab-report-injection.pdf', 'hero__09-mammography-2024.pdf']
  const ups = await Promise.all(backlog.map(async (f) => ({ f, ...(await uploadDemo(records, p.id, f)) })))
  const docs = Object.fromEntries(await Promise.all(ups.map(async (u) => [u.f, { id: u.documentId, st: await waitDoc(records, u.documentId) }])))

  // Identity checks: the wrong-patient report is blocked, the handwritten page could not be read; a person decides each, with a reason.
  expect(docs['hero__07-wrong-patient-histopathology.pdf'].st.identity).toEqual({ result: 'mismatch', attachState: 'pending_decision' })
  expect(docs['hero__05-prescription-handwritten.jpg'].st.identity).toEqual({ result: 'insufficient', attachState: 'pending_decision' })
  for (const f of backlog.filter((x) => !x.startsWith('hero__05') && !x.startsWith('hero__07'))) expect(docs[f].st.identity.result, f).toBe('match')
  expect((await records.post(`/api/documents/${docs['hero__07-wrong-patient-histopathology.pdf'].id}/attach`, { decision: 'reject', reason: 'Another patient: different name, age and sex' })).ok).toBe(true)
  expect((await records.post(`/api/documents/${docs['hero__05-prescription-handwritten.jpg'].id}/attach`, { decision: 'attach', reason: 'Name and age checked on the page by eye' })).ok).toBe(true)
  await waitDoc(records, docs['hero__05-prescription-handwritten.jpg'].id)

  // Onboarding order: pathology and molecular first, then imaging, discharge, treatment, prescriptions, labs (an administrative order).
  const list = (await records.get(`/api/patients/${p.id}/documents`)).body
  const order = list.rows.filter((r: any) => r.attachState !== 'rejected').map((r: any) => r.docType)
  const rank = ['pathology_report', 'ihc_molecular_report', 'imaging_report', 'discharge_summary', 'procedure_note', 'chemo_daycare_record', 'prescription_printed', 'prescription_handwritten', 'lab_report']
  const ranks = order.map((t: string) => rank.indexOf(t))
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  expect(list.progress).toMatchObject({ documents: 8, awaitingDecision: 0 })

  // Records staff open the sources, then verify what is eligible from the ledger (bulk verify takes opened items only).
  for (const e of await eventsOf(p.id)) await records.post(`/api/events/${e.id}/viewed`)
  const rec = await ui('records')
  await rec.goto(`/patients/${p.id}/ledger`)
  await expect(rec.getByRole('heading', { name: 'Everything on file so far' })).toBeVisible()
  const bulkButton = rec.getByRole('button', { name: /Mark opened items as checked \(\d+\)/ })
  const eligible = Number((await bulkButton.innerText()).match(/\((\d+)\)/)![1])
  expect(eligible).toBeGreaterThan(0)
  await bulkButton.click()
  await rec.getByRole('dialog').getByRole('button', { name: `Mark ${eligible} as checked` }).click()
  await expect(rec.getByText(`${eligible} verified`)).toBeVisible()
  const evs = (await eventsOf(p.id)).filter((e) => !e.withdrawnAt)
  const verified = evs.filter((e) => e.verificationStatus === 'verified_matches_source').length
  expect(verified).toBe(eligible)
  expect(evs.length - verified, 'partial: items for the clinician tier or needing care stay unverified').toBeGreaterThan(0)

  // The clinician sees the document index with provenance and seals S0 with partial verification.
  const clin = await ui('clinician')
  await clin.goto(`/patients/${p.id}/ledger`)
  await expect(clin.getByText(/No visit has been sealed yet/)).toBeVisible()
  await expect(clin.getByText('Checked against the page').first()).toBeVisible()
  await expect(clin.getByText('Not yet checked').first()).toBeVisible()
  await clin.getByRole('button', { name: 'Seal this visit' }).click()
  await clin.getByRole('dialog').getByRole('button', { name: 'Seal it' }).click()
  await expect(clin.getByRole('dialog', { name: 'Visit sealed' })).toBeVisible()
  const [s0] = await snapshotsOf(p.id)
  expect(s0.seq).toBe(0)
  const counts = JSON.parse(s0.canonicalJson) as { verified: unknown[]; unverified: unknown[]; documents: unknown[] }
  expect(counts.verified.length).toBe(verified)
  expect(counts.unverified.length).toBeGreaterThan(0)

  // Share link for the caregiver: passcode on, opened in a fresh browser with no session.
  const share = await createShare(records, p.id, { passcode: '482915' })
  const fresh = await browser.newContext()
  const viewer = await fresh.newPage()
  await viewer.goto(share.url)
  await viewer.getByLabel('Passcode').fill('482915')
  await viewer.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(viewer.getByRole('heading', { level: 1, name: 'Document index, not a clinical summary' })).toBeVisible()
  await expect(viewer.getByRole('heading', { name: 'Documents not in this file' })).toBeVisible()
  await expect(viewer.getByRole('heading', { name: 'Recorded items' })).toBeVisible()
  const page = await viewer.locator('body').innerText()
  expect(diagnosisHits(page)).toEqual([])
  expect(page).not.toMatch(/onco/i)
  expect(page).toContain('Setu Records')
  // The wrong-patient file never reaches the shared index; absent documents are named administratively.
  expect(page).not.toMatch(/Deshpande|Sunil/i)
  expect(share.payload.absent.length).toBeGreaterThan(0)
  expect(diagnosisHits(JSON.stringify(share.payload))).toEqual([])
  await fresh.close()
})

test('V03-E2E-02 returning visit: pre-visit answers, new lab report, ledger "New since last visit" and "Patient said", seal S1 @clock', async ({ staff, ui }) => {
  test.setTimeout(600_000)
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
  // Previous visit: three records sealed as S0 on a day before the new documents (the org clock is moved back only for the seal).
  for (const f of ['returning__01-discharge-summary.pdf', 'returning__02-histopathology.pdf', 'returning__03-chemo-cycle1.pdf']) await uploadAndWait(records, p.id, f)
  const s0 = await withClock(-230, () => seal(clinician, p.id))
  expect(s0.seq).toBe(0)

  // The patient signs in with an SMS code and answers by tap; the read-back is built from the same answers and confirmed.
  const patient = await portalLogin(p.phone!)
  expect((await patient.get('/api/auth/me')).body.session.kind).toBe('patient')
  const answers: Answers = { ...NO, other_hospital: { yn: 'yes', place: 'Sahyadri Hospital', month: 4, year: 2026 } }
  const readback = buildReadback(answers, 'en')
  expect(readback.lines.find((l) => l.q === 'other_hospital')!.text).toContain('Sahyadri Hospital')
  const sent = await patient.post('/api/p/statements', { answers, lang: 'en', confirmation: 'confirmed' })
  expect(sent.ok).toBe(true)
  const stmts = await statementsOf(p.id)
  expect(stmts.find((s) => s.questionId === 'other_hospital')).toMatchObject({ confirmation: 'confirmed', readbackText: readback.lines[0].text })
  // The new lab report comes in through the patient portal.
  const up = await patient.upload('/api/p/documents', demoDoc('returning__04-lab-cbc-lft.jpg'))
  expect(up.ok).toBe(true)
  const docId = (await until(async () => (await documentsOf(p.id)).find((d) => d.intakeRoute === 'patient_link'))).id
  await waitDoc(records, docId)

  // The clinician's ledger: what changed since S0, what the patient said, with links to the sources.
  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/ledger`)
  await expect(page.getByRole('heading', { name: 'What changed since the last sealed visit' })).toBeVisible()
  // The new lab report: its report fact plus its printed result rows (5 Nov 2026), all from that one document.
  const fromLab = (await eventsOf(p.id)).filter((e) => e.documentId === docId && !e.withdrawnAt)
  expect(fromLab.map((e) => e.eventType)).toContain('lab_results_documented')
  expect(await count(page, 'New since the last visit')).toBe(fromLab.length)
  expect(await count(page, 'Patient said')).toBe(5) // one line per answered question, "no" included
  const added = sectionOf(page, 'New since the last visit')
  await expect(added).toContainText('Haematology')
  await expect(added.getByRole('link', { name: /source/i }).first()).toHaveAttribute('href', new RegExp(`/patients/${p.id}/documents/${docId}\\?event=`))
  await expect(sectionOf(page, 'Patient said')).toContainText('Sahyadri Hospital')
  await expect(sectionOf(page, 'Patient said')).toContainText('Confirmed by patient')
  // Items already sealed in S0 are not listed as new.
  await expect(added).not.toContainText('Hemicolectomy')

  // Verify the new item and seal S1: the hash is recorded and publicly checkable.
  const newEvents = (await eventsOf(p.id)).filter((e) => e.documentId === docId)
  for (const e of newEvents) await clinician.post(`/api/events/${e.id}/viewed`)
  const v = await clinician.post(`/api/patients/${p.id}/verify-bulk`, { eventIds: newEvents.map((e) => e.id) })
  // OCR'd result rows are never bulk-verified (binding_uncertain): each one is checked against the image, one by one.
  const ocrRows = newEvents.filter((e) => e.eventType === 'lab_results_documented')
  expect(v.body.skipped.map((x: { id: string }) => x.id).sort()).toEqual(ocrRows.map((e) => e.id).sort())
  for (const e of ocrRows) expect((await clinician.post(`/api/events/${e.id}/verify`, { action: 'verify', rowVersion: e.rowVersion })).ok).toBe(true)
  expect(v.body.verified.length + ocrRows.length).toBe(newEvents.length)
  const s1 = await seal(clinician, p.id)
  expect(s1.seq).toBe(1)
  const stored = (await snapshotsOf(p.id)).map((s) => ({ seq: s.seq, sha256: s.sha256 }))
  expect(stored).toEqual([{ seq: 0, sha256: s0.sha256 }, { seq: 1, sha256: s1.sha256 }])
  expect(s1.sha256).not.toBe(s0.sha256)
  const rows = parseCsv(((await (await staff('admin')).get('/api/admin/audit.csv')).body as string))
  const sealRow = rows.find((r) => r.action === 'snapshot.seal' && r.target_id === s1.snapshotId)
  expect(JSON.parse(sealRow!.details)).toMatchObject({ seq: 1, sha256: s1.sha256 })
})

test('V03-E2E-03 a 2024 report uploaded after S0 is "Newly received older records", not "New"', async ({ staff, ui }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero' })
  await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  await uploadAndWait(records, p.id, 'hero__04-prescription-printed.pdf')
  await seal(clinician, p.id)
  const late = await uploadAndWait(records, p.id, 'hero__09-mammography-2024.pdf')

  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/ledger`)
  // every fact from the late report (its report line and the impression copied for staff) is listed as arrived late
  const fromLate = (await eventsOf(p.id)).filter((e) => e.documentId === late.documentId && !e.withdrawnAt)
  expect(fromLate.length).toBeGreaterThan(0)
  expect(await count(page, 'Older papers that arrived late')).toBe(fromLate.length)
  expect(await count(page, 'New since the last visit')).toBe(0)
  await expect(sectionOf(page, 'Older papers that arrived late')).toContainText('Mammography')
  await expect(sectionOf(page, 'Older papers that arrived late')).toContainText('Older paper that arrived late')
  // "Verify all" never includes a newly received older item.
  const ev = (await eventsOf(p.id)).find((e) => e.documentId === late.documentId)!
  const r = await records.post(`/api/patients/${p.id}/verify-bulk`, { eventIds: [ev.id] })
  expect(r.body.verified).toEqual([])
  expect(r.body.skipped[0].reasons).toContain('newly_received_older')
})

test('V03-E2E-04 a patient statement that conflicts with a prescription is a conflict item; "verify all" leaves it out', async ({ staff, ui }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
  const rx = await uploadAndWait(records, p.id, 'returning__06-prescription.pdf')
  const patient = await portalLogin(p.phone!)
  const answers: Answers = { ...NO, new_medicines: { yn: 'yes', names: 'Letrozole', place: 'Sahyadri Hospital', month: 5, year: 2026 } }
  expect((await patient.post('/api/p/statements', { answers, lang: 'en', confirmation: 'confirmed' })).ok).toBe(true)

  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/ledger`)
  expect(await count(page, 'Sources that disagree')).toBe(1)
  await expect(sectionOf(page, 'Sources that disagree')).toContainText('Letrozole')
  await expect(sectionOf(page, 'Sources that disagree')).toContainText('Capecitabine')

  const events = (await eventsOf(p.id)).filter((e) => e.documentId === rx.documentId && Array.isArray((e.fields as any).medication_names) && ((e.fields as any).medication_names as string[]).includes('Capecitabine'))
  expect(events).toHaveLength(1)
  const r = await clinician.post(`/api/patients/${p.id}/verify-bulk`, { eventIds: (await eventsOf(p.id)).map((e) => e.id) })
  expect(r.body.verified).not.toContain(events[0].id)
  expect(r.body.skipped).toEqual(expect.arrayContaining([{ id: events[0].id, reasons: expect.arrayContaining(['conflict']) }]))
  // The toolbar count excludes it too, and a clinician resolves it with a note.
  const resolved = await clinician.post(`/api/events/${events[0].id}/resolve`, { note: 'Checked with the patient: the other hospital changed the drug' })
  expect(resolved.ok).toBe(true)
  await page.reload()
  expect(await count(page, 'Sources that disagree')).toBe(0)
})

test('V03-E2E-05 an amended report appears under "Amended and corrected"', async ({ staff, ui }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'returning' })
  const first = await uploadAndWait(records, p.id, 'returning__02-histopathology.pdf')
  await uploadAndWait(records, p.id, 'returning__01-discharge-summary.pdf')
  await seal(clinician, p.id)
  const addendum = await uploadAndWait(records, p.id, 'returning__07-histopathology-addendum.pdf')
  const [doc] = (await documentsOf(p.id)).filter((d) => d.id === addendum.documentId)
  expect(doc.amendmentOf).toBe(first.documentId) // same accession, later date, "addendum": linked as an amendment

  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/ledger`)
  expect(await count(page, 'Corrected reports')).toBeGreaterThanOrEqual(1)
  await expect(sectionOf(page, 'Corrected reports')).toContainText(/pathology|histopathology/i)
  expect(await count(page, 'New since the last visit')).toBe(0)
})

test('V03-E2E-06 only a clinician sets the disclosure status; the change is audited and patient copy switches', async ({ staff, browser }) => {
  const desk = await staff('desk'), records = await staff('records'), clinician = await staff('clinician'), admin = await staff('admin')
  // At registration too: desk cannot register a patient as already informed.
  await expect(registerPatient(desk, { base: 'returning', disclosure: 'cleared' })).rejects.toThrow(/403/)
  const p = await registerPatient(desk, { base: 'returning', disclosure: 'unknown' })
  const set = (api: Api) => api.post(`/api/patients/${p.id}/disclosure`, { status: 'cleared', reason: 'patient_informed' })
  expect((await set(desk)).status).toBe(403)
  expect((await set(records)).status).toBe(403)
  expect((await set(admin)).status).toBe(403)

  const patient = await portalLogin(p.phone!)
  const ctx = await patient.browserContext(browser)
  const page = await ctx.newPage()
  await page.goto('/p')
  await expect(page.locator('body')).toContainText('Setu Records')
  expect(await page.locator('body').innerText()).not.toMatch(/onco/i)

  const ok = await set(clinician)
  expect(ok.body).toEqual({ ok: true, disclosure: 'cleared' })
  expect((await set(clinician)).status).toBe(409) // unchanged
  await page.goto('/p')
  await expect(page.locator('body')).toContainText('OncoSetu') // the brand switches once disclosure is cleared
  await ctx.close()

  const rows = parseCsv(((await admin.get('/api/admin/audit.csv')).body as string))
  const row = rows.find((r) => r.action === 'patient.disclosure_changed' && r.target_id === p.id)
  expect(row).toBeTruthy()
  expect(JSON.parse(row!.details)).toEqual({ from: 'unknown', to: 'cleared', reason: 'patient_informed' })
  expect(row!.actor_role).toBe('clinician')
})

test('V03-E2E-07 a sealed snapshot verifies publicly: hash and signature valid (tamper is covered by unit tests)', async ({ staff, anon }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'returning' })
  await uploadAndWait(records, p.id, 'returning__01-discharge-summary.pdf')
  const sealed = await seal(clinician, p.id)
  const viewer = await anon()
  const r = await viewer.get(`/api/snapshots/${sealed.snapshotId}/verify`)
  expect(r.status()).toBe(200)
  const verdict = await r.json()
  expect(verdict).toMatchObject({ snapshotId: sealed.snapshotId, seq: 0, hashMatches: true, signatureValid: true, sha256Stored: sealed.sha256, sha256Recomputed: sealed.sha256, keyId: sealed.keyId })
  expect(JSON.stringify(verdict)).not.toMatch(/Rahim|Khan/) // no PHI in the public verdict
  const page = await viewer.get(`/verify/${sealed.snapshotId}`)
  expect(page.status()).toBe(200)
  expect(await viewer.get('/api/snapshots/00000000-0000-7000-8000-000000000000/verify').then((x) => x.status())).toBe(404)
  // Tamper evidence (one changed byte breaks the hash and the signature): src/server/ledger/ledger.test.ts "seal ... tamper (FR-LED-01, V03-E2E-07)".
})

test('FR-PAS-05 the printable passport: sealed index with hash, key and a QR to the check; no staff-only line; the sealed file verifies offline', async ({ staff, ui, anon }) => {
  const records = await staff('records'), clinician = await staff('clinician'), desk = await staff('desk')
  const p = await registerPatient(records, { base: 'hero' }) // disclosure unknown
  await uploadAndWait(records, p.id, 'hero__02-chemo-daycare-cycle4.pdf') // a day-care visit plus a regimen line (staff-only)
  const sealed = await seal(clinician, p.id)
  const snap = JSON.parse((await snapshotsOf(p.id))[0].canonicalJson) as Snapshot
  const all = [...snap.verified, ...snap.unverified]
  const staffOnly = all.filter((e) => STAFF_ONLY_EVENT_TYPES.has(e.eventType))
  expect(staffOnly.length, 'the sealed record holds a staff-only line').toBeGreaterThan(0)

  const clin = await ui('clinician')
  await clin.goto(`/patients/${p.id}/ledger`)
  await expect(clin.getByRole('link', { name: 'Print the passport' })).toHaveAttribute('href', `/print/passport/${sealed.snapshotId}`)

  // The desk prints it for the patient: the share link's index, the seal and the QR to the public check.
  const page = await ui('desk')
  await page.goto(`/print/passport/${sealed.snapshotId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Document index, not a clinical summary' })).toBeVisible()
  await expect(page.locator('section[aria-labelledby="items-h"] ol > li')).toHaveCount(all.length - staffOnly.length)
  await expect(page.getByRole('img', { name: 'Verify seal' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Download the sealed file/ })).toHaveCount(0) // the desk is not offered the sealed file
  const text = await page.locator('article').innerText()
  for (const s of [sealed.sha256, sealed.snapshotId, `Signed with Ed25519 key ${sealed.keyId}`, `/verify/${sealed.snapshotId}`]) expect(text).toContain(s)
  expect(text).toMatch(/Sealed on \d{1,2} \w{3} \d{4}, \d{2}:\d{2} IST/)
  expect(diagnosisHits(text)).toEqual([])
  expect(text).not.toMatch(/onco/i)
  for (const e of staffOnly) {
    for (const [k, v] of Object.entries(e.fields)) if (typeof v === 'string' && k !== 'institution_name' && k !== 'event_date_text') expect(text).not.toContain(v)
  }

  // The sealed file: records officers and clinicians only; it checks out offline against GET /api/keys, a changed byte does not.
  expect((await desk.get(`/api/snapshots/${sealed.snapshotId}`)).status).toBe(403)
  const viewer = await anon()
  expect((await viewer.get(`/api/snapshots/${sealed.snapshotId}`)).status()).toBe(401)
  const clinPassport = await ui('clinician')
  await clinPassport.goto(`/print/passport/${sealed.snapshotId}`)
  await expect(clinPassport.getByRole('link', { name: /Download the sealed file/ })).toHaveAttribute('href', `/api/snapshots/${sealed.snapshotId}`)
  const file = await clinician.get(`/api/snapshots/${sealed.snapshotId}`)
  expect(file.status).toBe(200)
  const { keys } = await (await viewer.get('/api/keys')).json()
  expect(verifySnapshotFile(file.body, keys)).toMatchObject({ ok: true, hashMatches: true, signatureValid: true, sha256: sealed.sha256 })
  const flip = (id: string) => id.slice(0, -1) + (id.endsWith('0') ? '1' : '0')
  expect(verifySnapshotFile({ ...file.body, snapshot: { ...file.body.snapshot, patientId: flip(file.body.snapshot.patientId) } }, keys).ok).toBe(false)
})
