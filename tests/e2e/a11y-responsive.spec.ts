// Key pages at a 375 px phone width: no horizontal overflow, no console errors and no automated WCAG 2.2 AA violations (axe-core).
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { portalLogin, registerPatient, uploadAndWait } from './helpers/api'
import { createShare, seal } from './helpers/flows'
import { test, expect } from './helpers/fixtures'

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** axe-core over the page as it is now (NFR-A11Y). Automated rules only: a manual audit is still needed for the rest of WCAG. */
async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze()
  if (violations.length) await test.info().attach(`axe ${label}`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' })
  expect.soft(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `${label}: axe WCAG 2.2 AA`).toEqual([])
}

/** Opens `path`, waits for the page to settle, and reports overflow and console errors for it. */
async function check(page: Page, errors: string[], label: string, path: string, ready: RegExp | string = 'main') {
  errors.length = 0
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect.soft(res?.status(), `${label} status`).toBeLessThan(400)
  await (typeof ready === 'string' ? page.locator(ready).first().waitFor() : page.getByText(ready).first().waitFor())
  await page.waitForTimeout(800) // fonts, hydration and entrance animations
  const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect.soft(m.scrollWidth, `${label}: horizontal overflow (scrollWidth ${m.scrollWidth} > ${m.innerWidth})`).toBeLessThanOrEqual(m.innerWidth)
  expect.soft([...errors], `${label}: console errors`).toEqual([])
  await axe(page, label)
}

function watch(page: Page, errors: string[]) {
  page.on('console', (m) => {
    // The share viewer's first request has no passcode and is answered 401 by design (the protocol's challenge); browsers log that as a console error.
    if (m.type() === 'error' && !(/\/api\/shares\/[^/]+\/open$/.test(m.location().url) && /\b401\b/.test(m.text()))) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
}

test('a11y/responsive: the key staff, portal and share pages fit a 375 px phone, log no console errors and pass axe WCAG 2.2 AA', async ({ staff, browser }) => {
  test.setTimeout(480_000)
  const records = await staff('records'), clinician = await staff('clinician')
  const p = await registerPatient(records, { base: 'hero', primaryContact: 'patient' })
  for (const f of ['hero__01-discharge-summary.pdf', 'hero__04-prescription-printed.pdf']) await uploadAndWait(records, p.id, f)
  await seal(clinician, p.id)
  const share = await createShare(records, p.id, { passcode: '358120' })
  const errors: string[] = []

  // Public pages.
  const anon = await browser.newContext(PHONE)
  const pub = await anon.newPage()
  watch(pub, errors)
  await check(pub, errors, '/', '/')
  await check(pub, errors, '/login', '/login')
  await check(pub, errors, '/s/[id] passcode', share.url, 'input')
  await pub.getByLabel('Passcode').fill('358120')
  await pub.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(pub.getByRole('heading', { level: 1, name: 'Document index, not a clinical summary' })).toBeVisible()
  await pub.waitForTimeout(800)
  const m = await pub.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect.soft(m.scrollWidth, '/s/[id] opened: horizontal overflow').toBeLessThanOrEqual(m.innerWidth)
  expect.soft([...errors], '/s/[id]: console errors').toEqual([])
  await axe(pub, '/s/[id] opened')
  await check(pub, errors, '/p/login', '/p/login')
  await anon.close()

  // Staff pages.
  const staffCtx = await records.browserContext(browser, PHONE)
  const sp = await staffCtx.newPage()
  watch(sp, errors)
  for (const tab of ['overview', 'documents', 'ledger', 'completeness', 'consent']) await check(sp, errors, `/patients/[id]/${tab}`, `/patients/${p.id}/${tab}`)
  await staffCtx.close()
  const deskCtx = await (await staff('desk')).browserContext(browser, PHONE)
  const dp = await deskCtx.newPage()
  watch(dp, errors)
  await check(dp, errors, '/desk', '/desk')
  await check(dp, errors, '/patients/new', '/patients/new')
  await deskCtx.close()

  // Patient portal.
  const portal = await portalLogin(p.phone!)
  const pctx = await portal.browserContext(browser, PHONE)
  const pp = await pctx.newPage()
  watch(pp, errors)
  await check(pp, errors, '/p', '/p?lang=en')
  await check(pp, errors, '/p?lang=hi', '/p?lang=hi')
  for (const path of ['/p/consent', '/p/upload', '/p/visit']) await check(pp, errors, path, `${path}?lang=en`)
  await pctx.close()
})
