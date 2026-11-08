// Vercel Cron (vercel.json, daily): records-request tracking for every org (FR-REQ-04). The day-7 and day-21 reminders
// were sent only when someone opened a request list; this sends them on schedule. Same idempotent refresh as the read
// path, so a reminder is never sent twice. Messages go through the outbox (simulated unless an SMS provider is set).
import { db, withOrg } from '@/db'
import { organisations } from '@/db/schema'
import { timingSafeEqualStr } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { refreshOpenRequests } from '@/server/requests/requests'

export const GET = route({ auth: 'public' }, async ({ req }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  const patients: Record<string, number> = {}
  for (const { id: orgId } of orgs) patients[orgId] = await withOrg(orgId, (tx) => refreshOpenRequests(tx, orgId))
  return { ok: true, patients }
})
