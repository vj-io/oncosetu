// POST /api/inbound/whatsapp: the Twilio WhatsApp webhook (FR-ING-05). Not wrapped in route(): Twilio posts
// form-encoded data with no Origin header; it is authenticated by X-Twilio-Signature over the PUBLIC URL (Twilio
// signs the URL it called, which behind Vercel's proxy differs from the one this server sees). Replies are TwiML.
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { twiml, validTwilioSignature } from '@/server/inbound/twilio'
import { receiveWhatsApp } from '@/server/inbound/whatsapp'
import { logger } from '@/server/log'

export async function POST(req: NextRequest) {
  const requestId = randomUUID()
  const log = logger(requestId).child({ path: '/api/inbound/whatsapp' })
  const plain = (text: string, status: number) => new Response(text, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', 'x-request-id': requestId } })
  const token = process.env.TWILIO_AUTH_TOKEN, base = process.env.PUBLIC_BASE_URL
  if (!token || !base) return plain('WhatsApp intake is not configured', 503)
  const params = new URLSearchParams(await req.text())
  const url = base.replace(/\/+$/, '') + req.nextUrl.pathname + req.nextUrl.search
  if (!validTwilioSignature(token, url, params, req.headers.get('x-twilio-signature'))) {
    log.warn('inbound.whatsapp_bad_signature')
    return plain('Forbidden', 403)
  }
  try {
    const reply = await receiveWhatsApp(params, requestId)
    return new Response(twiml(reply), { headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId } })
  } catch (err) {
    log.error('inbound.whatsapp_failed', { err })
    return plain('Error', 500)
  }
}
