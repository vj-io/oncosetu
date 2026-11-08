// V04-E2E-01..08 (PRD §13, v0.4 Missing-Record Radar, Records Request Kit, share link). Tests marked @clock move the org clock and run alone.
import type { Page } from '@playwright/test'
import { formatDateIN, istDate } from '../../src/core/copy'
import { Api, demoDoc, portalLogin, registerPatient, until, uploadAndWait, uploadDemo, waitDoc } from './helpers/api'
import { documentsOf, missingOf, smsAbout } from './helpers/db'
import { createShare, parseCsv, seal } from './helpers/flows'
import { test, expect } from './helpers/fixtures'
import { diagnosisHits, legalHits, radarHits } from './helpers/text'

const HPE = 'RAD-SURG-HPE-01'
const itemOf = async (patientId: string, ruleId: string) => (await missingOf(patientId)).find((m) => m.ruleId === ruleId)

/** The share viewer in a browser with no account: opens with the passcode, returns the page text. */
async function openShare(page: Page, share: { url: string }, passcode: string) {
  await page.goto(share.url)
  await page.getByLabel('Passcode').fill(passcode)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Document index, not a clinical summary' })).toBeVisible()
  return page.locator('body').innerText()
}

test('V04-E2E-01 a discharge summary with an excision lists the histopathology report as not in file, with its source quote', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const up = await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  const item = (await itemOf(p.id, HPE))!
  expect(item).toMatchObject({ mode: 'production', state: 'expected' })
  const wording = (item.matchWindow as { wording: { en: string; hi: string } }).wording
  expect(wording.en).toMatch(/^Histopathology report not in file for the procedure documented on 12 Mar 2026/)
  // Administrative wording only: nothing from the banned list (needs, should, urgent, risk, ...), in English or Hindi.
  expect(radarHits(wording.en)).toEqual([])
  expect(radarHits(wording.hi)).toEqual([])

  const page = await ui('records')
  await page.goto(`/patients/${p.id}/completeness`)
  const card = page.locator(`article#m-${item.id}`)
  await expect(card).toContainText('Histopathology report not in file for the procedure documented on 12 Mar 2026')
  await expect(card.locator('q')).toContainText('Wide local excision done on 12/03/2026') // the source quote
  await expect(card.getByRole('link', { name: /Show the exact words/ })).toHaveAttribute('href', new RegExp(`/documents/${up.documentId}\\?event=`))
  const shown = await card.locator('h3, [class*="Empty"]').first().innerText().catch(() => '')
  expect(radarHits(shown + ' ' + (await card.innerText()))).toEqual([])
})

