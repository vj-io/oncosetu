// The Twilio adapter, with fetch stubbed: the exact request (URL, auth, form body for SMS and WhatsApp), provider
// selection from env, and error handling that never carries the destination number.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmsError, smsProvider } from './provider'

const SID = 'ACtest0123456789'
const TOKEN = 'auth-token-xyz'
const NUMBER = '+91 98220 41736'
const E164 = '+919822041736'
const ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_WHATSAPP_FROM'] as const
const env = (o: Partial<Record<(typeof ENV)[number], string>>) => { for (const k of ENV) vi.stubEnv(k, o[k] ?? '') }
const creds = { TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: TOKEN }

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Call = { url: string; init: RequestInit & { headers: Record<string, string>; body: string } }
function stubFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: Call['init']) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (r instanceof Error) throw r
    return r.clone()
  }))
  return calls
}
const ok = (sid = 'SMa1b2c3') => new Response(JSON.stringify({ sid, status: 'queued', error_code: null }), { status: 201, headers: { 'content-type': 'application/json' } })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('provider selection (env read on use)', () => {
  it('no Twilio env → null for both channels (demo / simulated)', () => {
    env({})
    expect(smsProvider('sms')).toBeNull()
    expect(smsProvider('whatsapp')).toBeNull()
  })
  it.each([
    ['credentials but no sender', { ...creds }],
    ['a sender but no auth token', { TWILIO_ACCOUNT_SID: SID, TWILIO_FROM: '+15005550006' }],
    ['a sender but no account sid', { TWILIO_AUTH_TOKEN: TOKEN, TWILIO_FROM: '+15005550006' }],
  ])('%s → null', (_n, o) => {
    env(o)
    expect(smsProvider('sms')).toBeNull()
  })
  it('SMS needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID; WhatsApp needs TWILIO_WHATSAPP_FROM and ignores the SMS sender', () => {
    env({ ...creds, TWILIO_FROM: '+15005550006' })
    expect(smsProvider('sms')?.name).toBe('twilio')
    expect(smsProvider('whatsapp')).toBeNull()
    env({ ...creds, TWILIO_MESSAGING_SERVICE_SID: 'MG123' })
    expect(smsProvider('sms')?.name).toBe('twilio')
    expect(smsProvider('whatsapp')).toBeNull()
    env({ ...creds, TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886' })
    expect(smsProvider('sms')).toBeNull()
    expect(smsProvider('whatsapp')?.name).toBe('twilio')
  })
})

describe('the exact Twilio request', () => {
  it('SMS from a number: POST Messages.json, basic auth, form-encoded To / From / Body', async () => {
    env({ ...creds, TWILIO_FROM: '+15005550006' })
    const calls = stubFetch(ok('SM111'))
    const res = await smsProvider('sms')!.send({ to: NUMBER, body: 'Your OncoSetu code is 123456 & valid for 10 minutes.' })
    expect(res).toEqual({ providerMessageId: 'SM111' })
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({
      authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    })
    expect(init.body).toBe('To=%2B919822041736&From=%2B15005550006&Body=Your+OncoSetu+code+is+123456+%26+valid+for+10+minutes.')
    expect(init.signal).toBeInstanceOf(AbortSignal) // 10 s timeout
  })

  it('a Messaging Service replaces From (and wins if both are set)', async () => {
    env({ ...creds, TWILIO_FROM: '+15005550006', TWILIO_MESSAGING_SERVICE_SID: 'MG0123' })
    const calls = stubFetch(ok())
    await smsProvider('sms')!.send({ to: '9822041736', body: 'hi' }) // a bare 10-digit Indian number is normalised to +91
    expect(calls[0].init.body).toBe('To=%2B919822041736&MessagingServiceSid=MG0123&Body=hi')
  })

  it('WhatsApp: whatsapp: prefix on To and From, with or without the prefix in the env value', async () => {
    for (const from of ['+14155238886', 'whatsapp:+14155238886']) {
      env({ ...creds, TWILIO_WHATSAPP_FROM: from })
      const calls = stubFetch(ok('SMwa'))
      const res = await smsProvider('whatsapp')!.send({ to: NUMBER, body: 'Link: https://x.example/u/abc' })
      expect(res).toEqual({ providerMessageId: 'SMwa' })
      expect(calls[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`)
      expect(new URLSearchParams(calls[0].init.body).entries().toArray()).toEqual([
        ['To', `whatsapp:${E164}`], ['From', 'whatsapp:+14155238886'], ['Body', 'Link: https://x.example/u/abc'],
      ])
    }
  })

  it('a Hindi body is sent as UTF-8 form data and round-trips', async () => {
    env({ ...creds, TWILIO_FROM: '+15005550006' })
    const calls = stubFetch(ok())
    const body = 'आपका OncoSetu कोड 123456 है।'
    await smsProvider('sms')!.send({ to: NUMBER, body })
    expect(new URLSearchParams(calls[0].init.body).get('Body')).toBe(body)
    expect(calls[0].init.body).toContain('%E0%A4%86')
  })

  it('an unusable number never reaches Twilio', async () => {
    env({ ...creds, TWILIO_FROM: '+15005550006' })
    const calls = stubFetch(ok())
    await expect(smsProvider('sms')!.send({ to: '12345', body: 'x' })).rejects.toMatchObject({ code: 'invalid_number' })
    expect(calls).toHaveLength(0)
  })
})

describe('errors carry a short code, never Twilio\'s text or the number', () => {
  const send = () => smsProvider('sms')!.send({ to: NUMBER, body: 'x' })
  const fail = async (r: Response | Error) => {
    env({ ...creds, TWILIO_FROM: '+15005550006' })
    stubFetch(r)
    return send().then(() => { throw new Error('expected a rejection') }, (e: unknown) => e as SmsError)
  }

  it('4xx with a Twilio error code → twilio_<code>, not retryable, message free of the number', async () => {
    const e = await fail(json(400, { code: 21211, message: `The 'To' number ${E164} is not a valid phone number.`, status: 400 }))
    expect(e).toBeInstanceOf(SmsError)
    expect(e).toMatchObject({ code: 'twilio_21211', status: 400, retryable: false })
    expect(`${e.message} ${e.stack}`).not.toContain('9822041736')
  })
  it('5xx without a JSON body → http_<status>, retryable', async () => {
    expect(await fail(new Response('<html>bad gateway</html>', { status: 502 }))).toMatchObject({ code: 'http_502', status: 502, retryable: true })
  })
  it('network failure and timeout → network / timeout, not retryable', async () => {
    expect(await fail(new TypeError('fetch failed'))).toMatchObject({ code: 'network', status: null, retryable: false })
    expect(await fail(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toMatchObject({ code: 'timeout', retryable: false })
  })
  it('a 2xx without a message sid is a failure, not a success', async () => {
    expect(await fail(json(201, { status: 'queued' }))).toMatchObject({ code: 'bad_response' })
  })
})
