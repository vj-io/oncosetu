// V02-E2E-01,03,04,05,06,08 (PRD §13, v0.2 Intake and evidence-gated extraction). Rule-based extraction only: no LLM is configured.
import { documentsOf, eventsOf, evidenceOf } from './helpers/db'
import { Api, demoDoc, registerPatient, uploadAndWait, uploadDemo, uploadFile, waitDoc } from './helpers/api'
import { parseCsv } from './helpers/flows'
import { test, expect } from './helpers/fixtures'

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

test('V02-E2E-01 a text-layer pathology report yields unverified events, each opening its source with the quote highlighted', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const up = await uploadAndWait(records, p.id, 'hero__10-histopathology-later.pdf')
  expect(up.doc).toMatchObject({ status: 'done', docType: 'pathology_report', identity: { result: 'match' } })

  const evs = (await eventsOf(p.id)).filter((e) => e.documentId === up.documentId)
  expect(evs.length).toBeGreaterThanOrEqual(2)
  expect(evs.every((e) => e.verificationStatus === 'unverified')).toBe(true)
  const withQuote: { id: string; quote: string }[] = []
  for (const e of evs) {
    const ev = await evidenceOf(e.id)
    expect(ev.length, `event ${e.eventType} has evidence`).toBeGreaterThan(0)
    expect(ev[0].quote && ev[0].pageNo && ev[0].charEnd! > ev[0].charStart!).toBeTruthy()
    withQuote.push({ id: e.id, quote: ev[0].quote! })
  }

  // The deep link lights the quote on the page text (a <mark> with the spotlight sweep) and logs that the source was opened.
  const page = await ui('records')
  for (const { id, quote } of withQuote.slice(0, 3)) {
    await page.goto(`/patients/${p.id}/documents/${up.documentId}?event=${id}`)
    const lit = page.locator('mark.ds-sweep')
    await expect(lit.first()).toBeVisible()
    const text = squash((await lit.allInnerTexts()).join(' '))
    expect(squash(quote)).toContain(text.slice(0, 30))
    expect(text.length).toBeGreaterThan(5)
    await expect(page.locator(`#ev-${id}`)).toContainText('Not yet verified')
    await expect(page.locator(`#q-${id}`).first()).toBeVisible()
  }
  await expect.poll(async () => {
    const csv = parseCsv(((await (await staff('admin')).get('/api/admin/audit.csv')).body as string))
    return csv.filter((r) => r.action === 'event.source_viewed' && withQuote.some((q) => q.id === r.target_id)).length
  }, { timeout: 30_000 }).toBeGreaterThan(0)
})

test('V02-E2E-03 a handwritten prescription is kept as an image: zero events, manual tag works', async ({ staff }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const up = await uploadAndWait(records, p.id, 'hero__05-prescription-handwritten.jpg')
  expect(up.doc.flags).toMatchObject({ handwritten: true })
  expect(up.doc.status).toBe('needs_review')
  expect(up.doc.events).toBe(0)

  // Identity could not be read from the header: a person decides, with a reason; after attaching there are still no facts.
  const attach = await records.post(`/api/documents/${up.documentId}/attach`, { decision: 'attach', reason: 'Checked against the card at the desk' })
  expect(attach.ok).toBe(true)
  const after = await waitDoc(records, up.documentId)
  expect(after.events).toBe(0)
  expect((await eventsOf(p.id)).filter((e) => e.documentId === up.documentId)).toEqual([])

  // Facts cannot be keyed from an image-only page (nothing to quote); document tags are the manual route.
  const keyed = await records.post(`/api/documents/${up.documentId}/manual-events`, { eventType: 'prescription_documented', fields: { medication_names: ['Tamoxifen'] }, quote: 'Tamoxifen', pageNo: 1 })
  expect([keyed.status, keyed.body.error.code]).toEqual([422, 'image_only'])
  const tag = await records.post(`/api/documents/${up.documentId}/tags`, { docType: 'prescription_handwritten', documentDate: '2026-06-02', institution: 'Pawar Clinic and Family Care Centre' })
  expect(tag.body).toMatchObject({ ok: true, reprocessing: false })
  const [doc] = (await documentsOf(p.id)).filter((d) => d.id === up.documentId)
  expect(doc).toMatchObject({ docType: 'prescription_handwritten', documentDate: '2026-06-02', handwritten: true, status: 'done' })
  expect(doc.manualTags).toEqual(expect.arrayContaining(['doc_type', 'document_date', 'institution']))
  expect(((await records.get(`/api/patients/${p.id}/documents`)).body.progress).pagesVerified).toBe(1) // a tagged handwritten page counts as handled
  expect((await eventsOf(p.id)).length).toBe(0)
})

