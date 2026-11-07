// V10-E2E-01 (PRD §13): the judge demo in docs/DEMO.md, walked step by step in the Ganga org with an assertion at each step.
// The data the demo seed builds for the hero (Sunita Deshmukh) is built here the same way, through the app's own API.
// It moves the org clock (the +7 day reminder step), so it runs alone in the `clock` project.
// Not walked here:
//   - the returning patient's Change Ledger (3:40-4:40): it needs a seal dated in the past and pre-visit answers; that
//     journey is V03-E2E-02..05.
//   - "LLM, consent-gated": it needs the Gemini API (an external service); Ganga runs rule-based only.
//   - the fulfilled patient's seeded link (4:40-5:10): the same request-to-fulfilled-to-share path is steps 4-8 below.
//   - the Demo phone drawer: codes and SMS are read from the outbox table the drawer reads.
import { tp } from '../../src/i18n/patient'
import { ALL_PURPOSES, portalLogin, registerPatient, until, uploadDemo, waitDoc } from './helpers/api'
import { closeEncounters, eventsOf, missingOf, smsTo, snapshotsOf } from './helpers/db'
import { createShare } from './helpers/flows'
import { test, expect } from './helpers/fixtures'
import { SHADOW_RULE } from './global-setup'
import { diagnosisHits, legalHits, radarHits } from './helpers/text'

const BACKLOG = ['hero__01-discharge-summary.pdf', 'hero__02-chemo-daycare-cycle4.pdf', 'hero__03-ct-thorax-abdomen.jpg', 'hero__04-prescription-printed.pdf',
  'hero__05-prescription-handwritten.jpg', 'hero__06-cbc-hindi.jpg', 'hero__07-wrong-patient-histopathology.pdf', 'hero__08-lab-report-injection.pdf', 'hero__09-mammography-2024.pdf']
const HPE = 'RAD-SURG-HPE-01', CYCLES = 'RAD-CHEMO-PRIOR-01', PENDING = 'RAD-PEND-01'
const itemOf = async (patientId: string, ruleId: string) => (await missingOf(patientId)).find((m) => m.ruleId === ruleId)!

