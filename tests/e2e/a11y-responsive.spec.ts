// Key pages at a 375 px phone width: no horizontal overflow, no console errors, no automated WCAG 2.2 AA violations (axe-core),
// touch targets (axe's target-size rule, WCAG 2.5.8: 24 px or spaced apart, on every page; 44 px in the patient portal and at the
// desk, where the design uses it) and 16 px text in patient views.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { portalLogin, registerPatient, uploadAndWait } from './helpers/api'
import { createShare, seal } from './helpers/flows'
import { test, expect } from './helpers/fixtures'

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** axe-core over the page as it is now (NFR-A11Y). Automated rules only: a manual audit is still needed for the rest of WCAG. */
async function axe(page: Page, label: string) {
  // Jump entrance animations to their end (infinite ones excepted): text caught mid-fade reads as a contrast failure.
  await page.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish() })
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze()
  if (violations.length) await test.info().attach(`axe ${label}`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' })
  expect.soft(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `${label}: axe WCAG 2.2 AA`).toEqual([])
}

/** Mono caps labels of the design system, 12 px by design and not body text: eyebrow kickers, the EN / हिं / Hinglish switch, the draft badge. */
const LABELS = '.ds-kicker, [role="group"][aria-label^="Language"] *, [data-testid="draft-badge"]'

/**
 * NFR-A11Y sizes: every visible control is at least `minTarget` px wide and high (the portal and the desk are designed at 44 px;
 * the 24 px WCAG minimum is axe's target-size rule on every page). A checkbox or radio counts with its label; a link inside running text is exempt (the 2.5.8 inline exception).
 * With `text16`, every visible text is at least 16 px (PRD §6.8 "minimum 16 px body text in patient views"), LABELS excepted.
 */
async function sizes(page: Page, label: string, minTarget: number, text16: boolean) {
  const r = await page.evaluate(({ minTarget, text16, LABELS }) => {
    const shown = (e: Element) => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 1 && b.height > 1 }
    const what = (e: Element) => `<${e.tagName.toLowerCase()}> "${(e.textContent ?? '').trim().slice(0, 30)}"`
    const ownText = (e: Element | null) => [...(e?.childNodes ?? [])].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())
    const targets: string[] = [], text: string[] = []
    for (const e of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary')) {
      const t = (e.matches('input[type=checkbox], input[type=radio]') && (e.closest('label') ?? (e.id ? document.querySelector(`label[for="${e.id}"]`) : null))) || e
      if (!shown(t)) continue // sr-only skip links; a visually hidden input is measured through its label above
      const inText = e.tagName === 'A' && getComputedStyle(e).display === 'inline' && ownText(e.parentElement)
      const b = t.getBoundingClientRect()
      if (!inText && (b.width < minTarget || b.height < minTarget)) targets.push(`${what(e)} ${b.width.toFixed(1)}×${b.height.toFixed(1)}`)
    }
    if (text16) for (const e of document.querySelectorAll('body *')) {
      if (!ownText(e) || !shown(e) || e.closest(LABELS)) continue
      const px = parseFloat(getComputedStyle(e).fontSize)
      if (px < 16) text.push(`${what(e)} ${px}px`)
    }
    return { targets, text }
  }, { minTarget, text16, LABELS })
  expect.soft(r.targets, `${label}: touch targets under ${minTarget} px`).toEqual([])
  if (text16) expect.soft(r.text, `${label}: text under 16 px`).toEqual([])
}

/** Opens `path`, waits for the page to settle, and reports overflow, console errors, axe violations and sizes for it. */
async function check(page: Page, errors: string[], label: string, path: string, ready: RegExp | string = 'main', o: { target?: number; text16?: boolean } = {}) {
  errors.length = 0
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect.soft(res?.status(), `${label} status`).toBeLessThan(400)
  await (typeof ready === 'string' ? page.locator(ready).first().waitFor() : page.getByText(ready).first().waitFor())
  await page.waitForTimeout(800) // fonts, hydration and entrance animations
  // Against the 375 px we asked for, not window.innerWidth: Chromium's mobile emulation widens the layout viewport to fit an
  // overflowing page, so innerWidth grew with it and this check passed while the header stuck out by 165 px (WebKit caught it).
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect.soft(scrollWidth, `${label}: horizontal overflow (scrollWidth ${scrollWidth} > ${PHONE.viewport.width})`).toBeLessThanOrEqual(PHONE.viewport.width)
  expect.soft([...errors], `${label}: console errors`).toEqual([])
  await axe(page, label)
  if (o.target) await sizes(page, label, o.target, !!o.text16)
}

const PATIENT = { target: 44, text16: true }
const DESK = { target: 44 }

function watch(page: Page, errors: string[]) {
  page.on('console', (m) => {
    // The share viewer's first request has no passcode and is answered 401 by design (the protocol's challenge); browsers log that as a console error.
    if (m.type() === 'error' && !(/\/api\/shares\/[^/]+\/open$/.test(m.location().url) && /\b401\b/.test(m.text()))) errors.push(m.text())
  })
  // WebKit reports a Next.js route prefetch cut off by the next page.goto as "… ?_rsc=… due to access control checks".
  page.on('pageerror', (e) => { if (!/_rsc=\S* due to access control checks/.test(e.message)) errors.push(`pageerror: ${e.message}`) })
}

test('a11y/responsive: the key staff, portal and share pages fit a 375 px phone, log no console errors, pass axe WCAG 2.2 AA and the size rules', async ({ staff, browser }) => {
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
  expect.soft(await pub.evaluate(() => document.documentElement.scrollWidth), '/s/[id] opened: horizontal overflow').toBeLessThanOrEqual(PHONE.viewport.width)
  expect.soft([...errors], '/s/[id]: console errors').toEqual([])
  await axe(pub, '/s/[id] opened')
  await check(pub, errors, '/p/login', '/p/login', 'main', PATIENT)
  await anon.close()

  // Staff pages.
  const staffCtx = await records.browserContext(browser, PHONE)
  const sp = await staffCtx.newPage()
  watch(sp, errors)
  for (const tab of ['overview', 'documents', 'ledger', 'timeline', 'completeness', 'consent']) await check(sp, errors, `/patients/[id]/${tab}`, `/patients/${p.id}/${tab}`)
  await staffCtx.close()
  const deskCtx = await (await staff('desk')).browserContext(browser, PHONE)
  const dp = await deskCtx.newPage()
  watch(dp, errors)
  await check(dp, errors, '/desk', '/desk', 'main', DESK)
  await check(dp, errors, '/patients/new', '/patients/new', 'main', DESK)
  await deskCtx.close()

  // Patient portal.
  const portal = await portalLogin(p.phone!)
  const pctx = await portal.browserContext(browser, PHONE)
  const pp = await pctx.newPage()
  watch(pp, errors)
  await check(pp, errors, '/p', '/p?lang=en', 'main', PATIENT)
  await check(pp, errors, '/p?lang=hi', '/p?lang=hi', 'main', PATIENT)
  for (const path of ['/p/consent', '/p/upload', '/p/visit']) await check(pp, errors, path, `${path}?lang=en`, 'main', PATIENT)
  await pctx.close()
})