test('V02-E2E-04 a wrong-patient report is blocked; attaching needs a reason and is audited', async ({ staff }) => {
  const desk = await staff('desk'), records = await staff('records'), admin = await staff('admin')
  const p = await registerPatient(records, { base: 'hero' })
  const up = await uploadAndWait(records, p.id, 'hero__07-wrong-patient-histopathology.pdf')
  expect(up.doc).toMatchObject({ status: 'needs_review', identity: { result: 'mismatch', attachState: 'pending_decision' }, events: 0 })
  // Blocked: nothing reaches the record while the decision is open.
  expect((await eventsOf(p.id)).length).toBe(0)

  const url = `/api/documents/${up.documentId}/attach`
  expect((await records.post(url, { decision: 'attach', reason: '' })).status).toBe(400) // a reason is required
  expect((await records.post(url, { decision: 'attach' })).status).toBe(400)
  expect((await desk.post(url, { decision: 'attach', reason: 'I am sure it is theirs' })).status).toBe(403) // desk cannot decide
  expect((await records.get(`/api/documents/${up.documentId}/status`)).body.identity.attachState).toBe('pending_decision')

  const ok = await records.post(url, { decision: 'attach', reason: 'Same patient: confirmed with the lab by phone' })
  expect(ok.body).toMatchObject({ ok: true, attachState: 'attached' })
  const processed = await waitDoc(records, up.documentId)
  expect(processed.identity).toEqual({ result: 'mismatch', attachState: 'attached' }) // the header result stays; the human decision is recorded beside it
  const [doc] = (await documentsOf(p.id)).filter((d) => d.id === up.documentId)
  expect(doc.attachReason).toBe('Same patient: confirmed with the lab by phone')
  expect(doc.attachDecidedBy).toBeTruthy()
  expect((await records.post(url, { decision: 'attach', reason: 'twice' })).status).toBe(409) // decided once
  // Audit row with ids only.
  const rows = parseCsv((await admin.get('/api/admin/audit.csv')).body as string)
  const row = rows.find((r) => r.action === 'document.identity_decision' && r.target_id === up.documentId)
  expect(row).toBeTruthy()
  expect(JSON.parse(row!.details)).toEqual({ decision: 'attach', identityResult: 'mismatch' })
  expect(row!.details).not.toContain('confirmed with the lab')
})

test('V02-E2E-04b rejecting a mismatched report keeps it out of the record', async ({ staff }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const up = await uploadAndWait(records, p.id, 'hero__07-wrong-patient-histopathology.pdf')
  const r = await records.post(`/api/documents/${up.documentId}/attach`, { decision: 'reject', reason: 'Belongs to another patient' })
  expect(r.body).toMatchObject({ ok: true, attachState: 'rejected' })
  expect((await eventsOf(p.id)).length).toBe(0)
  expect((await records.get(`/api/patients/${p.id}/documents`)).body.progress.documents).toBe(0) // rejected files do not count as part of the record
})