test('V04-E2E-02 request letter EN + HI, mark sent, reminder at +7 days (one SMS), open at +21 days with the escalation sheet @clock', async ({ staff, ui }) => {
  test.setTimeout(420_000)
  const records = await staff('records'), admin = await staff('admin')
  const p = await registerPatient(records, { base: 'hero' }) // caregiver-primary: reminders go to the caregiver
  await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  const item = (await itemOf(p.id, HPE))!
  const made = await records.post('/api/requests', { patientId: p.id, missingIds: [item.id], institution: 'Triveni Multispeciality Hospital', institutionPatientId: 'TMH-0048213', lang: 'en' })
  expect(made.ok).toBe(true)
  const rid: string = made.body.id

  // The letter, in both languages: correct details, no deadline or obligation claims, neutral brand.
  const page = await ui('records')
  for (const lang of ['en', 'hi'] as const) {
    await page.goto(`/print/request/${rid}?lang=${lang}`)
    const text = await page.locator('body').innerText()
    expect(text, lang).toContain('Sunita Deshmukh')
    expect(text, lang).toContain('Triveni Multispeciality Hospital')
    expect(text, lang).toContain('TMH-0048213')
    if (lang === 'en') expect(text).toContain('14 Aug 1974') // date of birth, as registered
    expect(text, lang).toContain('Setu Records')
    expect([lang, legalHits(text)]).toEqual([lang, []])
    expect([lang, radarHits(text)]).toEqual([lang, []])
    // The only reference to the regulation is the neutral one the PRD asks for (FR-REQ-01): no deadline, duty or legal claim of ours.
    expect(text, lang).not.toMatch(/deadline|\bmust\b|\blegally\b|\bobliged\b|required to|कानूनी|बाध्य/i)
  }
  await page.goto(`/print/request/${rid}?lang=en`)
  await expect(page.locator('body')).toContainText('the regulations provide for indoor records to be issued within 72 hours of a request')
  await page.goto(`/print/request/${rid}?lang=hi`)
  await expect(page.locator('html[lang="hi"], [lang="hi"]').first()).toBeAttached()

  // A hospital name with a diagnosis word keeps only its safe part on a letter the patient carries (disclosure not cleared).
  const guarded = (await records.post('/api/requests', { patientId: p.id, missingIds: [], institution: 'Nirnay Pathology and Onco-Diagnostics', lang: 'en' })).body.id
  await page.goto(`/print/request/${guarded}?lang=en`)
  const blank = await page.locator('body').innerText()
  expect(blank).not.toMatch(/onco/i)
  expect(blank).toContain('Nirnay Pathology')
  expect((await records.post(`/api/requests/${guarded}/withdraw`, {})).ok).toBe(true)

  // Mark as given to the hospital: the item moves to "requested".
  expect((await records.post(`/api/requests/${rid}/sent`, {})).body.state).toBe('sent')
  expect((await itemOf(p.id, HPE))!.state).toBe('requested')
  const state = async () => (await records.get(`/api/requests?patientId=${p.id}`)).body.requests.find((r: any) => r.id === rid)
  const reminders = async () => (await smsAbout(p.id)).filter((m) => m.templateKey.startsWith('request.'))
  expect((await state()).state).toBe('sent')
  expect(await reminders()).toHaveLength(0)

  try {
    // +7 days: reminder_due, and exactly one neutral SMS to the primary contact, however often the page is read.
    expect((await admin.post('/api/admin/settings/demo-clock', { preset: 'plus7' })).body.offsetDays).toBe(7)
    expect((await state()).state).toBe('reminder_due')
    await state(); await state()
    const first = await reminders()
    expect(first.map((m) => m.templateKey)).toEqual(['request.reminder7'])
    expect(diagnosisHits(first[0].body)).toEqual([])
    expect(first[0].body).not.toMatch(/onco/i)

    // +21 days: open_21d, one more SMS (the day-21 one), and the information sheet is offered.
    expect((await admin.post('/api/admin/settings/demo-clock', { preset: 'plus21' })).body.offsetDays).toBe(21)
    expect((await state()).state).toBe('open_21d')
    await state()
    expect((await reminders()).map((m) => m.templateKey).sort()).toEqual(['request.reminder21', 'request.reminder7'])
    await page.goto(`/patients/${p.id}/requests`)
    const sheet = page.getByRole('link', { name: 'If the hospital has not responded: information sheet' })
    await expect(sheet).toHaveAttribute('href', /\/print\/escalation/)
    await page.goto('/print/escalation')
    const esc = await page.locator('body').innerText()
    expect(esc).not.toContain('Deshmukh') // no patient data on the sheet
    expect(legalHits(esc)).toEqual([])
  } finally {
    await admin.post('/api/admin/settings/demo-clock', { preset: 'reset' })
  }
})

test('V04-E2E-03 the report arrives through the patient portal: closure proposed, records confirm, request fulfilled', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero', primaryContact: 'patient' })
  await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  const item = (await itemOf(p.id, HPE))!
  const rid = (await records.post('/api/requests', { patientId: p.id, missingIds: [item.id], institution: 'Nirnay Pathology', lang: 'en' })).body.id
  await records.post(`/api/requests/${rid}/sent`, {})
  const before = await documentsOf(p.id)

  // The patient's own phone and SMS code open the portal; the histopathology report is uploaded there.
  const patient = await portalLogin(p.phone!)
  expect((await patient.get('/api/auth/me')).body.session.kind).toBe('patient')
  expect((await patient.upload('/api/p/documents', { name: 'hero__10.pdf', buffer: demoDoc('hero__10-histopathology-later.pdf').buffer })).ok).toBe(true)
  const doc = await until(async () => (await documentsOf(p.id)).find((d) => d.intakeRoute === 'patient_link' && !before.some((b) => b.id === d.id)))
  expect((await waitDoc(records, doc.id)).docType).toBe('pathology_report')
  // The Radar proposes closure; nothing closes until a person confirms.
  const proposed = await until(async () => { const m = (await itemOf(p.id, HPE))!; return m.state === 'received' && m })
  expect(proposed.proposedDocumentId).toBe(doc.id)
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/completeness`)
  await expect(page.locator(`article#m-${item.id}`)).toContainText('From a different hospital than the one that mentioned it') // E-RAD-01: the report comes from another lab than the hospital
  let req = (await records.get(`/api/requests?patientId=${p.id}`)).body.requests[0]
  expect(req.state).not.toBe('fulfilled')

  const done = await records.post(`/api/missing/${item.id}/transition`, { action: 'confirm' })
  expect(done.ok).toBe(true)
  expect((await itemOf(p.id, HPE))!.state).toBe('closed')
  req = (await records.get(`/api/requests?patientId=${p.id}`)).body.requests[0]
  expect(req.state).toBe('fulfilled')
  expect(req.fulfilledAt).toBeTruthy() // the fulfilment time that the metrics read
  const apage = await ui('admin')
  await apage.goto('/admin/metrics')
  const text = await apage.locator('main').innerText()
  const m = text.match(/Fulfilment rate\s*[\s\S]*?\((\d+) of (\d+) sent\)/)
  expect(Number(m?.[1])).toBeGreaterThanOrEqual(1)
})

