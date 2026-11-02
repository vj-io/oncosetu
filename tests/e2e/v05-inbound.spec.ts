// V05 inbound channels: FR-ING-04 email drop (V05-E2E-07) and FR-ING-05 WhatsApp intake, against the running server
// in the Ganga org. The server needs INBOUND_EMAIL_USER/PASSWORD/DOMAIN, TWILIO_AUTH_TOKEN and PUBLIC_BASE_URL (test
// values in .env.local; no Twilio sender, so outgoing WhatsApp stays simulated and the code is read from the outbox).
// WhatsApp media are served by a tiny HTTP server started here; the dev server downloads them like Twilio media.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { APIRequestContext } from '@playwright/test'
import { and, count, eq } from 'drizzle-orm'
import { adminDb } from '../../src/db'
import { auditLog, caregivers, contactEmails, inboundHoldFiles, inboundHolds, outbox } from '../../src/db/schema'
import { phoneHmac } from '../../src/server/crypto'
import { twilioSignature } from '../../src/server/inbound/twilio'
import { inboundCopy } from '../../src/i18n/inbound'
import { demoDoc, registerPatient, until, waitDoc, waitForCode } from './helpers/api'
import { documentsOf } from './helpers/db'
import { ORG } from './helpers/env'
import { expect, test } from './helpers/fixtures'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set (see .env.local)`)
  return v
}
const SETTLED_OK = ['done', 'needs_review']
const PDF = 'hero__01-discharge-summary.pdf'
const JPG = 'hero__03-ct-thorax-abdomen.jpg'
const e164 = (phone: string) => phone.replace(/\s/g, '')

const auditOf = (targetId: string, action: string) =>
  adminDb.select().from(auditLog).where(and(eq(auditLog.orgId, ORG), eq(auditLog.targetId, targetId), eq(auditLog.action, action)))
const holdsOf = (patientId: string) => adminDb.select().from(inboundHolds).where(eq(inboundHolds.patientId, patientId))
const holdFiles = async (holdId: string) =>
  (await adminDb.select({ n: count() }).from(inboundHoldFiles).where(eq(inboundHoldFiles.holdId, holdId)))[0].n
const caregiverOf = async (patientId: string) => (await adminDb.select({ id: caregivers.id }).from(caregivers).where(eq(caregivers.patientId, patientId)))[0].id

// ── media server (stands in for api.twilio.com media URLs) ─────────────────────
let media: Server
let mediaBase = ''
test.beforeAll(async () => {
  media = createServer((req, res) => {
    const file = req.url?.endsWith('.jpg') ? JPG : req.url?.endsWith('.pdf') ? PDF : null
    if (!file) { res.writeHead(404).end(); return }
    const body = demoDoc(file).buffer
    res.writeHead(200, { 'content-type': file.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf', 'content-length': body.length }).end(body)
  })
  await new Promise<void>((r) => media.listen(0, '127.0.0.1', r))
  mediaBase = `http://127.0.0.1:${(media.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((r) => media.close(() => r())))

