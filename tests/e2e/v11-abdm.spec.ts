// v1.1 J6 (FR-ING-ABDM-01/02) against the running server, Ganga org, in-process ABDM gateway (no ABDM_* env):
// staff request → the patient approves in the portal → decrypted FHIR bundles become structured events (ledger, source
// viewer, Radar) → the patient revokes → everything ABDM brought in is erased. Also: no `abdm` consent purpose → refused.
// The tampered-ciphertext refusal (nothing written) is tests/integration/abdm.test.ts: a push cannot be injected over HTTP.
import { CONSENT_NOTICE_VERSION } from '../../src/i18n/consent'
import { Api, demoPatient, freshPhone, portalLogin, uploadAndWait, waitForSms } from './helpers/api'
import { documentsOf, eventsOf, evidenceOf, missingOf } from './helpers/db'
import { seal } from './helpers/flows'
import { expect, test } from './helpers/fixtures'
import { diagnosisHits } from './helpers/text'
import type { Page } from '@playwright/test'

const HERO_ABHA = '00-1111-2222-0001' // data/abdm/hip.json: the synthetic HIP holds five bundles for it

async function registerWithAbha(api: Api, abdm: boolean) {
  const d = demoPatient('hero')
  const phone = freshPhone()
  const r = await api.post('/api/patients', {
    fullName: d.fullName, aliases: [], dob: d.dob, sex: d.sex, phone, preferredLanguage: 'en', abhaNumber: HERO_ABHA,
    disclosureStatus: 'unknown', primaryContact: 'patient',
    consent: { purposes: { store: true, ai: false, share: true, abdm, metrics: false }, language: 'en', noticeVersion: CONSENT_NOTICE_VERSION, confirm: { method: 'witnessed', attest: true } },
    continueDespiteDuplicates: true, // every run registers the same synthetic ABHA again
  })
  if (!r.ok) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`)
  return { id: r.body.id as string, phone }
}
const sectionOf = (page: Page, title: string) => page.locator('section', { has: page.getByRole('heading', { name: title, exact: true }) })
const count = async (page: Page, title: string) => Number((await sectionOf(page, title).locator('header span').nth(1).innerText()).trim())
const abdmEvents = async (patientId: string) => (await eventsOf(patientId)).filter((e) => e.sourceType === 'external_structured')

test('V11 J6 ABDM: request → patient approves → structured events in ledger and Radar → patient revokes → erased', async ({ staff, ui, browser }) => {
  test.setTimeout(300_000)
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerWithAbha(records, true)
  // A visit already sealed (S0), so what ABDM brings in later is "newly received older records".
  await uploadAndWait(records, p.id, 'hero__04-prescription-printed.pdf')
  await seal(clinician, p.id)

  // Staff ask for the records from the Documents tab.
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/documents`)
  const panel = page.locator('section[aria-labelledby="abdm-h"]')
  await expect(panel.getByRole('heading', { name: 'Records from ABDM' })).toBeVisible()
  await expect(panel).toContainText('In-process (synthetic HIP)')
  const since = Date.now() - 2000
  await panel.getByRole('button', { name: 'Request records' }).click()
  await expect(panel).toContainText('Consent request sent')
  await expect(panel.getByTestId('abdm-request').first()).toContainText('Waiting for the patient')

  // The consent manager notifies the patient: a neutral SMS with the portal link (brand hidden: disclosure not cleared yet).
  const sms = await waitForSms(p.phone, since, (s) => s.templateKey === 'abdm.consent_request')
  expect(sms.body).toContain('/p/login?next=/p/abdm')
  expect(sms.body).toContain('Setu Records')
  expect(diagnosisHits(sms.body)).toEqual([])

  // The patient approves in the portal (standing in for the ABHA app).
  const patient = await portalLogin(p.phone)
  const pctx = await patient.browserContext(browser)
  const portal = await pctx.newPage()
  await portal.goto('/p/abdm?lang=en')
  const card = portal.getByTestId('abdm-consent').first()
  await expect(card).toContainText('Your clinic team asks to bring in records')
  await expect(card).toContainText('Test and scan reports, Hospital discharge papers')
  expect(diagnosisHits(await portal.locator('main').innerText())).toEqual([])
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(portal.getByText('Thank you. Your approval is saved.')).toBeVisible({ timeout: 60_000 })
  await expect(card).toContainText('Documents brought in: 5')

  // Decrypted bundles → documents (intake abdm) and events marked structured, with FHIR evidence.
  const docs = (await documentsOf(p.id)).filter((d) => d.intakeRoute === 'abdm')
  expect(docs.map((d) => d.docType).sort()).toEqual(['consult_note', 'discharge_summary', 'imaging_report', 'lab_report', 'prescription_printed'])
  const evs = await abdmEvents(p.id)
  expect(evs).toHaveLength(7)
  expect(new Set(evs.map((e) => e.extractionMethod))).toEqual(new Set(['structured_map']))
  const proc = evs.find((e) => e.eventType === 'procedure_documented')!
  const [ev] = await evidenceOf(proc.id)
  expect(ev).toMatchObject({ quote: null, fhirResourceRef: expect.stringMatching(/^Procedure\//) })
  const rx = evs.find((e) => e.eventType === 'prescription_documented')!
  expect((await evidenceOf(rx.id))[0].fhirResourceRef).toMatch(/^Composition\/[0-9a-f-]+#440545006$/)
  expect(JSON.stringify(evs.map((e) => e.fields))).not.toMatch(/Stage IIA|Grade 2|once daily|1-0-1/) // never inferred, never dosed

  // Radar recomputed over them: the excision documented on 10 Mar 2026 expects a histopathology report.
  expect((await missingOf(p.id)).find((m) => m.triggerEventId === proc.id)).toMatchObject({ ruleId: 'RAD-SURG-HPE-01', state: 'expected' })

  // The clinician's ledger lists them as newly received older records, labelled as ABDM structured.
  const cl = await ui('clinician')
  await cl.goto(`/patients/${p.id}/ledger`)
  expect(await count(cl, 'Older papers that arrived late')).toBe(7)
  const older = sectionOf(cl, 'Older papers that arrived late')
  await expect(older).toContainText('ABDM record · Structured')
  await expect(older).toContainText('Wide local excision, left breast')
  // Its source link opens the FHIR source view on that resource (and logs the view, FR-VER-03).
  await cl.goto(`/patients/${p.id}/documents/${proc.documentId}?event=${proc.id}`)
  await expect(cl.getByText('ABDM · structured').first()).toBeVisible()
  await expect(cl.getByText('Structured source: copied from FHIR resources')).toBeVisible()
  await expect(cl.locator(`#r-${proc.id}`)).toContainText('"resourceType": "Procedure"')
  await expect(cl.locator(`#ev-${proc.id}`)).toContainText(ev.fhirResourceRef!)

  // Staff see the granted request and the transfer; the received bundles carry the structured chip.
  await page.reload()
  await expect(panel.getByTestId('abdm-request').first()).toContainText('Granted')
  await expect(panel).toContainText('Transfer transferred')
  await expect(panel.getByRole('list', { name: 'ABDM documents' }).getByRole('listitem')).toHaveCount(5)
  await expect(panel.getByRole('list', { name: 'ABDM documents' })).toContainText('ABDM · structured')

  // The patient withdraws the approval: everything ABDM brought in is erased; the earlier upload stays.
  await card.getByRole('button', { name: 'Withdraw approval and remove these records' }).click()
  await card.getByRole('button', { name: 'Yes, remove them' }).click()
  await expect(portal.getByText('Approval withdrawn. The records are removed from your file.')).toBeVisible({ timeout: 60_000 })
  await expect(card).toContainText('Approval withdrawn, records removed')
  expect(await abdmEvents(p.id)).toEqual([])
  expect((await documentsOf(p.id)).filter((d) => d.intakeRoute === 'abdm')).toEqual([])
  expect((await documentsOf(p.id)).length).toBe(1)
  expect((await missingOf(p.id)).filter((m) => m.ruleId === 'RAD-SURG-HPE-01' && m.state === 'expected')).toEqual([])
  await page.reload()
  await expect(panel.getByTestId('abdm-request').first()).toContainText('Revoked · erased')
  await pctx.close()
  await patient.dispose()
})

test('V11 J6 ABDM: no `abdm` consent purpose → the request is refused and nothing is asked of the patient', async ({ staff }) => {
  const records = await staff('records')
  const p = await registerWithAbha(records, false)
  const r = await records.post(`/api/patients/${p.id}/abdm/consent-requests`, { hiTypes: ['Prescription'], from: '2025-01-01', to: '2026-10-31' })
  expect(r.status).toBe(403)
  expect(r.body.error.code).toBe('consent_required')
  const view = await records.get(`/api/patients/${p.id}/abdm`)
  expect(view.body).toMatchObject({ ready: { abha: true, consent: false }, requests: [] })
  // The patient-side route cannot answer someone else's (or a made-up) request.
  const patient = await portalLogin(p.phone)
  expect((await patient.post('/api/p/abdm/00000000-0000-4000-8000-000000000000', { decision: 'approve' })).status).toBe(404)
  await patient.dispose()
})
