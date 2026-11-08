// Timeline and ledger card detail (PRD §13 v0.3): FR-TML-02/03/04, FR-LED-04, quote-only lines shown as quotes (PRD §6.6),
// and FR-ID-06 errata after a seal. Every test registers its own synthetic patient in the Ganga org.
import { eq } from 'drizzle-orm'
import type { Page } from '@playwright/test'
import { formatDateIN } from '../../src/core/copy'
import type { Snapshot } from '../../src/core/ledger'
import { STAFF_ONLY_EVENT_TYPES } from '../../src/core/types'
import { adminDb } from '../../src/db'
import { staff as staffTable } from '../../src/db/schema'
import type { Answers } from '../../src/server/portal/visit-model'
import { portalLogin, registerPatient, uploadAndWait } from './helpers/api'
import { eventsOf, snapshotsOf } from './helpers/db'
import { EMAIL } from './helpers/env'
import { seal } from './helpers/flows'
import { test, expect } from './helpers/fixtures'
import { diagnosisHits } from './helpers/text'

const NO: Answers = { other_hospital: { yn: 'no' }, new_medicines: { yn: 'no' }, new_tests: { yn: 'no' }, admissions: { yn: 'no' }, anything_else: { yn: 'no' } }
const shownCount = async (page: Page) => {
  const m = (await page.getByText(/^\d+ of \d+ items/).innerText()).match(/^(\d+) of (\d+) items/i)! // shown in capitals by CSS
  return { shown: Number(m[1]), total: Number(m[2]) }
}
const cards = (page: Page) => page.locator('main li > article') // the corridor's placards
const apply = async (page: Page) => { await page.getByRole('button', { name: 'Apply' }).click(); await page.waitForLoadState('networkidle') }
const live = async (patientId: string) => (await eventsOf(patientId)).filter((e) => !e.withdrawnAt && e.eventType !== 'patient_statement')

