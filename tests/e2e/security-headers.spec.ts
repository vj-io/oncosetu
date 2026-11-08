// PRD §10.2 "TLS everywhere; HSTS; secure cookies; CSP without unsafe-inline for scripts", asserted on the running server
// (src/proxy.ts sets the headers, src/server/session.ts the cookie). Needs a production build: `next dev` adds
// 'unsafe-eval' and drops upgrade-insecure-requests on purpose.
import { EMAIL, PASSWORD } from './helpers/env'
import { totpFor } from './helpers/totp'
import { test, expect } from './helpers/fixtures'

const directives = (csp: string) => new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([k, ...v]) => [k, v]))

test('pages: nonce + strict-dynamic CSP without unsafe-inline scripts, HSTS, nosniff, framing and referrer locked', async ({ anon }) => {
  const api = await anon()
  const nonces: string[] = []
  for (const path of ['/login', '/p/login', '/']) {
    const res = await api.get(path)
    expect(res.status(), path).toBe(200)
    const h = res.headers()
    const csp = directives(h['content-security-policy'] ?? '')
    const script = csp.get('script-src') ?? []
    const nonce = script.find((s) => /^'nonce-[A-Za-z0-9+/=]{16,}'$/.test(s))
    expect(nonce, `${path} script-src has a nonce`).toBeTruthy()
    expect(script).toContain("'strict-dynamic'")
    expect(script).not.toContain("'unsafe-inline'")
    expect(script).not.toContain("'unsafe-eval'")
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(csp.get('base-uri')).toEqual(["'self'"])
    expect(csp.get('frame-ancestors')).toEqual(["'none'"])
    expect(csp.has('upgrade-insecure-requests')).toBe(true)
    // Next stamps the per-request nonce on every script it renders; a script without it would be blocked.
    const html = await res.text()
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    expect(scripts.length, `${path} renders scripts`).toBeGreaterThan(0)
    expect(scripts.filter((s) => !s.includes(`nonce="${nonce!.slice(7, -1)}"`)), `${path} scripts without the nonce`).toEqual([])
    nonces.push(nonce!)

    const hsts = h['strict-transport-security'] ?? ''
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31_536_000)
    expect(hsts).toContain('includeSubDomains')
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['referrer-policy']).toBe('no-referrer')
  }
  expect(new Set(nonces).size, 'a fresh nonce per response').toBe(nonces.length)
})

test('API responses carry the same headers; decrypted originals are sandboxed', async ({ anon }) => {
  const api = await anon()
  const me = await api.get('/api/auth/me')
  expect(me.status()).toBe(401)
  expect(me.headers()['x-content-type-options']).toBe('nosniff')
  expect(me.headers()['strict-transport-security']).toContain('max-age=')
  expect(me.headers()['cache-control']).toBe('no-store')
  const file = await api.get(`/api/documents/${crypto.randomUUID()}/file`)
  const csp = directives(file.headers()['content-security-policy'] ?? '')
  expect(csp.has('sandbox')).toBe(true)
  expect(csp.get('default-src')).toEqual(["'none'"])
})

test('the session cookie is HttpOnly, Secure, SameSite=Lax and host-only; sign-out clears it', async ({ anon }) => {
  const api = await anon()
  const res = await api.post('/api/auth/staff/login', { data: { email: EMAIL.records, password: PASSWORD, totp: totpFor(EMAIL.records) } })
  expect(res.ok()).toBe(true)
  const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value)
  expect(cookies.length).toBe(1)
  const [nameValue, ...attrs] = cookies[0].split(';').map((s) => s.trim())
  const has = (a: string) => attrs.some((x) => x.toLowerCase() === a.toLowerCase())
  expect(nameValue.split('=')[0]).toBe('os_sid')
  expect(nameValue.split('=')[1].length).toBeGreaterThanOrEqual(40) // 32 random bytes
  expect(has('HttpOnly')).toBe(true)
  expect(has('Secure')).toBe(true)
  expect(has('SameSite=lax')).toBe(true)
  expect(has('Path=/')).toBe(true)
  expect(attrs.some((x) => /^domain=/i.test(x)), 'no Domain attribute: host-only').toBe(false)

  const out = await api.post('/api/auth/logout')
  expect(out.ok()).toBe(true)
  const cleared = out.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('os_sid='))
  expect(cleared?.value).toMatch(/os_sid=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  expect((await api.get('/api/auth/me')).status()).toBe(401)
})

test('a signed-in page runs under the CSP: scripts hydrate and the browser reports no violation', async ({ staff, browser }) => {
  const records = await staff('records')
  const context = await records.browserContext(browser)
  const page = await context.newPage()
  const violations: string[] = []
  page.on('console', (m) => { if (/Content.Security.Policy|Refused to (execute|load|apply)/i.test(m.text())) violations.push(m.text()) })
  await page.goto('/records')
  // window.next is set by Next's client runtime: present only if the nonce'd scripts executed.
  await expect(page.locator('main')).toBeVisible()
  expect(await page.evaluate(() => typeof (window as unknown as { next?: unknown }).next)).toBe('object')
  expect(violations).toEqual([])
  await context.close()
})
