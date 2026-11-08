// PRD §10.2 "Log redaction test: inject a synthetic name/phone/quote and assert it never appears in logs", across every
// sink: the server's stdout and stderr (src/server/log.ts and anything else that prints) and the audit_log rows.
// Starts `next start` from the existing production build (run `npm run build` first) on a free port, drives real
// requests — failed and good staff sign-in, registration, duplicate check, contact email, a PDF upload through the
// pipeline, patient OTP sign-in, a share-link passcode — then searches everything the server wrote. Needs the DB env.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import postgres from 'postgres'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG_GANGA_ID as GANGA } from '../../src/server/demo'

if (!process.env.DATABASE_URL_APP && existsSync('.env.local')) process.loadEnvFile('.env.local')

const PASSWORD = process.env.E2E_PASSWORD ?? 'Demo@2026'
const letters = (n: number) => Array.from({ length: n }, () => 'bcdfghjkmnpqrstvwxz'[Math.floor(Math.random() * 19)]).join('')
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')

// Synthetic values, random per run so a hit can only come from this run.
const v = {
  name: `${cap(letters(8))} ${cap(letters(9))}`,
  alias: `${cap(letters(8))} ${cap(letters(7))}`,
  caregiver: `${cap(letters(7))} ${cap(letters(8))}`,
  phone: `+91 9${digits(4)} ${digits(5)}`,
  caregiverPhone: `+91 9${digits(4)} ${digits(5)}`,
  email: `rx.${letters(10)}@example.org`,
  ghostEmail: `ghost.${letters(10)}@ganga.test`,
  wrongPassword: `Wrong-${letters(12)}`,
  mrn: `MRN${digits(7)}`,
  quote: `Impression ${cap(letters(11))} nodule seen`,
  passcode: `Pc-${letters(12)}`,
}
const found: { sink: string; what: string }[] = []
const requestIds: string[] = []
let server: ChildProcess, base = '', out = '', started = new Date()
const owner = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1, onnotice: () => {} })
const tokens: Record<string, string> = {} // session tokens, TOTP and OTP codes seen during the run

const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => res(port)) }); s.on('error', rej) })

async function call(path: string, init: { method?: string; json?: unknown; form?: FormData; sid?: string } = {}) {
  const headers: Record<string, string> = { origin: base }
  if (init.sid) headers.cookie = `os_sid=${init.sid}`
  if (init.json !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(base + path, { method: init.method ?? (init.json !== undefined || init.form ? 'POST' : 'GET'), headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) })
  const rid = res.headers.get('x-request-id')
  if (rid) requestIds.push(rid)
  const sid = /os_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
  const body = await res.json().catch(() => null)
  return { status: res.status, body, sid }
}

async function staffLogin(email: string) {
  const { totpFor } = await import('../e2e/helpers/totp')
  const totp = totpFor(email)
  tokens[`TOTP for ${email}`] = totp
  const r = await call('/api/auth/staff/login', { json: { email, password: PASSWORD, totp } })
  expect(r.status, `login ${email}`).toBe(200)
  tokens[`session token ${email}`] = r.sid!
  return r.sid!
}

async function pdfWith(lines: string[]) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 22, size: 12, font }))
  return doc.save()
}

beforeAll(async () => {
  if (!existsSync('.next/BUILD_ID')) throw new Error('log-redaction.test.ts starts `next start`: run `npm run build` first (with the same env)')
  const port = await freePort()
  base = `http://localhost:${port}`
  started = new Date(Date.now() - 1000)
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // No real LLM or speech calls; debug lines on so they are searched too.
    env: { ...process.env, NODE_ENV: 'production', PUBLIC_BASE_URL: base, GOOGLE_GENERATIVE_AI_API_KEY: '', SARVAM_API_KEY: '', AI_ENABLED: 'false', LOG_DEBUG: 'true' },
  })
  for (const s of [server.stdout!, server.stderr!]) s.on('data', (d: Buffer) => { out += d.toString() })
  const end = Date.now() + 60_000
  while (!(await fetch(`${base}/login`).then((r) => r.ok, () => false))) {
    if (Date.now() > end || server.exitCode !== null) throw new Error(`next start did not come up (exit ${server.exitCode})`)
    await new Promise((r) => setTimeout(r, 500))
  }
}, 90_000)

