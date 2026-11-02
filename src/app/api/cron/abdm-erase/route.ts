// Vercel Cron (vercel.json, daily): ABDM-sourced data is deleted at the consent artefact's erase-at (PRD §10.5).
// Reads of the ABDM panel, the portal page and an ABDM source view run the same check for their patient.
import { db, withOrg } from '@/db'
import { organisations } from '@/db/schema'
import { eraseDue } from '@/server/abdm/flow'
import { writeAudit } from '@/server/audit'
import { timingSafeEqualStr } from '@/server/crypto'
import { HttpError, route } from '@/server/http'

export const GET = route({ auth: 'public' }, async ({ req, requestId }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  const erased: Record<string, number> = {}
  for (const { id: orgId } of orgs) {
    erased[orgId] = (await withOrg(orgId, (tx) => eraseDue({
      db: tx, orgId,
      audit: async (action, targetType, targetId, details) => {
        await writeAudit(tx, { orgId, actorId: null, actorRole: 'system', action, targetType, targetId, requestId, details })
      },
    }))).length
  }
  return { ok: true, erased }
})
