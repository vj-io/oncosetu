// POST /api/inbound/email: the Postmark inbound webhook (FR-ING-04, V05-E2E-07). Not wrapped in route(): a
// server-to-server call carries no Origin header, so it is authenticated by HTTP Basic credentials instead (Postmark
// sends them from the webhook URL, https://USER:PASSWORD@host/api/inbound/email). A refused mail is still a 200 with
// `{ accepted: false, reason }`, so Postmark does not retry it.
import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { emailIntake } from '@/server/inbound/email'
import { basicAuthOk, postmarkPayload } from '@/server/inbound/postmark'
import { inboundDomain } from '@/server/inbound/staff'
import { logger } from '@/server/log'

export async function POST(req: NextRequest) {
  const requestId = randomUUID()
  const log = logger(requestId).child({ path: '/api/inbound/email' })
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId, ...extra } })
  const user = process.env.INBOUND_EMAIL_USER, password = process.env.INBOUND_EMAIL_PASSWORD, domain = inboundDomain()
  if (!user || !password || !domain) return json({ error: { code: 'not_configured', message: 'Email drop is not configured' } }, 503)
  if (!basicAuthOk(req.headers.get('authorization'), user, password)) {
    log.warn('inbound.email_bad_credentials')
    return json({ error: { code: 'unauthenticated', message: 'Not allowed' } }, 401, { 'www-authenticate': 'Basic realm="inbound-email"' })
  }
  const parsed = postmarkPayload.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: { code: 'invalid_request', message: 'Invalid payload' } }, 400)
  try {
    const out = await emailIntake.receive(parsed.data, requestId)
    log.info('inbound.email', out.accepted ? { accepted: true, documents: out.documents.length, skipped: out.skipped.length } : { accepted: false, reason: out.reason })
    return json(out)
  } catch (err) {
    log.error('inbound.email_failed', { err })
    return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500)
  }
}