afterAll(async () => {
  server?.kill('SIGTERM')
  await owner.end({ timeout: 5 })
})

describe('no PHI, credential or secret in any log sink', () => {
  it('drives sign-in, registration, upload, patient OTP and a share passcode through the real server', async () => {
    // Failed sign-in for an unknown address, then good ones.
    expect((await call('/api/auth/staff/login', { json: { email: v.ghostEmail, password: v.wrongPassword, totp: '000000' } })).status).toBe(401)
    const records = await staffLogin('records@ganga.test')

    const { CONSENT_NOTICE_VERSION } = await import('../../src/i18n/consent')
    const identity = { fullName: v.name, aliases: [{ name: v.alias }], dob: '1971-03-09', phone: v.phone, caregiverPhone: v.caregiverPhone, mrn: v.mrn }
    expect((await call('/api/desk/duplicate-check', { json: identity, sid: records })).status).toBe(200)
    const reg = await call('/api/patients', {
      sid: records,
      json: {
        fullName: v.name, aliases: [{ name: v.alias, kind: 'other' }], dob: '1971-03-09', sex: 'female', phone: v.phone, mrn: v.mrn,
        preferredLanguage: 'en', disclosureStatus: 'unknown', primaryContact: 'patient',
        caregiver: { name: v.caregiver, relation: 'daughter', phone: v.caregiverPhone, isGuardian: false },
        consent: { purposes: { store: true, ai: false, share: true, abdm: false, metrics: false }, language: 'en', noticeVersion: CONSENT_NOTICE_VERSION, confirm: { method: 'witnessed', attest: true } },
        continueDespiteDuplicates: true,
      },
    })
    expect(reg.status, JSON.stringify(reg.body?.error)).toBe(200)
    const pid = reg.body.id as string
    tokens['patient QR token'] = reg.body.token
    expect((await call(`/api/patients/${pid}/contact-emails`, { sid: records, json: { email: v.email, verifiedInPerson: true } })).status).toBe(200)
    expect((await call('/api/patients?q=' + encodeURIComponent(v.name), { sid: records })).status).toBe(200)

    // A document whose text carries the name, phone and a clinical quote, processed by the real pipeline.
    const form = new FormData()
    const pdf = await pdfWith(['Ganga Valley Hospital - Laboratory Report', `Patient: ${v.name}   Age/Sex: 55 Y / F`, `Phone: ${v.phone}   MRN: ${v.mrn}`,
      'Date: 12/03/2026', 'Haemoglobin 9.8 g/dL (12.0 - 15.5)', `${v.quote}.`])
    form.append('file', new Blob([Buffer.from(pdf)], { type: 'application/pdf' }), `${v.name.replace(' ', '_')}_report.pdf`)
    form.append('intakeRoute', 'bulk')
    const up = await call(`/api/patients/${pid}/documents`, { sid: records, form })
    expect(up.status, JSON.stringify(up.body)).toBeLessThan(300)
    let status = ''
    for (const end = Date.now() + 120_000; Date.now() < end;) {
      status = (await call(`/api/documents/${up.body.documentId}/status`, { sid: records })).body?.status
      if (['done', 'needs_review', 'failed', 'unreadable', 'quarantined', 'needs_password'].includes(status)) break
      await new Promise((r) => setTimeout(r, 1500))
    }
    expect(['done', 'needs_review']).toContain(status)

    // Patient sign-in by OTP (the code is read from the simulated SMS outbox).
    const since = new Date()
    expect((await call('/api/auth/patient/otp/start', { json: { phone: v.phone } })).status).toBe(200)
    const { phoneHmac } = await import('../../src/server/crypto')
    let code: string | undefined
    for (const end = Date.now() + 20_000; !code && Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
      const [m] = await owner`select body from outbox where org_id = ${GANGA} and to_hmac = ${phoneHmac(v.phone)} and created_at >= ${since} order by created_at desc limit 1`
      code = /\b(\d{6})\b/.exec(m?.body ?? '')?.[1]
    }
    expect(code, 'OTP SMS in the outbox').toBeTruthy()
    tokens['patient OTP'] = code!
    const verify = await call('/api/auth/patient/otp/verify', { json: { phone: v.phone, code } })
    expect(verify.status).toBe(200)
    tokens['patient session token'] = verify.sid!
    expect((await call('/api/p/requests', { sid: verify.sid })).status).toBe(200)

    // A share link opened with a passcode (unknown link: the passcode still travels through the handler), and bad JSON.
    expect((await call(`/api/shares/${crypto.randomUUID()}/open`, { json: { passcode: v.passcode } })).status).toBe(404)
    expect((await fetch(`${base}/api/desk/lookup`, { method: 'POST', headers: { origin: base, cookie: `os_sid=${records}`, 'content-type': 'application/json' }, body: `{"phone":"${v.phone}",` })).status).toBe(400)
    await new Promise((r) => setTimeout(r, 2000)) // after() work and the last log lines flush
  }, 240_000)

  it('the capture saw this run: every response request id is in the server output', () => {
    expect(requestIds.length).toBeGreaterThan(10)
    expect(requestIds.filter((id) => !out.includes(id))).toEqual([])
  })

  it('stdout, stderr and audit_log contain none of the values', async () => {
    const audit = JSON.stringify(await owner`select * from audit_log where org_id = ${GANGA} and at >= ${started}`)
    expect(audit.length).toBeGreaterThan(500) // the audit rows of this run are there to search
    const words = (s: string) => s.split(/\s+/).filter((w) => w.length >= 5)
    const phoneForms = (p: string) => { const d = p.replace(/\D/g, ''); return [p, d, d.slice(-10), `${d.slice(-10, -5)} ${d.slice(-5)}`] }
    const needles: [string, string][] = [
      ...[...words(v.name), ...words(v.alias), ...words(v.caregiver)].map((w): [string, string] => ['name', w]),
      ...[...phoneForms(v.phone), ...phoneForms(v.caregiverPhone)].map((p): [string, string] => ['phone', p]),
      ['email', v.email], ['email', v.email.split('@')[0]], ['email', v.ghostEmail], ['password', PASSWORD], ['password', v.wrongPassword],
      ['MRN', v.mrn], ['quote', v.quote.split(' ')[1]], ['passcode', v.passcode],
      ...Object.entries(tokens).map(([k, t]): [string, string] => [k, t]),
    ]
    // Secrets from the server's environment: the values themselves and the passwords inside database URLs.
    for (const [k, val] of Object.entries(process.env)) {
      if (!val || val.length < 12 || !/(KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)/.test(k)) continue
      needles.push([`env ${k}`, val])
      if (k.startsWith('DATABASE_URL')) { const pw = decodeURIComponent(new URL(val).password); if (pw.length >= 8) needles.push([`env ${k} password`, pw]) }
    }
    const hit = (hay: string, needle: string) => /^\d+$/.test(needle) && needle.length <= 8
      ? new RegExp(`(?<![0-9a-f])${needle}(?![0-9a-f])`, 'i').test(hay) // short codes: not inside ids or hashes
      : hay.toLowerCase().includes(needle.toLowerCase())
    for (const [sink, hay] of [['server output', out], ['audit_log', audit]] as const) {
      for (const [what, needle] of needles) if (hit(hay, needle)) found.push({ sink, what })
    }
    expect(found).toEqual([]) // labels only: a failing run never prints a secret
  })
})
