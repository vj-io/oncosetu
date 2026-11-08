// Patient portal and registration gates (PRD §13): FR-VOX-07 "anything else" kept verbatim, FR-VOX-04 the edit path
// of the read-back, FR-ID-08 a patient stops a lost card, FR-CON-03 a child's codes go to the guardian, and FR-VOX-01
// questions the hospital configures (that one changes org settings shared by every test, so it runs alone: @clock).
import { eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { orgSettings, type OrgFlags } from '../../src/db/schema'
import { CONSENT_NOTICE_VERSION } from '../../src/i18n/consent'
import { en } from '../../src/i18n/patient'
import type { Answers } from '../../src/server/portal/visit-model'
import { freshPhone, portalLogin, registerPatient, sleep, waitForSms, type Api } from './helpers/api'
import { auditOf, caregiversOf, patientRow, smsTo, statementsOf } from './helpers/db'
import { ORG } from './helpers/env'
import { test, expect } from './helpers/fixtures'
import type { Page } from '@playwright/test'

const NO: Answers = { other_hospital: { yn: 'no' }, new_medicines: { yn: 'no' }, new_tests: { yn: 'no' }, admissions: { yn: 'no' }, anything_else: { yn: 'no' } }
const sectionOf = (page: Page, title: string) => page.locator('section', { has: page.getByRole('heading', { name: title, exact: true }) })

test('FR-VOX-07 an "anything else" answer reaches the clinician verbatim as the patient\'s words, never classified', async ({ staff, ui }) => {
  const clinician = await staff('clinician')
  const p = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
  const patient = await portalLogin(p.phone!)
  const words = 'Pair mein sujan hai since Diwali; रात को नींद नहीं आती. Also my sister’s number changed.'
  expect((await patient.post('/api/p/statements', { answers: { ...NO, anything_else: { yn: 'yes', free: `  ${words}  ` } }, lang: 'hinglish', confirmation: 'confirmed' })).ok).toBe(true)

  // Stored as the patient's words: the statement row and one patient_statement event whose only field is the text.
  const st = (await statementsOf(p.id)).find((s) => s.questionId === 'anything_else')!
  expect(st.transcript).toBe(words)
  const page = await ui('clinician')
  await page.goto(`/patients/${p.id}/ledger`)
  const said = sectionOf(page, 'Patient said')
  await expect(said).toContainText(words)
  await expect(said).toContainText('Anything else')
  await page.goto(`/patients/${p.id}/statements`)
  await expect(page.locator('blockquote', { hasText: words })).toHaveCount(1)
  await expect(page.locator('li', { has: page.locator('blockquote', { hasText: words }) }).last()).toContainText('Patient said') // the answer's own row
})

test('FR-VOX-04 the patient changes an answer after the read-back; the saved statement says "corrected"', async ({ staff, browser }) => {
  const clinician = await staff('clinician')
  const p = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
  const patient = await portalLogin(p.phone!)
  const ctx = await patient.browserContext(browser)
  const page = await ctx.newPage()
  await page.goto('/p/visit?lang=en')
  for (let n = 1; n <= 5; n++) {
    await expect(page.getByText(`Question ${n} of 5`)).toBeVisible()
    await page.getByRole('radio', { name: 'No', exact: true }).click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: en.reviewTitle })).toBeVisible()
  await page.getByRole('button', { name: en.editAnswers }).click()

  // Back at question 1: change "No" to "Yes" and name the hospital; the other answers are kept.
  await expect(page.getByText('Question 1 of 5')).toBeVisible()
  await page.getByRole('radio', { name: 'Yes', exact: true }).click()
  await page.getByLabel(en.f_place_hospital).fill('Sahyadri Hospital')
  for (let n = 1; n <= 5; n++) await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('heading', { name: en.reviewTitle })).toBeVisible()
  await expect(page.locator('section[aria-labelledby="rv"]')).toContainText('You saw another hospital or doctor: Sahyadri Hospital.')
  await page.getByRole('button', { name: en.confirmYes }).click()
  await expect(page.getByRole('heading', { name: en.savedTitle })).toBeVisible()
  await ctx.close()

  const rows = await statementsOf(p.id)
  expect(rows).toHaveLength(5)
  expect(new Set(rows.map((r) => r.confirmation))).toEqual(new Set(['corrected']))
  expect(rows.find((r) => r.questionId === 'other_hospital')).toMatchObject({ transcript: 'Sahyadri Hospital', readbackText: 'You saw another hospital or doctor: Sahyadri Hospital.' })
  const [a] = await auditOf(p.id, 'statements.submit')
  expect(a.details).toMatchObject({ confirmation: 'corrected', statements: 5 })
})

