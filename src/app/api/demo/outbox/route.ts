import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, withOrg } from '@/db'
import { organisations, outbox } from '@/db/schema'
import { phoneHmac } from '@/server/crypto'
import { isDemo } from '@/server/demo'
import { HttpError, route } from '@/server/http'

// DEMO_MODE only: the simulated phone. Latest messages for ?phone=, or all for the demo org(s).
export const GET = route({ auth: 'public', query: z.object({ phone: z.string().max(32).optional() }) }, async ({ query }) => {
  if (!isDemo()) throw new HttpError(404, 'not_found', 'Not found')
  const h = query.phone ? phoneHmac(query.phone) : null
  if (query.phone && !h) return { messages: [] }
  const orgs = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.isDemo, true))
  const messages = []
  for (const o of orgs) {
    messages.push(...await withOrg(o.id, (tx) => tx.select({
      id: outbox.id, channel: outbox.channel, toMasked: outbox.toMasked, templateKey: outbox.templateKey,
      body: outbox.body, lang: outbox.lang, createdAt: outbox.createdAt,
    }).from(outbox).where(h ? and(eq(outbox.orgId, o.id), eq(outbox.toHmac, h)) : eq(outbox.orgId, o.id))
      .orderBy(desc(outbox.createdAt)).limit(h ? 20 : 50)))
  }
  messages.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return { messages }
})
