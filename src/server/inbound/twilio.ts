// Twilio webhook helpers (FR-ING-05). Pure: no DB, no env.
import { createHmac } from 'node:crypto'
import { timingSafeEqualStr } from '../crypto'

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + every POST param name+value, names sorted)).
 * `url` is the full public URL Twilio called, query string included (behind a proxy: PUBLIC_BASE_URL + path).
 */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const data = [...params.keys()].filter((k, i, a) => a.indexOf(k) === i).sort()
    .reduce((s, k) => s + params.getAll(k).map((v) => k + v).join(''), url)
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

export function validTwilioSignature(authToken: string, url: string, params: URLSearchParams, header: string | null): boolean {
  return !!header && timingSafeEqualStr(twilioSignature(authToken, url, params), header)
}

const XML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/** TwiML reply: one message back to the sender. */
export const twiml = (text: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${text.replace(/[&<>"']/g, (c) => XML[c])}</Message></Response>`

/** Media declared by the webhook (`NumMedia`, `MediaUrl{n}`, `MediaContentType{n}`; Twilio sends at most 10). */
export function mediaOf(p: URLSearchParams): { url: string; contentType: string }[] {
  const n = Math.min(Math.max(0, Number.parseInt(p.get('NumMedia') ?? '0', 10) || 0), 10)
  return Array.from({ length: n }, (_, i) => ({ url: p.get(`MediaUrl${i}`) ?? '', contentType: (p.get(`MediaContentType${i}`) ?? '').toLowerCase() }))
    .filter((m) => m.url)
}