test('FR-ID-08 the patient stops a lost card from the portal; staff can revoke without reissuing', async ({ staff, browser }) => {
  const desk = await staff('desk'), records = await staff('records')
  const lookup = (api: Api, token: string) => api.post('/api/desk/lookup', { mode: 'token', value: token })
  const p = await registerPatient(desk, { base: 'returning' })
  expect((await lookup(desk, p.token)).body.status).toBe('ok')

  const patient = await portalLogin(p.phone!)
  const ctx = await patient.browserContext(browser)
  const page = await ctx.newPage()
  await page.goto('/p/access?lang=en')
  await expect(page.getByRole('heading', { name: en.cardLostTitle })).toBeVisible()
  await page.getByRole('button', { name: en.cardLostButton }).click()
  await expect(page.getByText(en.cardLostConfirm)).toBeVisible()
  await page.getByRole('button', { name: en.cardLostYes }).click()
  await expect(page.getByText(en.cardStopped)).toBeVisible()
  await ctx.close()

  expect((await lookup(desk, p.token)).body).toEqual({ status: 'revoked', results: [] })
  const [audit] = await auditOf(p.id, 'patient.token_revoked')
  expect(audit).toMatchObject({ actorRole: 'patient', details: { via: 'patient' } })
  expect((await patientRow(p.id)).tokenRevokedAt).not.toBeNull()

  // Staff "revoke" only: the old card stops, no new token is issued, the token hash stays the same (FR-ID-08, E-ID-07).
  const q = await registerPatient(desk, { base: 'returning' })
  const before = await patientRow(q.id)
  const r = await records.post(`/api/patients/${q.id}/token`, { action: 'revoke' })
  expect(r.body).toEqual({ ok: true, revoked: true })
  const after = await patientRow(q.id)
  expect(after.oncosetuTokenHash).toBe(before.oncosetuTokenHash)
  expect(after.tokenRevokedAt).not.toBeNull()
  expect((await lookup(desk, q.token)).body.status).toBe('revoked')
  expect((await auditOf(q.id, 'patient.token_reissued'))).toHaveLength(0)
})

test('FR-CON-03 a child is registered only with a guardian; codes and links go to the guardian, never to the child\'s phone', async ({ staff }) => {
  const desk = await staff('desk')
  const childPhone = freshPhone(), guardianPhone = freshPhone()
  const dob = `${new Date().getFullYear() - 12}-05-14`
  const body = (caregiver?: object) => ({
    fullName: 'Aarav Synthetic Child', aliases: [], dob, sex: 'male', phone: childPhone, preferredLanguage: 'en', disclosureStatus: 'unknown',
    primaryContact: 'patient', ...(caregiver ? { caregiver } : {}),
    consent: { purposes: { store: true, ai: false, share: true, abdm: false, metrics: false }, language: 'en', noticeVersion: CONSENT_NOTICE_VERSION, confirm: { method: 'witnessed', attest: true } },
    continueDespiteDuplicates: true,
  })
  expect(await desk.post('/api/patients', body())).toMatchObject({ status: 400, body: { error: { code: 'caregiver_required' } } })
  expect(await desk.post('/api/patients', body({ name: 'Meera Synthetic', relation: 'mother', phone: guardianPhone, isGuardian: false })))
    .toMatchObject({ status: 400, body: { error: { code: 'guardian_required' } } })
  const r = await desk.post('/api/patients', body({ name: 'Meera Synthetic', relation: 'mother', phone: guardianPhone, isGuardian: true }))
  expect(r.ok).toBe(true)
  const id = r.body.id as string
  expect(await patientRow(id)).toMatchObject({ minor: true, primaryContact: 'caregiver' }) // asked for "patient", stored as the guardian
  expect((await caregiversOf(id)).map((c) => c.isGuardian)).toEqual([true])
  expect((await auditOf(id, 'patient.registered'))[0].details).toMatchObject({ minor: true, primaryContact: 'caregiver' })

  // Sign-in codes: the child's own phone opens nothing (no code is sent); the guardian's phone does, as a caregiver session.
  const since = Date.now() - 1000
  const pub = await portalLogin(guardianPhone)
  expect((await pub.get('/api/auth/me')).body.session).toMatchObject({ kind: 'caregiver', patientId: id })
  await (await pub.ctx.post('/api/auth/patient/otp/start', { data: { phone: childPhone } })).text()
  // Consent confirmation codes, to the primary contact and to "the patient's own phone": both reach the guardian.
  expect((await desk.post(`/api/patients/${id}/consent/otp`, { target: 'primary' })).ok).toBe(true)
  expect((await desk.post(`/api/patients/${id}/consent/otp`, { target: 'patient' })).ok).toBe(true)
  // The pre-visit questions link too.
  expect((await desk.post(`/api/patients/${id}/pre-visit-link`)).ok).toBe(true)
  await waitForSms(guardianPhone, since, (m) => m.templateKey === 'previsit.link')
  await sleep(1500)
  const toGuardian = (await smsTo(guardianPhone)).filter((m) => m.createdAt.getTime() >= since).map((m) => m.templateKey)
  expect(toGuardian.filter((k) => k === 'confirm.otp')).toHaveLength(2)
  expect(toGuardian).toContain('auth.otp')
  expect((await smsTo(childPhone)).filter((m) => m.createdAt.getTime() >= since)).toEqual([])
})

