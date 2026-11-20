// Vercel Cron (vercel.json, daily): drops WhatsApp holds whose 10-minute code window passed without a release (the
// held files are deleted with them). The sender's next message does the same for their own holds. Also removes the stored
// pieces of uploads that expired unfinished (a failed CD upload otherwise keeps ~100 MB against the storage limit).
import { db, withOrg } from '@/db'
import { organisations } from '@/db/schema'
import { timingSafeEqualStr } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { sweepExpiredHolds } from '@/server/inbound/whatsapp'
import { purgeExpired } from '@/server/uploads/chunks'

export const GET = route({ auth: 'public' }, async ({ req, requestId }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  const discarded: Record<string, number> = {}, expiredUploads: Record<string, number> = {}
  for (const { id: orgId } of orgs) {
    discarded[orgId] = (await withOrg(orgId, (tx) => sweepExpiredHolds(tx, orgId, requestId))).length
    expiredUploads[orgId] = await withOrg(orgId, (tx) => purgeExpired(tx))
  }
  return { ok: true, discarded, expiredUploads }
})
