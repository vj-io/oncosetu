// Signing in from home without a code each time: after a first sign-in with a code from the front desk, the patient (or
// caregiver) chooses a password; from then on, mobile number + password. 5 wrong passwords lock that sign-in for 15
// minutes; a new desk code still works, and choosing a new password replaces the old one.
import { ALL_PURPOSES, anonymous, demoDoc, registerPatient } from './helpers/api'
import { auditOf, documentsOf } from './helpers/db'
import { test, expect } from './helpers/fixtures'

const deskCode = async (desk: Awaited<ReturnType<Parameters<Parameters<typeof test>[2]>[0]['staff']>>, patientId: string) => {
  const r = await desk.post(`/api/patients/${patientId}/signin-code`)
  expect(r.ok).toBe(true)
  return r.body.code as string
}

test('a patient chooses a password after a desk code, then signs in from home with mobile number + password', async ({ staff, ui, browser }) => {
  const desk = await staff('desk')
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'patient', withCaregiver: false, purposes: { ...ALL_PURPOSES, ai: false } })

  // The desk sees how this patient signs in.
  const deskPage = await ui('desk')
  await deskPage.goto(`/patients/${p.id}/overview`)
  await expect(deskPage.getByTestId('portal-signin')).toHaveText('No password yet: give a sign-in code')

  // First sign-in at the clinic, with a desk code.
  const atClinic = await browser.newContext()
  const page = await atClinic.newPage()
  await page.goto('/p/login?lang=en')
  await expect(page.getByTestId('password-form')).toBeVisible() // the page opens on mobile number + password
  await page.getByTestId('use-code').click()
  await page.getByLabel('Mobile number').fill(p.phone!)
  await page.getByTestId('have-desk-code').click()
  await page.getByLabel('6-digit code').fill(await deskCode(desk, p.id))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/p(\?.*)?$/)

  // Home offers a password; the rules are explained in plain words.
  await page.getByRole('link', { name: /Choose a password/ }).click()
  await expect(page).toHaveURL(/\/p\/password/)
  const fill = async (a: string, b = a) => {
    await page.getByLabel('New password', { exact: true }).fill(a)
    await page.getByLabel('Type the password again', { exact: true }).fill(b)
    await page.getByRole('button', { name: 'Save password' }).click()
  }
  await fill('short')
  await expect(page.locator('main form').getByRole('alert')).toContainText('Use at least 8 characters.')
  await fill(p.phone!.replace(/\D/g, '').slice(-10))
  await expect(page.locator('main form').getByRole('alert')).toContainText('Do not use your mobile number as the password.')
  await fill('mango-tree-42', 'mango-tree-43')
  await expect(page.locator('main form').getByRole('alert')).toContainText('The two passwords are not the same.')
  await fill('mango-tree-42')
  await expect(page.getByTestId('pw-saved')).toBeVisible()
  await page.goto('/p?lang=en')
  await expect(page.getByRole('link', { name: /Choose a password/ })).toHaveCount(0)
  expect((await auditOf(p.id, 'auth.portal_password_set')).map((a) => a.details)).toEqual([expect.objectContaining({ first: true })])
  await atClinic.close()
  await deskPage.reload()
  await expect(deskPage.getByTestId('portal-signin')).toHaveText('Password chosen')

  // At home, on another phone: mobile number + password, then a paper sent.
  const atHome = await browser.newContext()
  const home = await atHome.newPage()
  await home.goto('/p/login?lang=en')
  await home.getByLabel('Mobile number').fill(p.phone!)
  await home.getByLabel('Password', { exact: true }).fill('mango-tree-42')
  await home.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(home).toHaveURL(/\/p(\?.*)?$/)
  await home.goto('/p/upload?lang=en')
  const chooser = home.waitForEvent('filechooser')
  await home.getByRole('button', { name: 'Choose files' }).click()
  const file = demoDoc('hero__04-prescription-printed.pdf')
  await (await chooser).setFiles({ name: file.name, mimeType: 'application/pdf', buffer: file.buffer })
  await expect(home.getByText('Received. The clinic team will check it.')).toBeVisible()
  expect((await documentsOf(p.id)).filter((d) => d.intakeRoute === 'patient_link')).toHaveLength(1)
  await atHome.close()
})

test('5 wrong passwords lock the password sign-in; a desk code still works and a new password replaces the old one', async ({ staff }) => {
  const desk = await staff('desk')
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'patient', withCaregiver: false, purposes: { ...ALL_PURPOSES, ai: false } })
  const a = await anonymous()
  const login = (password: string) => a.post('/api/auth/patient/password', { data: { phone: p.phone, password } })
  // No password yet: the same answer as a wrong one.
  expect((await login('anything-at-all')).status()).toBe(401)
  expect((await a.post('/api/auth/patient/otp/verify', { data: { phone: p.phone, code: await deskCode(desk, p.id) } })).status()).toBe(200)
  expect((await a.post('/api/p/password', { data: { password: 'first-pass-1' } })).status()).toBe(200)
  expect((await a.post('/api/p/password', { data: { password: '12345678' } })).status()).toBe(400) // too easy, refused by the server too

  const statuses = []
  for (let i = 0; i < 5; i++) statuses.push((await login(`wrong-pass-${i}`)).status())
  expect(statuses).toEqual([401, 401, 401, 401, 429])
  expect((await login('first-pass-1')).status()).toBe(429) // locked: even the right password waits
  expect((await auditOf(p.id, 'auth.portal_password_failed')).at(-1)?.details).toMatchObject({ reason: 'locked' })

  // Forgotten or locked: a desk code, then a new password. The lock is cleared and the old password stops working.
  const b = await anonymous()
  expect((await b.post('/api/auth/patient/otp/verify', { data: { phone: p.phone, code: await deskCode(desk, p.id) } })).status()).toBe(200)
  expect((await b.post('/api/p/password', { data: { password: 'second-pass-2' } })).status()).toBe(200)
  expect((await b.post('/api/auth/patient/password', { data: { phone: p.phone, password: 'first-pass-1' } })).status()).toBe(401)
  expect((await b.post('/api/auth/patient/password', { data: { phone: p.phone, password: 'second-pass-2' } })).status()).toBe(200)
  // The earlier session (a) was signed out when the new password was chosen elsewhere.
  expect((await a.get('/api/auth/me')).status()).toBe(401)
  await a.dispose()
  await b.dispose()
})

test('a caregiver who is the main contact chooses a password and signs in with it as the caregiver', async ({ staff }) => {
  const desk = await staff('desk')
  const p = await registerPatient(desk, { base: 'hero', primaryContact: 'caregiver', purposes: { ...ALL_PURPOSES, ai: false } })
  const a = await anonymous()
  expect((await a.post('/api/auth/patient/otp/verify', { data: { phone: p.caregiverPhone, code: await deskCode(desk, p.id) } })).status()).toBe(200)
  expect((await a.post('/api/p/password', { data: { password: 'family-key-9' } })).status()).toBe(200)
  const b = await anonymous()
  const r = await b.post('/api/auth/patient/password', { data: { phone: p.caregiverPhone, password: 'family-key-9' } })
  expect(r.status()).toBe(200)
  expect((await r.json()).kind).toBe('caregiver')
  expect((await b.post('/api/auth/patient/password', { data: { phone: p.phone, password: 'family-key-9' } })).status()).toBe(401) // the patient's own phone has no sign-in here
  await a.dispose()
  await b.dispose()
})