test('V02-E2E-05 a hidden-instruction document is flagged: no forbidden fields, no status change', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const up = await uploadAndWait(records, p.id, 'hero__08-lab-report-injection.pdf')
  expect(up.doc.flags).toMatchObject({ injection: true })
  const evs = (await eventsOf(p.id)).filter((e) => e.documentId === up.documentId)
  // Only the visible lab report is a fact; nothing came from the hidden text.
  expect(evs.map((e) => e.eventType)).toEqual(['lab_report_documented'])
  const dump = JSON.stringify(evs.map((e) => e.fields)).toLowerCase() + JSON.stringify(await Promise.all(evs.map((e) => evidenceOf(e.id)))).toLowerCase()
  for (const bad of ['ignore previous', 'verified', 'stage iv', 'carcinoma', 'diagnosis']) expect(dump).not.toContain(bad)
  expect(Object.keys(evs[0].fields).sort()).toEqual(expect.arrayContaining(['test_name']))
  expect(evs.every((e) => e.verificationStatus === 'unverified')).toBe(true) // the document could not change any status
  // Staff see why it is flagged.
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/documents/${up.documentId}`)
  await expect(page.locator('main')).toContainText(/hidden|instruction/i)
})

test('V02-E2E-06 no LLM configured: the journey completes in manual mode, keyed facts still pass the evidence gate', async ({ staff, ui }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero' })
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/documents`)
  await expect(page.getByText('LLM: off — rule-based extraction')).toBeVisible()

  const up = await uploadAndWait(records, p.id, 'hero__04-prescription-printed.pdf')
  expect(up.doc.status).toBe('done') // extraction ran without any model
  const base = (await eventsOf(p.id)).length
  expect(base).toBeGreaterThan(0)

  // A person keys a fact that the rules did not pick up; the same gate applies: the quote must be on the page and the value inside it.
  const key = (fields: Record<string, string[]>, quote: string) => records.post(`/api/documents/${up.documentId}/manual-events`, { eventType: 'prescription_documented', fields, quote, pageNo: 1 })
  const notThere = await key({ medication_names: ['Chlorhexidine'] }, 'Chlorhexidine 5% mouth wash twice daily')
  expect([notThere.status, notThere.body.error.code]).toEqual([422, 'quote_not_found'])
  const notInQuote = await key({ medication_names: ['Tamoxifen'] }, 'Chlorhexidine 0.2% mouth rinse')
  expect(notInQuote.status).toBe(422)
  expect((await eventsOf(p.id)).length).toBe(base)
  const good = await key({ medication_names: ['Chlorhexidine'] }, 'Chlorhexidine 0.2% mouth rinse')
  expect(good.ok).toBe(true)
  const [made] = (await eventsOf(p.id)).filter((e) => e.id === good.body.eventId)
  expect(made).toMatchObject({ extractionMethod: 'manual', verificationStatus: 'unverified' })
  expect((await evidenceOf(made.id))[0].quote).toBe('Chlorhexidine 0.2% mouth rinse')

  // ...then verification and sealing complete the journey.
  const v = await records.post(`/api/events/${made.id}/verify`, { action: 'verify', rowVersion: made.rowVersion })
  expect(v.body.status).toBe('verified_matches_source')
  const sealed = await clinician.post(`/api/patients/${p.id}/seal`)
  expect(sealed.ok).toBe(true)
  expect(sealed.body.counts.verified).toBeGreaterThanOrEqual(1)
})

test('V02-E2E-08 OCR images show their confidence; an uncertain OCR event is excluded from verify-all', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const [ct, cbc, hand] = await Promise.all(['hero__03-ct-thorax-abdomen.jpg', 'hero__06-cbc-hindi.jpg', 'hero__05-prescription-handwritten.jpg'].map(async (f) => {
    const u = await uploadDemo(records, p.id, f)
    return { id: u.documentId, doc: await waitDoc(records, u.documentId) }
  }))
  expect(hand.doc.flags).toMatchObject({ lowConfidence: true, handwritten: true })

  // Staff see the OCR confidence of every OCR page next to its text.
  const page = await ui('records')
  for (const d of [ct, cbc]) {
    await page.goto(`/patients/${p.id}/documents/${d.id}`)
    await expect(page.getByText(/OCR mean confidence 0\.\d\d/).first()).toBeVisible()
  }
  // "Verify all" skips what is uncertain and says why. Imaging belongs to the clinician tier; the uncertain OCR lab item is never bulk-verified.
  const evs = await eventsOf(p.id)
  const ctEv = evs.find((e) => e.documentId === ct.id)!, cbcEv = evs.find((e) => e.documentId === cbc.id)!
  expect(cbcEv.flags).toMatchObject({ ocr: true, binding_uncertain: true })
  const byRecords = await records.post(`/api/patients/${p.id}/verify-bulk`, { eventIds: [ctEv.id, cbcEv.id] })
  expect(byRecords.body.verified).toEqual([])
  expect(byRecords.body.skipped).toEqual(expect.arrayContaining([{ id: ctEv.id, reasons: ['clinician_tier'] }, { id: cbcEv.id, reasons: ['binding_uncertain'] }]))
  const clinician = await staff('clinician')
  const byClinician = await clinician.post(`/api/patients/${p.id}/verify-bulk`, { eventIds: [ctEv.id, cbcEv.id] })
  expect(byClinician.body.verified).toEqual([ctEv.id])
  expect(byClinician.body.skipped).toEqual([{ id: cbcEv.id, reasons: ['binding_uncertain'] }])
})