test('FR-VOX-01 the hospital switches a question off and reorders them on /admin/settings; patients are asked only those @clock', async ({ staff, ui, browser }) => {
  test.setTimeout(180_000)
  const [{ flags: before }] = await adminDb.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ORG))
  const setFlags = (flags: OrgFlags) => adminDb.update(orgSettings).set({ flags }).where(eq(orgSettings.orgId, ORG))
  const admin = await staff('admin'), clinician = await staff('clinician')
  try {
    await setFlags({ voice: before.voice, tts: before.tts, ai_extraction: before.ai_extraction }) // start from the default five
    const page = await ui('admin')
    await page.goto('/admin/settings')
    const box = page.locator('section[aria-labelledby="questions-h"]')
    await expect(box.getByRole('heading', { name: 'Pre-visit questions' })).toBeVisible()
    await box.getByRole('button', { name: `Move up: ${en.q_new_medicines}` }).click()
    await box.getByText(en.q_new_tests, { exact: true }).click() // the switch's label
    await expect(box.getByRole('switch', { name: new RegExp(`^${en.q_new_tests.replace('?', '\\?')}`) })).not.toBeChecked()
    await box.getByRole('button', { name: 'Save questions' }).click()
    await expect(page.getByText('Questions saved')).toBeVisible()
    const [{ flags }] = await adminDb.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ORG))
    expect(flags.questions).toEqual([
      { id: 'new_medicines', on: true }, { id: 'other_hospital', on: true }, { id: 'new_tests', on: false }, { id: 'admissions', on: true }, { id: 'anything_else', on: true },
    ])
    expect((await auditOf(ORG, 'settings.questions')).map((r) => r.details)).toContainEqual({ order: flags.questions!.map((q) => q.id), off: ['new_tests'] })
    // Saving the flag switches keeps the question setting (one JSON column); a setting with every question off is refused.
    expect((await admin.post('/api/admin/settings', { flags: { voice: flags.voice, tts: flags.tts, ai_extraction: flags.ai_extraction } })).ok).toBe(true)
    expect((await adminDb.select({ flags: orgSettings.flags }).from(orgSettings).where(eq(orgSettings.orgId, ORG)))[0].flags.questions).toEqual(flags.questions)
    expect((await admin.post('/api/admin/settings', { questions: flags.questions!.map((q) => ({ ...q, on: false })) })).status).toBe(400)

    // The patient is asked four questions, medicines first; "new tests" is neither asked nor required.
    const p = await registerPatient(clinician, { base: 'returning', disclosure: 'cleared' })
    const patient = await portalLogin(p.phone!)
    const ctx = await patient.browserContext(browser)
    const visit = await ctx.newPage()
    await visit.goto('/p/visit?lang=en')
    const asked: string[] = []
    for (let n = 1; n <= 4; n++) {
      await expect(visit.getByText(`Question ${n} of 4`)).toBeVisible()
      asked.push(await visit.locator('#qh').innerText())
      await visit.getByRole('radio', { name: 'No', exact: true }).click()
      await visit.getByRole('button', { name: 'Next', exact: true }).click()
    }
    expect(asked).toEqual([en.q_new_medicines, en.q_other_hospital, en.q_admissions, en.q_anything_else])
    await visit.getByRole('button', { name: en.confirmYes }).click()
    await expect(visit.getByRole('heading', { name: en.savedTitle })).toBeVisible()
    await ctx.close()
    expect((await statementsOf(p.id)).map((s) => s.questionId).sort()).toEqual(['admissions', 'anything_else', 'new_medicines', 'other_hospital'])
    // A switched-off question's answer is dropped; a switched-on one is still required.
    expect((await patient.post('/api/p/statements', { answers: { ...NO, admissions: undefined }, lang: 'en', confirmation: 'confirmed' }))).toMatchObject({ status: 400, body: { error: { code: 'answer_required' } } })
    expect((await patient.post('/api/p/statements', { answers: { ...NO, new_tests: { yn: 'yes', names: 'PET scan' } }, lang: 'en', confirmation: 'confirmed' })).ok).toBe(true)
    expect((await statementsOf(p.id)).filter((s) => s.questionId === 'new_tests')).toEqual([])
  } finally {
    await setFlags(before)
  }
})
