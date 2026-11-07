// FR-VOX-02: pre-visit questions at a private desk station. On the shared clinic tablet the patient signs in with the
// code sent to their phone, answers by tap, confirms the read-back, and the tablet signs out by itself, back to the
// station sign-in for the next person. The station session is short (5 min idle, 30 min at most).
import { eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { sessions } from '../../src/db/schema'
import { registerPatient, waitForCode } from './helpers/api'
import { statementsOf } from './helpers/db'
import { test, expect } from './helpers/fixtures'

test('FR-VOX-02 desk station: sign in with the phone code, answer, confirm, and the tablet signs itself out', async ({ staff, browser }) => {
  test.setTimeout(180_000)
  const p = await registerPatient(await staff('desk'), { base: 'returning', primaryContact: 'patient' })
  const tablet = await browser.newContext()
  const page = await tablet.newPage()
  await page.goto('/p/login?station=1&lang=en')
  await expect(page.getByRole('heading', { name: 'Questions before your visit, at the desk' })).toBeVisible()

  const since = Date.now() - 2000
  await page.getByLabel('Mobile number').fill(p.phone!)
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('6-digit code').fill(await waitForCode(p.phone!, since))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/p\/visit\?station=1/)

  // A station session is the short kind.
  const [s] = await adminDb.select().from(sessions).where(eq(sessions.patientId, p.id))
  expect(s.idleTimeoutS).toBe(300)
  expect(s.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000)

  for (let i = 0; i < 5; i++) {
    await page.getByRole('radio', { name: 'No', exact: true }).click()
    await page.getByRole('button', { name: 'Next' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Please check what we understood' })).toBeVisible()
  await page.getByRole('button', { name: 'Yes, this is right' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you. Your answers are saved.' })).toBeVisible()
  await expect(page.getByText(/This tablet signs you out in \d+ seconds/)).toBeVisible()
  expect((await statementsOf(p.id)).map((x) => x.confirmation)).toEqual(Array(5).fill('confirmed'))

  // "Sign out now" (or the countdown) ends the session and leaves the tablet on the station sign-in.
  await page.getByRole('button', { name: 'Sign out now' }).click()
  await page.waitForURL(/\/p\/login\?station=1$/)
  const [after] = await adminDb.select({ revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.id, s.id))
  expect(after.revokedAt).not.toBeNull()
  expect((await page.request.get('/api/auth/me')).status()).toBe(401)
  await tablet.close()
})
