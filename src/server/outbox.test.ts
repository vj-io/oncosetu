// sendMessage + the delivery step. The DB is a one-row fake behind a mocked withOrg(), next's after() is a queue the test
// runs by hand ("the request transaction has committed now"), fetch is stubbed, so the real outbox.ts and the real Twilio
// adapter run end to end: row first, nothing sent until after(), exact request, status updates, retry on 5xx, no number in logs.
import { randomBytes } from 'node:crypto'
import type { Tx } from '@/db'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const s = {
    row: null as Record<string, unknown> | null, visible: true, failUpdate: false,
    updates: [] as Record<string, unknown>[], afterQueue: [] as (() => Promise<void>)[], afterThrows: false,
  }
  const tx = {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: async () => { s.row = { ...v, id: 'ob-1' }; return [{ id: 'ob-1' }] } }) }),
    select: () => ({ from: () => ({ where: async () => (s.row && s.visible ? [{ delivery: s.row.delivery }] : []) }) }),
    update: () => ({ set: (p: Record<string, unknown>) => ({ where: async () => { if (s.failUpdate) throw new Error('db down'); s.updates.push(p); Object.assign(s.row!, p) } }) }),
  }
  return { s, tx }
})
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => {
    if (h.s.afterThrows) throw new Error('`after` was called outside a request scope.')
    h.s.afterQueue.push(fn)
  },
}))
vi.mock('@/db', () => ({ withOrg: async (_org: string, fn: (tx: unknown) => unknown) => fn(h.tx) }))

import { log } from './log'
import { deliver, sendMessage, type OutboxMessage } from './outbox'
import { smsProvider } from './sms/provider'

const NUMBER = '+91 98220 41736'
const DIGITS = /98220\s?41736|\+?9198220/ // the number in any of the formats a log line could carry
const ORG = '00000000-0000-4000-8000-000000000001'
const TW = { TWILIO_ACCOUNT_SID: 'ACtest0123456789', TWILIO_AUTH_TOKEN: 'auth-token-xyz', TWILIO_FROM: '+15005550006', TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886' }
const useTwilio = (o: Record<string, string> = TW) => { for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_WHATSAPP_FROM']) vi.stubEnv(k, o[k] ?? '') }
const msg = (o: Partial<OutboxMessage> = {}): OutboxMessage => ({ orgId: ORG, patientId: null, toPhone: NUMBER, channel: 'sms', templateKey: 'auth.otp', body: 'Your OncoSetu code is 123456.', lang: 'en', ...o })
const send = (o?: Partial<OutboxMessage>) => sendMessage(h.tx as unknown as Tx, msg(o))

let fetchMock: ReturnType<typeof vi.fn>
let calls: { url: string; body: string; headers: Record<string, string> }[]
const reply = (...rs: (Response | Error)[]) => {
  calls = []
  fetchMock = vi.fn(async (url: unknown, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url: String(url), body: init.body, headers: init.headers })
    const r = rs[Math.min(calls.length - 1, rs.length - 1)]
    if (r instanceof Error) throw r
    return r.clone()
  })
  vi.stubGlobal('fetch', fetchMock)
}
const accepted = (sid = 'SM0001') => new Response(JSON.stringify({ sid, status: 'queued' }), { status: 201 })
const failed = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status })

/** What happens after the response: run the queued after() callbacks, advancing the retry / commit-wait timers. */
async function runAfter() {
  let done = false
  const p = Promise.all(h.s.afterQueue.splice(0).map((f) => f())).finally(() => { done = true })
  for (let i = 0; i < 30 && !done; i++) await vi.advanceTimersByTimeAsync(500)
  await p
}