test('V04-E2E-04 chemotherapy cycle 4 documented without earlier records: one grouped item for cycles 1-3', async ({ staff, ui }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  await uploadAndWait(records, p.id, 'hero__02-chemo-daycare-cycle4.pdf')
  const items = (await missingOf(p.id)).filter((m) => m.ruleId === 'RAD-CHEMO-PRIOR-01')
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ mode: 'production', state: 'expected' })
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/completeness`)
  await expect(page.locator('article[id^="m-"]')).toHaveCount(1)
  await expect(page.locator(`article#m-${items[0].id}`)).toContainText('Chemotherapy records for cycles 1–3 are not in file')
  await expect(page.locator(`article#m-${items[0].id}`)).toContainText('asked for together in one request')
})

/** A sealed record of the hero patient from fast PDFs, plus a share created by `by`. */
async function sealedHero(staff: (r: 'desk' | 'records' | 'clinician' | 'admin') => Promise<Api>, o: { disclosure?: 'cleared' | 'not_cleared' | 'unknown'; files?: string[] } = {}) {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(o.disclosure && o.disclosure !== 'unknown' ? clinician : records, { base: 'hero', disclosure: o.disclosure ?? 'unknown' })
  for (const f of o.files ?? ['hero__01-discharge-summary.pdf']) await uploadAndWait(records, p.id, f)
  const sealed = await seal(clinician, p.id)
  return { p, sealed, records, clinician }
}

test('V04-E2E-05 caregiver shares the document index (7 days, passcode): the viewer shows heading, provenance, absent list; the view is logged', async ({ staff, ui, browser }) => {
  const { p } = await sealedHero(staff)
  const caregiver = await portalLogin(p.caregiverPhone!)
  expect((await caregiver.get('/api/auth/me')).body.session.kind).toBe('caregiver')
  const share = await createShare(caregiver, p.id, { actor: 'patient', passcode: '739204', days: 7 })
  const days = (Date.parse(share.expiresAt) - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(6.99)
  expect(days).toBeLessThanOrEqual(7.001)

  const fresh = await browser.newContext() // the receiving doctor: no account, no cookies
  const viewer = await fresh.newPage()
  const text = await openShare(viewer, share, '739204')
  await expect(viewer.getByRole('heading', { name: 'Recorded items' })).toBeVisible()
  await expect(viewer.getByRole('heading', { name: 'Documents not in this file' })).toBeVisible()
  // FR-PAS-03: the PRD's statement (brand neutral until disclosure is cleared) and the as-of date of the seal.
  expect(text).toContain('This summary contains only records provided to Setu Records.')
  expect(text).toContain(`As of ${formatDateIN(istDate(share.payload.asOf))} (sealed record)`)
  // Provenance on every recorded line: where it is written, and whether a person verified it.
  const lines = viewer.locator('ol > li')
  expect(await lines.count()).toBeGreaterThan(0)
  for (const t of await lines.allInnerTexts()) { expect(t).toMatch(/source/i); expect(t).toMatch(/p\.\d+/); expect(t).toMatch(/checked/i) }
  expect(text).toMatch(/not in file/i) // absent-documents list
  await fresh.close()

  // Every open shows in the staff log and in the patient's own access log.
  const staffPage = await ui('records')
  await staffPage.goto(`/patients/${p.id}/shares`)
  const row = staffPage.getByRole('row').filter({ hasText: 'Working' }).first()
  await expect(row).toContainText('passcode')
  await row.locator('summary').click()
  await expect(row).toContainText(/Opened/)
  const pctx = await caregiver.browserContext(browser)
  const pp = await pctx.newPage()
  await pp.goto('/p/access?lang=en')
  await expect(pp.locator('main')).toContainText('A shared link was opened')
  await pctx.close()
})

test('V04-E2E-06 a revoked link answers 410 and the decryption key never reaches the server', async ({ staff, browser, anon }) => {
  const { p, records } = await sealedHero(staff)
  const share = await createShare(records, p.id, { passcode: '615823' })
  const seen: string[] = []
  const fresh = await browser.newContext()
  const viewer = await fresh.newPage()
  viewer.on('request', (r) => seen.push(`${r.method()} ${r.url()} ${r.postData() ?? ''}`))
  await openShare(viewer, share, '615823')
  // Nothing sent to the server carries the key (it lives in the URL fragment); the server holds ciphertext only.
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.filter((l) => l.includes(share.key))).toEqual([])
  const csv = ((await (await staff('admin')).get('/api/admin/audit.csv')).body as string)
  expect(csv).not.toContain(share.key)

  expect((await records.post(`/api/shares/${share.id}/revoke`, {})).ok).toBe(true)
  const open = await (await anon()).post(`/api/shares/${share.id}/open`, { data: { passcode: '615823' } })
  expect(open.status()).toBe(410)
  expect((await open.json()).error.message).toBe('This link is no longer available')
  await viewer.reload() // the same full link in the browser: neutral message, no passcode prompt, nothing decrypted
  await expect(viewer.locator('p[role="alert"]')).toContainText('This link is no longer available')
  await expect(viewer.getByRole('heading', { name: 'Document index, not a clinical summary' })).toHaveCount(0)
  await fresh.close()
})