test('FR-TML-02/03 + FR-LED-04 timeline badges, source chips, "Sources disagree", the four filters; ledger card WHO and WHEN', async ({ staff, ui }) => {
  test.setTimeout(300_000)
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
  const rx = await uploadAndWait(records, p.id, 'returning__06-prescription.pdf')
  const ds = await uploadAndWait(records, p.id, 'returning__01-discharge-summary.pdf')
  // A patient statement naming a medicine the prescription does not list: the prescription line is in conflict (E-LED-03).
  const patient = await portalLogin(p.phone!)
  const answers: Answers = { ...NO, new_medicines: { yn: 'yes', names: 'Letrozole', place: 'Sahyadri Hospital', month: 5, year: 2026 } }
  expect((await patient.post('/api/p/statements', { answers, lang: 'en', confirmation: 'confirmed' })).ok).toBe(true)

  // One item verified by the clinician: an event with its own date and a document date, so WHEN has all three dates.
  const evs = await live(p.id)
  const target = evs.find((e) => e.documentId === ds.documentId && e.eventDate && e.documentDate && !e.flags?.date_from_document && e.eventDate !== e.documentDate)
    ?? evs.find((e) => e.documentId === ds.documentId)!
  expect((await clinician.post(`/api/events/${target.id}/viewed`)).ok).toBe(true)
  expect((await clinician.post(`/api/events/${target.id}/verify`, { action: 'verify', rowVersion: target.rowVersion })).ok).toBe(true)
  const [{ name: clinicianName }] = await adminDb.select({ name: staffTable.name }).from(staffTable).where(eq(staffTable.email, EMAIL.clinician))

  // FR-LED-04 on the ledger card: WHO verified (name, role, date) and WHEN (event date, document date, received date).
  const led = await ui('clinician')
  await led.goto(`/patients/${p.id}/ledger`)
  const item = led.locator(`#item-${target.id}`)
  await item.locator('summary').click()
  await expect(item).toContainText(new RegExp(`Checked against the page by ${clinicianName} \\(clinician\\) · \\d{1,2} \\w{3} \\d{4}`))
  await expect(item).toContainText(/Received \d{1,2} \w{3} \d{4}/)
  if (target.eventDate && target.documentDate && !target.flags?.date_from_document) await expect(item).toContainText(`Document dated ${formatDateIN(target.documentDate)}`)

  // FR-TML-02: status badge, source chip, conflict marker, and the quote opens the source page.
  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/timeline`)
  const { shown, total } = await shownCount(page)
  expect(shown).toBe(total)
  expect(total).toBeGreaterThan(1)
  await expect(cards(page)).toHaveCount(total)
  await expect(cards(page).filter({ hasText: 'Checked against the page' })).toHaveCount(1)
  await expect(cards(page).filter({ hasText: 'Not yet checked' })).toHaveCount(total - 1)
  const disagree = cards(page).filter({ hasText: 'Sources disagree' })
  await expect(disagree).toHaveCount(1)
  await expect(disagree).toContainText('Capecitabine')
  await expect(disagree).toContainText('Prescription (printed)') // the source chip names the document
  await expect(disagree.getByRole('link', { name: /Show the exact words/ })).toHaveAttribute('href', new RegExp(`/patients/${p.id}/documents/${rx.documentId}\\?event=`))

  // FR-TML-03 through the page form: document type, hospital, source type, checked status.
  const clear = async () => {
    await page.getByRole('link', { name: 'Clear' }).click()
    await expect(page).toHaveURL(new RegExp(`/patients/${p.id}/timeline$`))
    expect(await shownCount(page)).toEqual({ shown: total, total })
    // the form shows the cleared state too (else the next Apply would quietly re-apply the old filter)
    for (const l of ['Document type', 'Hospital or lab', 'Where it came from', 'Checked?']) await expect(page.getByLabel(l)).toHaveValue('')
  }
  await page.getByLabel('Document type').selectOption({ label: 'Prescription (printed)' })
  await apply(page)
  const byType = await shownCount(page)
  expect(byType.shown).toBe((await live(p.id)).filter((e) => e.documentId === rx.documentId).length)
  expect(byType.shown).toBeLessThan(total)
  for (const c of await cards(page).all()) await expect(c).toContainText('Prescription (printed)')
  await expect(page).toHaveURL(/type=prescription_printed/)

  await clear()
  const hospital = page.getByLabel('Hospital or lab')
  const inst = (await hospital.locator('option').allInnerTexts()).find((t) => t !== 'All hospitals and labs')!
  await hospital.selectOption({ label: inst })
  await apply(page)
  const byInst = await shownCount(page)
  expect(byInst.shown).toBeGreaterThan(0)
  for (const c of await cards(page).all()) await expect(c).toContainText(inst)

  await clear()
  await page.getByLabel('Where it came from').selectOption({ label: 'Outside document' })
  await apply(page)
  expect(await shownCount(page)).toEqual({ shown: total, total }) // every item here came in on an outside document
  await page.goto(`/patients/${p.id}/timeline?source=patient_reported`)
  await expect(page.getByText('No items match these filters')).toBeVisible()

  await page.goto(`/patients/${p.id}/timeline`)
  await page.getByLabel('Checked?').selectOption({ value: 'verified' })
  await apply(page)
  expect(await shownCount(page)).toEqual({ shown: 1, total })
  await expect(cards(page).first()).toContainText('Checked against the page')
})

test('FR-TML-04 as-of view: the record as it stood at a sealed visit, after a later document', async ({ staff, ui }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero' })
  await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  const s0 = await seal(clinician, p.id)
  const snap = JSON.parse((await snapshotsOf(p.id))[0].canonicalJson) as Snapshot
  const sealedItems = snap.verified.length + snap.unverified.length
  await uploadAndWait(records, p.id, 'hero__04-prescription-printed.pdf')

  const page = await ui('records')
  await page.goto(`/patients/${p.id}/timeline`)
  const now = await shownCount(page)
  expect(now.total).toBeGreaterThan(sealedItems)
  await expect(page.getByText('Timeline · the record now')).toBeVisible()

  // Picked through the form ("Show the record as of"), then the same view by its address.
  await page.getByLabel('Show the record as of').selectOption({ value: s0.snapshotId })
  await apply(page)
  await expect(page).toHaveURL(new RegExp(`asOf=${s0.snapshotId}`))
  await expect(page.getByText('As it was at a sealed visit')).toBeVisible()
  await expect(page.getByText(/The record as it stood when the visit was sealed/)).toBeVisible()
  expect(await shownCount(page)).toEqual({ shown: sealedItems, total: sealedItems })
  await expect(page.getByRole('link', { name: 'Check this seal' })).toHaveAttribute('href', `/verify/${s0.snapshotId}`)
  await page.goto(`/patients/${p.id}/timeline?asOf=${s0.snapshotId}`)
  expect(await shownCount(page)).toEqual({ shown: sealedItems, total: sealedItems })
  await expect(cards(page)).toHaveCount(sealedItems)
})

test('PRD §6.6 a quote-only line (regimen as written) shows its source words only inside a quote, on the ledger and the timeline', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  await uploadAndWait(records, p.id, 'hero__02-chemo-daycare-cycle4.pdf') // a day-care visit plus a regimen line
  const quoteOnly = (await live(p.id)).filter((e) => STAFF_ONLY_EVENT_TYPES.has(e.eventType))
  expect(quoteOnly.length, 'the document holds a quote-only line').toBeGreaterThan(0)

  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/ledger`)
  for (const e of quoteOnly) {
    const q = page.locator(`#item-${e.id} summary q`)
    await expect(q).toHaveCount(1)
    expect((await q.innerText()).trim().length).toBeGreaterThan(0)
  }
  // An ordinary line (the day-care visit) is not quoted.
  const plain = (await live(p.id)).find((e) => !STAFF_ONLY_EVENT_TYPES.has(e.eventType))!
  await expect(page.locator(`#item-${plain.id} summary q`)).toHaveCount(0)

  await page.goto(`/patients/${p.id}/timeline`)
  const quoted = cards(page).filter({ has: page.locator('h4 q') })
  await expect(quoted).toHaveCount(quoteOnly.length)
})

