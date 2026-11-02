// Vercel Cron (vercel.json, daily): re-delivers outbox rows stuck in `queued` for over 5 minutes (the after() step
// died, e.g. the function was frozen). See src/server/sms/sweep.ts.
import { db } from '@/db'
import { organisations } from '@/db/schema'
import { timingSafeEqualStr } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { sweepOutbox } from '@/server/sms/sweep'

export const GET = route({ auth: 'public' }, async ({ req }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  return { ok: true, ...(await sweepOutbox(orgs.map((o) => o.id))) }
})