test('V10-E2E-01 the demo script (docs/DEMO.md), hero journey and admin, step by step @clock', async ({ staff, ui, browser }) => {
  test.setTimeout(900_000)
  const desk = await staff('desk'), records = await staff('records'), admin = await staff('admin')

  // ── Seed (what scripts/seed-demo.ts does for the hero): son is primary contact, disclosure unknown, Hindi, AI declined.
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'caregiver', disclosure: 'unknown', preferredLanguage: 'hi', purposes: { ...ALL_PURPOSES, ai: false } })
  const docs: Record<string, string> = {}
  await Promise.all(BACKLOG.map(async (f) => { docs[f] = (await uploadDemo(records, p.id, f)).documentId; await waitDoc(records, docs[f]) }))
  // The cycles 1-3 letter, given to the day-care centre today (the +7 day step reads it).
  const cyclesReq = (await records.post('/api/requests', { patientId: p.id, missingIds: [(await itemOf(p.id, CYCLES)).id], institution: 'Kasturi Day-Care', lang: 'hi' })).body.id as string
  expect((await records.post(`/api/requests/${cyclesReq}/sent`, {})).ok).toBe(true)
  await closeEncounters(p.id) // the demo starts at a later visit: the desk must verify again

  await test.step('1 · desk lookup: initials and accession only; the code goes to the son in Hindi; the record opens', async () => {
    const page = await ui('desk')
    await page.goto('/desk')
    // By phone, not by name: every Ganga test registers a "Sunita Deshmukh", and a name search lists at most 50.
    await page.getByRole('tab', { name: 'Phone' }).click()
    await page.getByLabel('Phone').fill(p.phone!)
    await page.getByRole('button', { name: 'Look up' }).click()
    const hits = page.getByRole('list', { name: 'Matches' }).getByRole('button')
    await expect(hits).toHaveCount(1)
    await expect(hits).toContainText(`ACC. ${p.accession}`)
    await expect(hits).not.toContainText(/Sunita|Deshmukh/)
    await hits.click()
    const since = Date.now() - 2000
    await page.getByRole('button', { name: 'Send code' }).click()
    const sms = await until(async () => (await smsTo(p.caregiverPhone!)).find((m) => m.templateKey === 'desk.otp' && m.createdAt.getTime() >= since))
    expect(sms.lang).toBe('hi')
    expect(sms.body).toContain('Setu Records')
    expect(diagnosisHits(sms.body)).toEqual([])
    await page.getByLabel('Code from the SMS').fill(sms.body.match(/\b(\d{6})\b/)![1])
    await page.getByRole('button', { name: 'Verify and open' }).click()
    await expect(page).toHaveURL(new RegExp(`/patients/${p.id}`))
  })

  await test.step('2 · documents: wrong patient held, hidden instructions removed, handwriting image-only, quotes highlighted', async () => {
    const list = (await records.get(`/api/patients/${p.id}/documents`)).body
    expect(list.rows).toHaveLength(9)
    const page = await ui('records')
    await page.goto(`/patients/${p.id}/documents`)
    await expect(page.getByText('Hidden instructions removed')).toBeVisible()
    await expect(page.getByText('Handwritten: kept as an image').first()).toBeVisible()
    await page.goto(`/patients/${p.id}/documents/${docs['hero__07-wrong-patient-histopathology.pdf']}`)
    await expect(page.getByRole('button', { name: 'Reject — not this patient' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Attach with reason' })).toBeVisible()
    const evs = await eventsOf(p.id)
    expect(evs.filter((e) => e.documentId === docs['hero__07-wrong-patient-histopathology.pdf'])).toEqual([])
    expect(evs.filter((e) => e.documentId === docs['hero__05-prescription-handwritten.jpg'])).toEqual([])
    // The source viewer: the procedure on page 2 of the discharge summary lights its exact words.
    const fromDs = evs.filter((e) => e.documentId === docs['hero__01-discharge-summary.pdf'])
    const proc = fromDs.find((e) => e.eventType === 'procedure_documented')!
    await page.goto(`/patients/${p.id}/documents/${docs['hero__01-discharge-summary.pdf']}?event=${proc.id}`)
    await expect(page.locator('mark.ds-sweep').first()).toContainText(/wide local excision/i)
    // Diagnosis and history as written are kept from the discharge summary (clinician tier).
    expect(fromDs.map((e) => e.eventType)).toEqual(expect.arrayContaining(['diagnosis_documented', 'history_documented']))
  })

  await test.step('3 · completeness: histopathology, laboratory report pending and one grouped item for cycles 1-3, in administrative words', async () => {
    const page = await ui('records')
    await page.goto(`/patients/${p.id}/completeness`)
    const hpe = await itemOf(p.id, HPE)
    await expect(page.locator(`article#m-${hpe.id}`)).toContainText('Histopathology report not in file for the procedure documented on 12 Mar 2026')
    await expect(page.locator(`article#m-${(await itemOf(p.id, PENDING)).id}`)).toContainText('Laboratory report mentioned as pending on 14 Mar 2026 is not in file')
    // The IHC item: Ganga keeps its rule in shadow (global-setup, for V04-E2E-08), so it is computed but not listed; the demo org lists it.
    const ihc = await itemOf(p.id, SHADOW_RULE)
    expect(ihc.mode).toBe('shadow')
    await expect(page.locator(`article#m-${ihc.id}`)).toHaveCount(0)
    expect((await missingOf(p.id)).filter((m) => m.ruleId === CYCLES)).toHaveLength(1)
    await expect(page.locator(`article#m-${(await itemOf(p.id, CYCLES)).id}`)).toContainText('Chemotherapy records for cycles 1–3 are not in file')
    expect(radarHits(await page.locator('main').innerText())).toEqual([])
  })

  await test.step('4 · request letter from the histopathology frame: hospital prefilled, Hindi letter, no deadline claimed', async () => {
    const page = await ui('records')
    await page.goto(`/patients/${p.id}/completeness`)
    await page.locator(`article#m-${(await itemOf(p.id, HPE)).id}`).getByRole('button', { name: 'Request', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Hospital or clinic')).toHaveValue(/triveni multispeciality hospital/i)
    await dialog.getByLabel('Letter language').selectOption('hi')
    await dialog.getByRole('button', { name: 'Create letter' }).click()
    const href = await dialog.getByRole('link', { name: 'Letter · Hindi' }).getAttribute('href')
    await page.goto(href!)
    await expect(page.locator('[lang="hi"]').first()).toBeAttached()
    const text = await page.locator('body').innerText()
    expect(text).toContain('Setu Records')
    expect(legalHits(text)).toEqual([])
    expect(text).not.toMatch(/deadline|कानूनी|बाध्य/i)
    // Given to the family to hand over.
    const req = (await records.get(`/api/requests?patientId=${p.id}`)).body.requests.find((r: { id: string }) => r.id !== cyclesReq)
    expect((await records.post(`/api/requests/${req.id}/sent`, {})).ok).toBe(true)
  })

  await test.step('5 · the son signs in to the portal (Hindi, Setu Records, no diagnosis words) and sends the report', async () => {
    const caregiver = await portalLogin(p.caregiverPhone!)
    const ctx = await caregiver.browserContext(browser)
    const page = await ctx.newPage()
    await page.goto('/p')
    await expect(page.locator('div[lang="hi"]').first()).toBeAttached() // the patient shell carries the language
    const home = await page.locator('body').innerText() // the brand is in the shell header
    expect(home).toContain('Setu Records')
    expect(home).not.toMatch(/onco/i)
    expect(diagnosisHits(home)).toEqual([])
    expect(home).toMatch(/कहाँ पूछें: TRIVENI MULTISPECIALITY HOSPITAL/i)
    await page.goto('/p/upload')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: tp('hi', 'chooseFiles') }).click()
    await (await chooser).setFiles('public/demo-docs/hero__10-histopathology-later.pdf')
    await expect(page.getByText(tp('hi', 'uploadReceived'))).toBeVisible()
    await ctx.close()
    await caregiver.dispose()
  })

  await test.step('6 · staff confirm the proposed closure (institution differs); the request is fulfilled', async () => {
    const hpe = await until(async () => { const m = await itemOf(p.id, HPE); return m.state === 'received' && m }, 120_000)
    await waitDoc(records, hpe.proposedDocumentId!)
    const page = await ui('records')
    await page.goto(`/patients/${p.id}/completeness`)
    const card = page.locator(`article#m-${hpe.id}`)
    await expect(card).toContainText('From a different hospital than the one that mentioned it') // E-RAD-01: Nirnay lab vs Triveni hospital
    await card.getByRole('button', { name: 'Confirm closure' }).click()
    await expect(page.getByRole('dialog')).toContainText('Institution differs from the one in the triggering record (E-RAD-01)')
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm closure' }).click()
    await expect.poll(async () => (await itemOf(p.id, HPE)).state).toBe('closed')
    const req = (await records.get(`/api/requests?patientId=${p.id}`)).body.requests.find((r: { id: string }) => r.id !== cyclesReq)
    expect(req.state).toBe('fulfilled')
  })

  await test.step('7 · the clinician seals the visit (S0); the public /verify page says the record has not changed', async () => {
    const page = await ui('clinician')
    await page.goto(`/patients/${p.id}/ledger`)
    await page.getByRole('button', { name: 'Seal this visit' }).click() // DEMO.md still says "Seal snapshot S0"
    await page.getByRole('dialog').getByRole('button', { name: 'Seal it' }).click()
    const check = page.getByRole('dialog').getByRole('link', { name: 'Check the seal (public page)' })
    await expect(check).toBeVisible()
    const [s0] = await snapshotsOf(p.id)
    expect(s0.seq).toBe(0)
    expect(await check.getAttribute('href')).toBe(`/verify/${s0.id}`)
    const anon = await browser.newContext()
    const pub = await anon.newPage()
    await pub.goto(`/verify/${s0.id}`)
    await expect(pub.getByText('This record has not changed since it was sealed.')).toBeVisible()
    await anon.close()
  })

  await test.step('8 · share link (7 days, passcode): document index, signature verified, absent documents in neutral words', async () => {
    const share = await createShare(records, p.id, { passcode: '246810', days: 7 })
    const anon = await browser.newContext()
    const viewer = await anon.newPage()
    await viewer.goto(share.url)
    await viewer.getByLabel('Passcode').fill('246810')
    await viewer.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(viewer.getByRole('heading', { level: 1, name: 'Document index, not a clinical summary' })).toBeVisible()
    await expect(viewer.getByText(/Signature verified — issued by Setu Records/)).toBeVisible()
    await expect(viewer.getByRole('heading', { name: 'Documents not in this file' })).toBeVisible()
    const text = await viewer.locator('body').innerText()
    expect(text).toMatch(/not in file/i)
    expect(diagnosisHits(text)).toEqual([])
    expect(text).not.toMatch(/onco|Deshpande/i)
    await anon.close()
  })

  await test.step('admin · rules reviewed, audit chain intact, metrics, +7 days: the cycles letter is due and the son gets one neutral reminder', async () => {
    const page = await ui('admin')
    await page.goto('/admin/rules')
    expect(await page.getByText(/Reviewed by /).count()).toBeGreaterThanOrEqual(9) // Ganga keeps one rule in shadow for V04-E2E-08
    await page.goto('/admin/audit')
    await page.getByRole('button', { name: 'Verify chain' }).click()
    await expect(page.getByText(/Intact · \d+ entries verified/)).toBeVisible({ timeout: 120_000 })
    await page.goto('/admin/metrics')
    await expect(page.getByText(/Fulfilment rate/).first()).toBeVisible()
    try {
      expect((await admin.post('/api/admin/settings/demo-clock', { preset: 'plus7' })).body.offsetDays).toBe(7)
      const rec = await ui('records')
      await rec.goto(`/patients/${p.id}/requests`) // tracking is lazy: the first read after the threshold moves the state
      const cycles = (await records.get(`/api/requests?patientId=${p.id}`)).body.requests.find((r: { id: string }) => r.id === cyclesReq)
      expect(cycles.state).toBe('reminder_due')
      const reminder = (await smsTo(p.caregiverPhone!)).filter((m) => m.templateKey === 'request.reminder7')
      expect(reminder).toHaveLength(1)
      expect(reminder[0]).toMatchObject({ lang: 'hi' })
      expect(reminder[0].body).toContain('Setu Records')
      expect(diagnosisHits(reminder[0].body)).toEqual([])
    } finally {
      await admin.post('/api/admin/settings/demo-clock', { preset: 'reset' })
    }
  })
})