test('FR-ID-06 detaching a document after a seal: erratum in the ledger, in the next sealed snapshot and on its passport', async ({ staff, ui }) => {
  test.setTimeout(300_000)
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero' }) // disclosure unknown: the passport uses neutral labels
  await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  const rx = await uploadAndWait(records, p.id, 'hero__04-prescription-printed.pdf')
  await seal(clinician, p.id)
  const s0 = JSON.parse((await snapshotsOf(p.id))[0].canonicalJson) as Snapshot
  const sealedRx = [...s0.verified, ...s0.unverified].filter((e) => e.documentId === rx.documentId).map((e) => e.id).sort()
  expect(sealedRx.length).toBeGreaterThan(0)

  const detached = await records.post(`/api/documents/${rx.documentId}/detach`, { reason: 'Attached to the wrong record at intake' })
  expect(detached.body).toMatchObject({ ok: true, withdrawnEvents: sealedRx.length, erratum: true })

  // The ledger lists the erratum against the last seal.
  const led = await ui('clinician')
  await led.goto(`/patients/${p.id}/ledger`)
  const removed = led.locator('section', { has: led.getByRole('heading', { name: 'Removed after sealing', exact: true }) })
  await expect(removed).toContainText(`${sealedRx.length} ${sealedRx.length === 1 ? 'item' : 'items'} withdrawn`)

  // The next seal records it; the earlier seal is not touched.
  const s1 = await seal(clinician, p.id)
  const rows = await snapshotsOf(p.id)
  const snap1 = JSON.parse(rows[1].canonicalJson) as Snapshot
  expect(snap1.errata).toEqual([{ documentId: rx.documentId, docType: 'prescription_printed', detachedAt: expect.any(String), withdrawnEventIds: sealedRx }])
  expect(snap1.documents.map((d) => d.id)).not.toContain(rx.documentId)
  expect(JSON.parse(rows[0].canonicalJson)).not.toHaveProperty('errata')

  // The passport of the new seal shows the correction, in neutral words.
  const page = await ui('records')
  await page.goto(`/print/passport/${s1.snapshotId}`)
  const errata = page.locator('section[aria-labelledby="errata-h"]')
  await expect(errata.getByRole('heading', { name: 'Corrections since the previous sealed record' })).toBeVisible()
  await expect(errata).toContainText(new RegExp(`Prescription · taken out on \\d{1,2} \\w{3} \\d{4} · items withdrawn: ${sealedRx.length}`))
  expect(diagnosisHits(await page.locator('article').innerText())).toEqual([])
  // The passport of S0 has no correction section.
  await page.goto(`/print/passport/${rows[0].id}`)
  await expect(page.locator('section[aria-labelledby="errata-h"]')).toHaveCount(0)
})
