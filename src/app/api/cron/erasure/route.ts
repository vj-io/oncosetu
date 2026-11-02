// Vercel Cron (vercel.json, daily): the retention job for every org. Vercel sends `Authorization: Bearer $CRON_SECRET`.
// Public route (no session), so each org runs in its own withOrg transaction and audits as `system`.
import { db, withOrg } from '@/db'
import { organisations } from '@/db/schema'
import { writeAudit } from '@/server/audit'
import { timingSafeEqualStr } from '@/server/crypto'
import { runDueErasures } from '@/server/erasure/erasure'
import { HttpError, route } from '@/server/http'

export const GET = route({ auth: 'public' }, async ({ req, requestId }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  const results: Record<string, { executed: number; refused: number }> = {}
  for (const { id: orgId } of orgs) {
    const r = await withOrg(orgId, (tx) => runDueErasures({
      db: tx,
      audit: async (action, targetType, targetId, details) => {
        await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action, targetType, targetId, requestId, details })
      },
    }))
    results[orgId] = { executed: r.executed.length, refused: r.refused.length }
  }
  return { ok: true, orgs: results }
})
