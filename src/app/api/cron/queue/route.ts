// Starts a runner on each organisation's longest-waiting document, in this fresh function call (after the response). A run
// that worked calls it when it ends (src/server/pipeline/ingest.ts, continueQueue), so a file queued behind another, or a
// long scan put back for time, carries on with no screen open. Vercel Cron (vercel.json, daily) calls it too, as a net.
import { db } from '@/db'
import { organisations } from '@/db/schema'
import { timingSafeEqualStr } from '@/server/crypto'
import { HttpError, route } from '@/server/http'
import { startNextWaiting } from '@/server/pipeline/ingest'

export const GET = route({ auth: 'public' }, async ({ req }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new HttpError(503, 'not_configured', 'Cron is not configured')
  if (!timingSafeEqualStr(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthenticated', 'Not allowed')
  const orgs = await db.select({ id: organisations.id }).from(organisations)
  let started = 0
  for (const o of orgs) if (await startNextWaiting(o.id)) started++
  return { ok: true, started }
})
