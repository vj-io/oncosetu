// Real SMS / WhatsApp delivery behind the outbox (docs/ARCHITECTURE.md "SMS provider"). `null` = demo / simulated:
// the outbox row is still written, nothing leaves the server. Env, read on use:
//   SMS       TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_FROM | TWILIO_MESSAGING_SERVICE_SID; the service wins if both)
//   WhatsApp  TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM  (numbers get Twilio's `whatsapp:` prefix)
// Never put the destination number, the body or Twilio's error text (it can quote the number) in a log or an error:
// failures carry a short code only.
import { normalizePhone } from '../crypto'

export type SmsChannel = 'sms' | 'whatsapp'
export type SmsProvider = { name: 'twilio'; send(m: { to: string; body: string }): Promise<{ providerMessageId: string }> }

export class SmsError extends Error {
  /** `twilio_<code>` (Twilio's own error code), `http_<status>`, `timeout`, `network` or `bad_response`. */
  constructor(readonly code: string, readonly status: number | null) {
    super(code)
    this.name = 'SmsError'
  }
  /** Only a 5xx is worth one more try; a 4xx (bad number, bad credentials) will not change. */
  get retryable(): boolean {
    return this.status !== null && this.status >= 500
  }
}

const TIMEOUT_MS = 10_000

export function smsProvider(channel: SmsChannel = 'sms'): SmsProvider | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  const wa = channel === 'whatsapp'
  const from = wa ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_FROM
  const service = wa ? undefined : process.env.TWILIO_MESSAGING_SERVICE_SID
  if (!from && !service) return null
  const prefix = wa ? 'whatsapp:' : ''
  return {
    name: 'twilio',
    async send({ to, body }) {
      const e164 = normalizePhone(to)
      if (!e164) throw new SmsError('invalid_number', null)
      const form = new URLSearchParams({ To: prefix + e164 })
      if (service) form.set('MessagingServiceSid', service)
      else form.set('From', from!.startsWith(prefix) ? from! : prefix + from!)
      form.set('Body', body)
      let res: Response
      try {
        res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: 'POST',
          headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (e) {
        throw new SmsError((e as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'network', null)
      }
      const json = (await res.json().catch(() => null)) as { sid?: unknown; code?: unknown } | null
      if (res.ok) {
        if (typeof json?.sid === 'string') return { providerMessageId: json.sid }
        throw new SmsError('bad_response', res.status)
      }
      throw new SmsError(typeof json?.code === 'number' ? `twilio_${json.code}` : `http_${res.status}`, res.status)
    },
  }
}