test('V04-E2E-07 the share viewer for a not_cleared patient contains no diagnosis words', async ({ staff, browser }) => {
  const { p, records } = await sealedHero(staff, { disclosure: 'not_cleared', files: ['hero__01-discharge-summary.pdf', 'hero__02-chemo-daycare-cycle4.pdf', 'hero__04-prescription-printed.pdf'] })
  const share = await createShare(records, p.id, { passcode: '208416' })
  expect(share.payload.brand).toBe('Setu Records')
  const fresh = await browser.newContext()
  const text = await openShare(await fresh.newPage(), share, '208416')
  expect(diagnosisHits(text)).toEqual([])
  expect(text).not.toMatch(/onco/i)
  expect(diagnosisHits(JSON.stringify(share.payload))).toEqual([])
  // Source quotes are refused for this disclosure status.
  const quotes = await records.get(`/api/patients/${p.id}/share-payload?scope=index_with_quotes`)
  expect([quotes.status, quotes.body.error.code]).toEqual([403, 'quotes_not_allowed'])
  await fresh.close()
})

test('V04-E2E-08 an unreviewed (shadow) rule runs in shadow mode only: its item is never shown to clinicians', async ({ staff, ui }) => {
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero' })
  await uploadAndWait(records, p.id, 'hero__01-discharge-summary.pdf')
  const all = await missingOf(p.id)
  const shadow = all.find((m) => m.ruleId === 'RAD-HPE-IHC-01')!
  expect(shadow).toMatchObject({ mode: 'shadow' }) // detected and recorded, not surfaced
  expect(all.find((m) => m.ruleId === HPE)).toMatchObject({ mode: 'production' })
  // Production items: the histopathology report and the "pending laboratory reports" the discharge summary mentions.
  const production = all.filter((m) => m.mode === 'production')
  expect(production.map((m) => m.ruleId).sort()).toEqual([HPE, 'RAD-PEND-01'].sort())

  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/completeness`)
  await expect(page.locator('article[id^="m-"]')).toHaveCount(production.length)
  await expect(page.locator(`article#m-${shadow.id}`)).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('IHC report mentioned as pending')
  await page.goto(`/patients/${p.id}/ledger`)
  await expect(page.locator('main')).not.toContainText('IHC report mentioned as pending')
  // The sealed index and the share payload carry production items only.
  const sealed = await seal(clinician, p.id)
  expect(sealed.counts.missing).toBe(production.length)
  const payload = (await records.get(`/api/patients/${p.id}/share-payload`)).body
  expect(JSON.stringify(payload.absent)).not.toMatch(/IHC|immunohisto/i)
  // The administrator sees it counted as a shadow hit on the rule page, awaiting clinician review.
  const apage = await ui('admin')
  await apage.goto('/admin/rules')
  const rule = apage.locator('article, tr, li').filter({ hasText: 'RAD-HPE-IHC-01' }).first()
  await expect(rule).toContainText('Under review') // shadow mode
})