/** A Twilio webhook call, signed like Twilio does over the PUBLIC URL (PUBLIC_BASE_URL), posted to this server. */
async function whatsapp(ctx: APIRequestContext, params: Record<string, string>, opts: { sign?: boolean } = {}) {
  const form = new URLSearchParams({ To: 'whatsapp:+14155238886', AccountSid: 'ACtest', MessageSid: `SM${Math.random().toString(16).slice(2)}`, NumMedia: '0', Body: '', ...params })
  const sig = opts.sign === false ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' : twilioSignature(env('TWILIO_AUTH_TOKEN'), `${env('PUBLIC_BASE_URL').replace(/\/+$/, '')}/api/inbound/whatsapp`, form)
  const res = await ctx.post('/api/inbound/whatsapp', { headers: { 'x-twilio-signature': sig, 'content-type': 'application/x-www-form-urlencoded' }, data: form.toString() })
  return { status: res.status(), text: await res.text() }
}
const mediaMsg = (phone: string, file: 'a.pdf' | 'b.jpg') =>
  ({ From: `whatsapp:${e164(phone)}`, NumMedia: '1', MediaUrl0: `${mediaBase}/${file}`, MediaContentType0: file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' })
const textMsg = (phone: string, Body: string) => ({ From: `whatsapp:${e164(phone)}`, Body })

test('FR-ING-04 email drop: staff verify a caregiver address in person; its PDF is stored and processed; V05-E2E-07 an unregistered sender is refused and nothing is stored', async ({ staff, ui, anon }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero' })
  const cgId = await caregiverOf(p.id)

  // Consent tab: create the drop address, verify the caregiver's address in person.
  const page = await ui('records')
  await page.goto(`/patients/${p.id}/consent`)
  const section = page.locator('section[aria-labelledby="email-drop-h"]')
  await section.getByRole('button', { name: 'Create drop address' }).click()
  await expect(section.getByTestId('drop-address')).toBeVisible()
  const address = (await section.getByTestId('drop-address').innerText()).trim()
  expect(address).toMatch(new RegExp(`^[a-z2-7]{16}@${env('INBOUND_EMAIL_DOMAIN').replace(/\./g, '\\.')}$`))
  const email = `cg.${Date.now()}@example.com`
  await section.getByRole('button', { name: 'Add a verified address' }).click()
  await section.getByLabel('Email address').fill(email)
  await section.getByLabel('Whose address').selectOption(cgId)
  await section.getByLabel(/I checked this address in person/).check()
  await section.getByRole('button', { name: 'Add address' }).click()
  await expect(section.getByRole('list', { name: 'Verified addresses' })).toContainText('cg•••@example.com')
  await expect(section).toContainText(/Verified in person by .+ on \d{2} \w{3} \d{4}/)

  const ctx = await anon()
  const auth = `Basic ${Buffer.from(`${env('INBOUND_EMAIL_USER')}:${env('INBOUND_EMAIL_PASSWORD')}`).toString('base64')}`
  const mail = async (from: string, file: string, authorization = auth) => {
    const buf = demoDoc(file).buffer
    const res = await ctx.post('/api/inbound/email', {
      headers: { authorization },
      data: {
        From: from, FromFull: { Email: from.replace(/^.*<|>$/g, ''), Name: '' }, To: address, ToFull: [{ Email: address, Name: '', MailboxHash: '' }],
        Subject: 'my papers', TextBody: 'please add', HtmlBody: '<p>please add</p>', MessageID: `m-${Date.now()}`,
        Attachments: [{ Name: file, Content: buf.toString('base64'), ContentType: 'application/pdf', ContentLength: buf.length }],
      },
    })
    return { status: res.status(), body: await res.json().catch(() => null) }
  }

  // The verified address (any case) → stored as the caregiver's upload, then processed.
  const ok = await mail(`Caregiver <${email.toUpperCase()}>`, PDF)
  expect(ok.status).toBe(200)
  expect(ok.body).toMatchObject({ accepted: true, skipped: [] })
  expect(ok.body.documents).toHaveLength(1)
  const docId: string = ok.body.documents[0].documentId
  expect((await documentsOf(p.id)).find((d) => d.id === docId)).toMatchObject({ intakeRoute: 'email', uploadedByKind: 'caregiver', uploadedById: cgId })
  expect(SETTLED_OK).toContain((await waitDoc(records, docId)).status)
  expect((await auditOf(p.id, 'inbound.email_received'))[0]?.details).toMatchObject({ documents: [docId] })

  // V05-E2E-07: an unregistered sender is refused (200, accepted:false) and nothing is stored.
  const before = (await documentsOf(p.id)).length
  const bad = await mail('stranger@example.com', 'hero__04-prescription-printed.pdf')
  expect(bad).toEqual({ status: 200, body: { accepted: false, reason: 'unregistered_sender' } })
  expect((await documentsOf(p.id)).length).toBe(before)
  expect((await auditOf(p.id, 'inbound.email_rejected')).map((a) => a.details)).toContainEqual({ reason: 'unregistered_sender', attachments: 1 })

  // A revoked address is refused the same way; wrong webhook credentials get 401; an unknown alias is not routed.
  const [contact] = await adminDb.select({ id: contactEmails.id }).from(contactEmails).where(eq(contactEmails.patientId, p.id))
  expect((await records.post(`/api/patients/${p.id}/contact-emails/${contact.id}/revoke`)).ok).toBe(true)
  expect((await mail(email, 'hero__04-prescription-printed.pdf')).body).toEqual({ accepted: false, reason: 'unregistered_sender' })
  expect((await mail(email, PDF, `Basic ${Buffer.from('postmark:wrong').toString('base64')}`)).status).toBe(401)
  expect((await documentsOf(p.id)).length).toBe(before)
})

test('FR-ING-05 WhatsApp: signed media from the registered caregiver phone are held, released by the code, then processed', async ({ staff, anon }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero', preferredLanguage: 'en' }) // caregiver-primary: only the caregiver's phone is matched
  const cgPhone = p.caregiverPhone!
  const ctx = await anon()

  // A bad signature is refused before anything is read.
  expect((await whatsapp(ctx, mediaMsg(cgPhone, 'a.pdf'), { sign: false })).status).toBe(403)
  // The patient's own phone (caregiver is the primary contact) and an unknown phone: told to use the upload link, nothing kept.
  for (const phone of [p.phone!, '+91 98765 00000']) {
    const r = await whatsapp(ctx, mediaMsg(phone, 'a.pdf'))
    expect(r.status).toBe(200)
    expect(r.text).toContain('Please use the upload link the clinic sent you.')
  }
  expect(await holdsOf(p.id)).toEqual([])

  // A forwarded album arrives as parallel webhooks: one hold, one code, both files held, nothing in the record yet.
  const since = Date.now() - 2000
  const replies = await Promise.all([whatsapp(ctx, mediaMsg(cgPhone, 'a.pdf')), whatsapp(ctx, mediaMsg(cgPhone, 'b.jpg'))])
  expect(replies.map((r) => r.status)).toEqual([200, 200])
  expect(replies.map((r) => r.text).join(' ')).toMatch(/we received 1 file\. We sent you a 6-digit code/)
  expect(replies.map((r) => r.text).join(' ')).toMatch(/we received 1 file more/)
  const [hold] = await holdsOf(p.id)
  expect(hold).toMatchObject({ releasedAt: null, attempts: 0, documentIds: [] })
  expect(await holdFiles(hold.id)).toBe(2)
  expect(await documentsOf(p.id)).toEqual([])
  const code = await waitForCode(cgPhone, since)

  // A wrong code counts; the right one releases: two documents, uploaded by the caregiver, then processed.
  const wrong = await whatsapp(ctx, textMsg(cgPhone, code === '000000' ? '111111' : '000000'))
  expect(wrong.text).toContain('That code did not match. 4 attempts left.')
  const released = await whatsapp(ctx, textMsg(cgPhone, code.replace(/(\d{3})/, '$1 ')))
  expect(released.text).toMatch(/Setu Records: thank you\. 2 files added to your records\./)
  const docs = await documentsOf(p.id)
  expect(docs).toHaveLength(2)
  for (const d of docs) expect(d).toMatchObject({ intakeRoute: 'whatsapp', uploadedByKind: 'caregiver' })
  const [after] = await holdsOf(p.id)
  expect(after.releasedAt).not.toBeNull()
  expect([...after.documentIds].sort()).toEqual(docs.map((d) => d.id).sort())
  expect(await holdFiles(hold.id)).toBe(0)
  for (const d of docs) expect(SETTLED_OK).toContain((await waitDoc(records, d.id)).status)
  expect((await auditOf(hold.id, 'inbound.hold_released'))[0]?.details).toMatchObject({ skipped: 0, documents: expect.any(Array) })
  // The code went out once, as a WhatsApp outbox message (simulated: no Twilio sender is configured), not an SMS.
  const sent = await adminDb.select({ channel: outbox.channel, delivery: outbox.delivery }).from(outbox)
    .where(and(eq(outbox.orgId, ORG), eq(outbox.toHmac, phoneHmac(cgPhone)!), eq(outbox.templateKey, 'inbound.whatsapp_code')))
  expect(sent).toEqual([{ channel: 'whatsapp', delivery: 'simulated' }])
})

test('FR-ING-05 WhatsApp: five wrong codes discard the files, an expired hold is dropped, and the per-phone code budget is respected', async ({ staff, anon }) => {
  const records = await staff('records')
  const p = await registerPatient(records, { base: 'hero', preferredLanguage: 'hi' }) // replies in Hindi
  const cgPhone = p.caregiverPhone!
  const ctx = await anon()
  const t = inboundCopy
  const expire = (holdId: string) => adminDb.update(inboundHolds).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(inboundHolds.id, holdId))

  // Code 1: five wrong codes → discarded, files deleted, sender pointed to the upload link.
  await whatsapp(ctx, mediaMsg(cgPhone, 'a.pdf'))
  const [a] = await holdsOf(p.id)
  for (let i = 1; i <= 4; i++) expect((await whatsapp(ctx, textMsg(cgPhone, '000000'))).text).toContain(t.wrongCode.hi(5 - i))
  expect((await whatsapp(ctx, textMsg(cgPhone, '000000'))).text).toContain(t.discarded.hi)
  expect(await holdsOf(p.id)).toEqual([])
  expect(await holdFiles(a.id)).toBe(0)
  expect((await auditOf(a.id, 'inbound.hold_discarded'))[0]?.details).toEqual({ reason: 'attempts' })

  // Code 2: the window passes → the right code no longer works and the hold is dropped.
  const since = Date.now() - 2000
  await whatsapp(ctx, mediaMsg(cgPhone, 'a.pdf'))
  const [b] = await holdsOf(p.id)
  const code = await waitForCode(cgPhone, since)
  await expire(b.id)
  expect((await whatsapp(ctx, textMsg(cgPhone, code))).text).toContain(t.expired.hi)
  expect(await holdsOf(p.id)).toEqual([])

  // Code 3: an expired hold nobody answers is dropped by the cron route.
  await whatsapp(ctx, mediaMsg(cgPhone, 'a.pdf'))
  const [c] = await holdsOf(p.id)
  await expire(c.id)
  expect((await ctx.get('/api/cron/inbound-holds')).status()).toBe(401)
  const cron = await ctx.get('/api/cron/inbound-holds', { headers: { authorization: `Bearer ${env('CRON_SECRET')}` } })
  expect(cron.status()).toBe(200)
  expect((await cron.json()).discarded[ORG]).toBeGreaterThanOrEqual(1)
  expect(await holdsOf(p.id)).toEqual([])
  expect(await holdFiles(c.id)).toBe(0)

  // A 4th code inside 10 minutes is over the per-phone budget (3 / 10 min, shared with login codes): nothing is kept.
  expect((await whatsapp(ctx, mediaMsg(cgPhone, 'a.pdf'))).text).toContain(t.useUploadLink.hi)
  expect(await holdsOf(p.id)).toEqual([])
  expect(await documentsOf(p.id)).toEqual([])
})