let logged: string[] // what reaches the console (after log.ts redaction) AND what outbox.ts passed to log.* (before it)
const asText = (v: unknown) => JSON.stringify(v ?? {}, (_k, x) => (x instanceof Error ? `${x.name}: ${x.message}\n${x.stack}` : x))
beforeAll(() => { process.env.HMAC_KEY = randomBytes(32).toString('base64') })
beforeEach(() => {
  Object.assign(h.s, { row: null, visible: true, failUpdate: false, updates: [], afterQueue: [], afterThrows: false })
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  logged = []
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')) })
  for (const m of ['info', 'warn', 'error'] as const) {
    const real = log[m].bind(log)
    vi.spyOn(log, m).mockImplementation((msg, fields) => { logged.push(`${msg} ${asText(fields)}`); real(msg, fields) })
  }
  reply(accepted())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('no provider configured (demo / local): the outbox is the whole story', () => {
  it('the row is written as simulated, nothing is scheduled, fetch is never called', async () => {
    useTwilio({})
    expect(smsProvider('sms')).toBeNull()
    const r = await send()
    expect(r).toMatchObject({ id: 'ob-1', delivery: 'simulated', toMasked: '+91 ••••• •1736' })
    expect(h.s.row).toMatchObject({ delivery: 'simulated', channel: 'sms', body: 'Your OncoSetu code is 123456.', templateKey: 'auth.otp' })
    expect(h.s.afterQueue).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.s.updates).toEqual([])
  })
  it('WhatsApp without TWILIO_WHATSAPP_FROM stays simulated even when SMS is configured', async () => {
    useTwilio({ ...TW, TWILIO_WHATSAPP_FROM: '' })
    const r = await send({ channel: 'whatsapp' })
    expect(r.delivery).toBe('simulated')
    await runAfter()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('with a provider: row first, deliver after the request transaction commits', () => {
  it('SMS: the row is queued and holds no plaintext number; fetch waits for after(); then sent with the provider id', async () => {
    useTwilio()
    const r = await send()
    expect(r.delivery).toBe('queued')
    const row = h.s.row!
    expect(row).toMatchObject({ delivery: 'queued', toMasked: '+91 ••••• •1736' })
    expect(String(row.toHmac)).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toMatch(DIGITS)
    // still inside the request transaction: nothing has been sent
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.s.afterQueue).toHaveLength(1)

    await runAfter() // the transaction has committed, the response is out
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest0123456789/Messages.json')
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from('ACtest0123456789:auth-token-xyz').toString('base64')}`)
    expect(calls[0].body).toBe('To=%2B919822041736&From=%2B15005550006&Body=Your+OncoSetu+code+is+123456.')
    expect(h.s.updates).toHaveLength(1)
    expect(h.s.row).toMatchObject({ delivery: 'sent', providerMessageId: 'SM0001', deliveryError: null })
    expect(h.s.row!.deliveryUpdatedAt).toBeInstanceOf(Date)
  })

  it('WhatsApp: whatsapp: prefixes on To and From', async () => {
    useTwilio()
    await send({ channel: 'whatsapp', templateKey: 'share.link', body: 'Link: https://x.example/s/1' })
    await runAfter()
    expect(new URLSearchParams(calls[0].body).entries().toArray()).toEqual([
      ['To', 'whatsapp:+919822041736'], ['From', 'whatsapp:+14155238886'], ['Body', 'Link: https://x.example/s/1'],
    ])
    expect(h.s.row).toMatchObject({ channel: 'whatsapp', delivery: 'sent' })
  })

  it('a Messaging Service is used when set', async () => {
    useTwilio({ TWILIO_ACCOUNT_SID: 'ACtest0123456789', TWILIO_AUTH_TOKEN: 'auth-token-xyz', TWILIO_MESSAGING_SERVICE_SID: 'MG0123' })
    await send()
    await runAfter()
    expect(calls[0].body).toBe('To=%2B919822041736&MessagingServiceSid=MG0123&Body=Your+OncoSetu+code+is+123456.')
  })

  it('a request that failed and rolled back after sendMessage sends nothing (after() still runs)', async () => {
    useTwilio()
    await send()
    h.s.visible = false // the row never committed
    await runAfter()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.s.updates).toEqual([])
    expect(logged.some((l) => l.includes('outbox.delivery_skipped'))).toBe(true)
  })

  it('outside a request (after() throws) delivery starts at once, still never sooner than the row exists', async () => {
    useTwilio()
    h.s.afterThrows = true
    await send()
    expect(h.s.afterQueue).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toHaveLength(1)
    expect(h.s.row).toMatchObject({ delivery: 'sent', providerMessageId: 'SM0001' })
  })
})

describe('failures and the one retry on 5xx', () => {
  it('503 then 201 → two requests, sent', async () => {
    useTwilio()
    reply(failed(503), accepted('SM0002'))
    await send()
    await runAfter()
    expect(calls).toHaveLength(2)
    expect(calls[1].body).toBe(calls[0].body)
    expect(h.s.row).toMatchObject({ delivery: 'sent', providerMessageId: 'SM0002', deliveryError: null })
  })
  it('503 twice → exactly two requests, failed with http_503', async () => {
    useTwilio()
    reply(failed(503))
    await send()
    await runAfter()
    expect(calls).toHaveLength(2)
    expect(h.s.row).toMatchObject({ delivery: 'failed', deliveryError: 'http_503' })
    expect(h.s.row!.providerMessageId).toBeUndefined()
  })
  it('a 4xx is not retried: failed with the Twilio code', async () => {
    useTwilio()
    reply(failed(400, { code: 21211, message: `The 'To' number +919822041736 is not a valid phone number.` }))
    await send()
    await runAfter()
    expect(calls).toHaveLength(1)
    expect(h.s.row).toMatchObject({ delivery: 'failed', deliveryError: 'twilio_21211' })
  })
  it('a network error is not retried (the first request may have gone through): failed with network', async () => {
    useTwilio()
    reply(new TypeError('fetch failed'))
    await send()
    await runAfter()
    expect(calls).toHaveLength(1)
    expect(h.s.row).toMatchObject({ delivery: 'failed', deliveryError: 'network' })
  })
  it('the outbox row survives every failure: the message body and masked number are still there', async () => {
    useTwilio()
    reply(failed(500))
    await send()
    await runAfter()
    expect(h.s.row).toMatchObject({ body: 'Your OncoSetu code is 123456.', toMasked: '+91 ••••• •1736', delivery: 'failed' })
  })
  it('deliver() never throws, even when the status update itself fails', async () => {
    useTwilio()
    await send()
    h.s.failUpdate = true
    await expect(runAfter()).resolves.toBeUndefined()
    expect(h.s.row!.delivery).toBe('queued') // the row stays queued; the log line carries ids only
    expect(logged.some((l) => l.includes('outbox.delivery_error'))).toBe(true)
  })
  it('deliver() can be called directly with a provider (the step sendMessage schedules)', async () => {
    useTwilio()
    h.s.row = { id: 'ob-1', delivery: 'queued' }
    await deliver({ id: 'ob-1', orgId: ORG, channel: 'sms', to: '+919822041736', body: 'x', provider: smsProvider('sms')! })
    expect(h.s.row).toMatchObject({ delivery: 'sent' })
  })
})

describe('the plaintext number never reaches a log line (checked before and after log.ts redaction)', () => {
  it('not on success, not when Twilio\'s error text quotes it, not on network failure, not when the DB write fails', async () => {
    useTwilio()
    const scenarios: (() => void)[] = [
      () => reply(accepted()),
      () => reply(failed(400, { code: 21211, message: `The 'To' number +919822041736 is not a valid phone number (98220 41736).` })),
      () => reply(failed(503, { message: 'upstream error for +91 98220 41736' })),
      () => reply(new TypeError(`fetch failed for +919822041736`)),
      () => { reply(accepted()); h.s.failUpdate = true },
    ]
    for (const setup of scenarios) {
      h.s.failUpdate = false
      setup()
      await send()
      await runAfter()
    }
    const all = logged.join('\n')
    expect(all).toContain('outbox.queued')
    expect(all).toContain('outbox.delivered')
    expect(all).toContain('outbox.delivery_failed')
    expect(all).toContain('outbox.delivery_error')
    expect(all).not.toMatch(DIGITS)
    expect(all).not.toContain('auth-token-xyz')
    expect(all).not.toContain('Your OncoSetu code') // bodies are not logged either
    expect(all).not.toContain('123456')
  })
})
