// Vercel Cron (vercel.json, daily): drops WhatsApp holds whose 10-minute code window passed without a release (the
// held files are deleted with them). The sender's next message does the same for their own holds.
import { db, withOrg } from '@/db'
import { organisations } from '@/db/schema'
import { timingSafeEqualStr } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { sweepExpiredHolds } from '@/server/inbound/whatsapp'

export const GET = route({ auth: 'public' }, async ({ req, requestId }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  const discarded: Record<string, number> = {}
  for (const { id: orgId } of orgs) discarded[orgId] = (await withOrg(orgId, (tx) => sweepExpiredHolds(tx, orgId, requestId))).length
  return { ok: true, discarded }
})
