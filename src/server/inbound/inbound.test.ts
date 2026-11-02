import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { brandFor, lintText } from '@/core/copy'
import { inboundCopy } from '@/i18n/inbound'
import { MAX_FILE_BYTES } from '../pipeline/safety'
import { codeIn, evaluateHoldReply, HOLD_MAX_ATTEMPTS, HOLD_TTL_MS, holdCodeHash, MAX_FILES, type HoldState } from './hold'
import { aliasTokensOf, attachmentsOf, basicAuthOk, postmarkPayload, senderOf } from './postmark'
import { maskEmail } from './staff'
import { mediaOf, twilioSignature, twiml, validTwilioSignature } from './twilio'
import { mediaUrlAllowed } from './whatsapp'

beforeAll(() => { process.env.HMAC_KEY = randomBytes(32).toString('base64') })

describe('Twilio request signature', () => {
  // Known-answer vector published with Twilio's request validator (twilio-node webhooks tests).
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
  const params = new URLSearchParams({ CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' })

  it('matches the published vector', () => {
    expect(twilioSignature('12345', url, params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=')
    expect(validTwilioSignature('12345', url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(true)
  })
  it('sorts parameters, so the order they arrive in does not matter', () => {
    const shuffled = new URLSearchParams([...params.entries()].reverse())
    expect(twilioSignature('12345', url, shuffled)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=')
  })
  it('rejects a changed param, URL, token, or a missing header', () => {
    const sig = twilioSignature('12345', url, params)
    const changed = new URLSearchParams(params)
    changed.set('Digits', '1235')
    expect(validTwilioSignature('12345', url, changed, sig)).toBe(false)
    expect(validTwilioSignature('12345', 'http://mycompany.com/myapp.php?foo=1&bar=2', params, sig)).toBe(false)
    expect(validTwilioSignature('54321', url, params, sig)).toBe(false)
    expect(validTwilioSignature('12345', url, params, null)).toBe(false)
  })
  it('reads media items and escapes TwiML', () => {
    const p = new URLSearchParams({ NumMedia: '2', MediaUrl0: 'https://api.twilio.com/m/0', MediaContentType0: 'Image/JPEG', MediaUrl1: 'https://api.twilio.com/m/1', MediaContentType1: 'application/pdf' })
    expect(mediaOf(p)).toEqual([{ url: 'https://api.twilio.com/m/0', contentType: 'image/jpeg' }, { url: 'https://api.twilio.com/m/1', contentType: 'application/pdf' }])
    expect(mediaOf(new URLSearchParams({ NumMedia: 'x' }))).toEqual([])
    expect(twiml('a < b & "c"')).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &lt; b &amp; &quot;c&quot;</Message></Response>')
  })
  it('fetches media only from Twilio in production', () => {
    expect(mediaUrlAllowed('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1', true)).toBe(true)
    expect(mediaUrlAllowed('http://api.twilio.com/x', true)).toBe(false)
    expect(mediaUrlAllowed('https://evil.example/twilio.com', true)).toBe(false)
    expect(mediaUrlAllowed('https://api.twilio.com.evil.example/x', true)).toBe(false)
    expect(mediaUrlAllowed('http://127.0.0.1:4567/m.pdf', true, '')).toBe(false)
    expect(mediaUrlAllowed('http://127.0.0.1:4567/m.pdf', true, '127.0.0.1')).toBe(true)
    expect(mediaUrlAllowed('http://10.0.0.1/m.pdf', true, '127.0.0.1')).toBe(false)
    expect(mediaUrlAllowed('http://127.0.0.1:4010/x', false)).toBe(true)
    expect(mediaUrlAllowed('file:///etc/passwd', false)).toBe(false)
  })
})

describe('WhatsApp hold state machine', () => {
  const t0 = new Date('2026-11-02T10:00:00Z')
  const hold = (over: Partial<HoldState> = {}): HoldState => ({
    id: 'h1', codeHash: holdCodeHash('h1', '482915'), attempts: 0, expiresAt: new Date(t0.getTime() + HOLD_TTL_MS), releasedAt: null, ...over,
  })

  it('releases on the right code inside the window', () => {
    expect(evaluateHoldReply(hold(), '482915', t0)).toEqual({ kind: 'release' })
    expect(evaluateHoldReply(hold({ attempts: HOLD_MAX_ATTEMPTS - 1 }), '482915', t0)).toEqual({ kind: 'release' })
  })
  it('counts wrong codes and discards on the fifth', () => {
    let h = hold()
    for (let i = 1; i < HOLD_MAX_ATTEMPTS; i++) {
      const d = evaluateHoldReply(h, '000000', t0)
      expect(d).toEqual({ kind: 'wrong', attempts: i, left: HOLD_MAX_ATTEMPTS - i })
      h = { ...h, attempts: i }
    }
    expect(evaluateHoldReply(h, '000000', t0)).toEqual({ kind: 'discard', attempts: HOLD_MAX_ATTEMPTS })
  })
  it('expires after 10 minutes, even with the right code', () => {
    expect(HOLD_TTL_MS).toBe(10 * 60_000)
    expect(evaluateHoldReply(hold(), '482915', new Date(t0.getTime() + HOLD_TTL_MS))).toEqual({ kind: 'expired' })
  })
  it('has nothing to do without an open hold with an issued code', () => {
    expect(evaluateHoldReply(undefined, '482915', t0)).toEqual({ kind: 'none' })
    expect(evaluateHoldReply(hold({ releasedAt: t0 }), '482915', t0)).toEqual({ kind: 'none' })
    expect(evaluateHoldReply(hold({ codeHash: null }), '482915', t0)).toEqual({ kind: 'none' })
  })
  it("a code is bound to its hold: another hold's code does not release it", () => {
    expect(evaluateHoldReply(hold({ codeHash: holdCodeHash('h2', '482915') }), '482915', t0).kind).toBe('wrong')
  })
  it('reads six digits from a message, spaces allowed', () => {
    expect(codeIn(' 482 915 ')).toBe('482915')
    expect(codeIn('4829156')).toBeNull()
    expect(codeIn('code 482915')).toBeNull()
  })
})

describe('Postmark inbound payload', () => {
  const DOMAIN = 'in.oncosetu.example'
  const TOKEN = 'ABCDEFGHIJKLMNOP' // 16 base32 chars
  const base = { From: '"Asha Rao" <Asha.Rao@Example.com>', To: `${TOKEN.toLowerCase()}@${DOMAIN}`, Subject: 'reports', TextBody: 'hi', Attachments: [] }

  it('reads the sender from FromFull or the From header, lower-cased', () => {
    expect(senderOf(postmarkPayload.parse(base))).toBe('asha.rao@example.com')
    expect(senderOf(postmarkPayload.parse({ ...base, FromFull: { Email: 'Ravi@Example.com', Name: 'Ravi' } }))).toBe('ravi@example.com')
    expect(senderOf(postmarkPayload.parse({ ...base, From: 'nobody' }))).toBeNull()
  })
  it('routes on alias tokens at our domain only (To, Cc, Bcc, original recipient; +tags ignored; deduplicated)', () => {
    expect(aliasTokensOf(postmarkPayload.parse(base), DOMAIN)).toEqual([TOKEN])
    expect(aliasTokensOf(postmarkPayload.parse({
      ...base, To: 'clinic@hospital.example', ToFull: [{ Email: `${TOKEN.toLowerCase()}+scan@${DOMAIN.toUpperCase()}`, Name: '' }],
      OriginalRecipient: `${TOKEN.toLowerCase()}@${DOMAIN}`,
    }), DOMAIN)).toEqual([TOKEN])
    expect(aliasTokensOf(postmarkPayload.parse({ ...base, To: `${TOKEN}@other.example, short@${DOMAIN}, ${'A'.repeat(17)}@${DOMAIN}` }), DOMAIN)).toEqual([])
    expect(aliasTokensOf(postmarkPayload.parse({ ...base, Cc: `qrstuvwxyz234567@${DOMAIN}` }), DOMAIN)).toEqual([TOKEN, 'QRSTUVWXYZ234567'])
  })
  it('decodes attachments within the limits: 4 MB each, 10 per mail', () => {
    const pdf = Buffer.from('%PDF-1.4 test').toString('base64')
    const atts = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ Name: `f${i}.pdf`, Content: pdf, ContentType: 'application/pdf', ContentLength: 13 }))
    atts[1] = { ...atts[1], ContentLength: MAX_FILE_BYTES + 1 }
    atts[2] = { ...atts[2], Content: '' }
    const out = attachmentsOf(postmarkPayload.parse({ ...base, Attachments: atts }))
    expect(out[0]).toMatchObject({ index: 0, name: 'f0.pdf' })
    expect(Buffer.from((out[0] as { bytes: Uint8Array }).bytes).toString()).toBe('%PDF-1.4 test')
    expect(out[1]).toEqual({ index: 1, reason: 'file_too_large' })
    expect(out[2]).toEqual({ index: 2, reason: 'empty_file' })
    expect(out[MAX_FILES]).toEqual({ index: MAX_FILES, reason: 'too_many_attachments' })
    // A lying ContentLength does not get past the decoded-size check.
    const big = Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64')
    expect(attachmentsOf(postmarkPayload.parse({ ...base, Attachments: [{ Name: 'x', Content: big, ContentLength: 10 }] }))[0]).toEqual({ index: 0, reason: 'file_too_large' })
  })
  it('checks HTTP Basic credentials exactly', () => {
    const h = (s: string) => `Basic ${Buffer.from(s).toString('base64')}`
    expect(basicAuthOk(h('postmark:s3cret'), 'postmark', 's3cret')).toBe(true)
    expect(basicAuthOk(h('postmark:s3cre'), 'postmark', 's3cret')).toBe(false)
    expect(basicAuthOk(h('postmark:s3cret:'), 'postmark', 's3cret')).toBe(false)
    expect(basicAuthOk(null, 'postmark', 's3cret')).toBe(false)
    expect(basicAuthOk('Bearer x', 'postmark', 's3cret')).toBe(false)
  })
  it('masks a verified address for the staff list', () => {
    expect(maskEmail('asha.rao@example.com')).toBe('as•••@example.com')
    expect(maskEmail('a@example.com')).toBe('a•••@example.com')
  })
})

describe('WhatsApp replies (FR-CON-07 copy lint)', () => {
  it('every template, rendered with the non-cleared brand, is free of diagnosis, radar and legal words', () => {
    const brand = brandFor('unknown')
    const rendered: string[] = []
    for (const lang of ['en', 'hi'] as const) {
      for (const v of Object.values(inboundCopy)) {
        const t = v[lang] as string | ((...a: never[]) => string)
        if (typeof t === 'string') rendered.push(t)
        else rendered.push((t as (b: string, n: number | string) => string)(brand, 3), (t as (b: string, n: number | string) => string)(brand, '482915'))
      }
    }
    expect(rendered.length).toBeGreaterThan(20)
    expect(rendered.flatMap((s) => lintText(s, ['diagnosis', 'radar', 'legal']).map((h) => `${s} → ${h.term}`))).toEqual([])
    expect(rendered.join(' ')).not.toMatch(/Onco/)
  })
})
